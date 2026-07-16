"""Orchestrator: materialise + cache + verify boot files for QEMU boards.

The provider is the only object QEMU launch code needs to hold a
reference to. It owns the on-disk cache, the per-set asyncio locks
(so concurrent boot requests for the same board collapse into one
download), and the verify-then-rename ladder that gives us atomic
"a file at this path means it's correct".
"""

from __future__ import annotations

import asyncio
import logging
import tempfile
from pathlib import Path

from .downloader import AssetDownloader
from .errors import BootImageError
from .integrity import decompress_zstd, sha256_file, verify_sha256
from .manifest import BootImageSpec, BootImagesManifest, ImageSetSpec


logger = logging.getLogger(__name__)


class BootImageProvider:
    """Materialise and cache boot files on demand, idempotently.

    Operational notes:

    * First call for a set_id pays the download cost. Subsequent calls
      do an mtime/size/SHA256 cache check and return immediately if
      the files are still valid.
    * Concurrent ``get()`` calls for the same set_id serialise on a
      per-set ``asyncio.Lock``; the second caller observes a populated
      cache and skips the download.
    * Different set_ids materialise in parallel.
    * On SHA256 mismatch the file is left in a temp dir (never reaches
      ``target_path``), so a corrupt download cannot poison the cache
      for the next process.
    """

    def __init__(
        self,
        *,
        manifest: BootImagesManifest,
        downloader: AssetDownloader,
        cache_dir: Path,
    ):
        self._manifest = manifest
        self._downloader = downloader
        self._cache_dir = cache_dir
        self._cache_dir.mkdir(parents=True, exist_ok=True)
        self._locks: dict[str, asyncio.Lock] = {}
        self._locks_guard = asyncio.Lock()

    # ── Public API ────────────────────────────────────────────────────────

    @property
    def cache_dir(self) -> Path:
        return self._cache_dir

    @property
    def manifest(self) -> BootImagesManifest:
        return self._manifest

    async def get(self, set_id: str) -> dict[str, Path]:
        """Return ``{image_name: absolute_path}`` for ``set_id``.

        Downloads + verifies + (when applicable) decompresses on first
        call. Subsequent calls are cache hits. Concurrent callers
        serialise on a per-set lock.
        """
        spec = self._manifest.get(set_id)
        lock = await self._lock_for(set_id)
        async with lock:
            return await self._materialise(spec)

    async def warmup(self, set_id: str) -> None:
        """Best-effort prefetch. Logs warnings on failure but never
        raises — designed to be fire-and-forget from a lifespan hook
        so a transient network blip doesn't break process startup.
        """
        try:
            await self.get(set_id)
            logger.info("[boot-images] warmup complete for %r", set_id)
        except BootImageError as exc:
            logger.warning(
                "[boot-images] warmup for %r failed: %s", set_id, exc,
            )

    async def warmup_all(self) -> None:
        """Concurrent warmup of every set declared in the manifest."""
        await asyncio.gather(
            *(self.warmup(s) for s in self._manifest.image_sets),
            return_exceptions=False,  # warmup() already swallows
        )

    def is_cached(self, set_id: str) -> bool:
        """Sync probe used by health/status endpoints.

        Uses the same sidecar-SHA check ``_is_valid_cached`` does so
        a manifest bump correctly reports "not cached yet" until the
        next ``get()`` re-materialises the file.
        """
        try:
            spec = self._manifest.get(set_id)
        except BootImageError:
            return False
        set_dir = self._cache_dir / set_id
        return all(
            self._is_valid_cached(set_dir / img.name, img) for img in spec.images
        )

    # ── Internals ─────────────────────────────────────────────────────────

    async def _lock_for(self, set_id: str) -> asyncio.Lock:
        async with self._locks_guard:
            lock = self._locks.get(set_id)
            if lock is None:
                lock = asyncio.Lock()
                self._locks[set_id] = lock
            return lock

    async def _materialise(self, spec: ImageSetSpec) -> dict[str, Path]:
        set_dir = self._cache_dir / spec.id
        set_dir.mkdir(parents=True, exist_ok=True)

        out: dict[str, Path] = {}
        for img in spec.images:
            target = set_dir / img.name
            if await asyncio.to_thread(self._is_valid_cached, target, img):
                logger.debug("[boot-images] cache hit %s", target)
                out[img.name] = target
                continue
            logger.info(
                "[boot-images] fetching %s/%s (asset_id=%s%s)",
                spec.id,
                img.name,
                img.asset_id,
                f", version={img.version}" if img.version else "",
            )
            await self._fetch_and_verify(img, target)
            out[img.name] = target
        return out

    @staticmethod
    def _sidecar(target: Path) -> Path:
        """Sidecar file recording the SHA256 of the cached payload.

        Written atomically (temp + rename) after a successful
        download+verify, read on every cache-validity probe. Lets the
        provider detect manifest SHA bumps without re-hashing
        multi-GiB files on every container start.
        """
        return target.parent / f"{target.name}.sha256"

    @classmethod
    def _is_valid_cached(cls, path: Path, spec: BootImageSpec) -> bool:
        """O(1) cache-hit probe — presence + size + sidecar SHA match.

        We deliberately do NOT re-hash the file on every probe. The
        5.4 GiB Pi 3 SD image takes ~30 s to SHA256, and that cost
        would be paid on every container boot pre-warm AND every user
        request that triggers ``provider.get()``.

        Instead, after a successful materialise we write a sidecar
        ``<name>.sha256`` containing the expected hash and trust it on
        subsequent probes. A manifest SHA bump invalidates the sidecar
        even if the size is unchanged (e.g. an in-place SD image edit
        that ends up the exact same byte count), forcing a re-fetch.

        If the sidecar is missing (legacy cache from before this
        change, or operator tampering) the file is treated as invalid
        and re-fetched. Manual operators who want to inject a file can
        write the sidecar themselves: ``sha256sum file | cut -d' ' -f1
        > file.sha256``.
        """
        if not path.is_file():
            return False
        if path.stat().st_size != spec.size_bytes:
            return False
        sidecar = cls._sidecar(path)
        if not sidecar.is_file():
            return False
        try:
            recorded = sidecar.read_text(encoding="ascii").strip().lower()
        except OSError:
            return False
        return recorded == spec.sha256.lower()

    async def _fetch_and_verify(
        self, img: BootImageSpec, target: Path,
    ) -> None:
        if img.compressed is None:
            await self._downloader.fetch(img.asset_id, target)
            await asyncio.to_thread(
                verify_sha256, target, img.sha256, label=img.name,
            )
        else:
            # Compressed path: download → verify wire-format sha →
            # decompress → verify decompressed sha → atomic rename to
            # final cache slot.
            with tempfile.TemporaryDirectory(
                dir=target.parent, prefix=".staging-",
            ) as staging:
                staging_dir = Path(staging)
                compressed_path = (
                    staging_dir / f"{img.name}.{img.compressed.encoding}"
                )
                await self._downloader.fetch(img.asset_id, compressed_path)
                await asyncio.to_thread(
                    verify_sha256,
                    compressed_path,
                    img.compressed.sha256,
                    label=f"{img.name} (compressed)",
                )
                decoded = staging_dir / img.name
                if img.compressed.encoding == "zstd":
                    await asyncio.to_thread(decompress_zstd, compressed_path, decoded)
                else:
                    raise BootImageError(
                        f"unsupported compression {img.compressed.encoding!r}"
                    )
                await asyncio.to_thread(
                    verify_sha256,
                    decoded,
                    img.sha256,
                    label=f"{img.name} (decompressed)",
                )
                await asyncio.to_thread(decoded.replace, target)
        # Record the expected SHA next to the file so future cache
        # probes can detect manifest bumps without re-hashing the
        # whole file.  Sidecar write is atomic (temp + rename) so a
        # process crash mid-write can't leave a half-written hash.
        await asyncio.to_thread(self._write_sidecar, target, img.sha256)

    @classmethod
    def _write_sidecar(cls, target: Path, sha256: str) -> None:
        sidecar = cls._sidecar(target)
        tmp = sidecar.with_suffix(sidecar.suffix + ".tmp")
        tmp.write_text(sha256.lower() + "\n", encoding="ascii")
        tmp.replace(sidecar)
