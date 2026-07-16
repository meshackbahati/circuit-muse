"""Pluggable strategies for fetching opaque asset blobs onto disk.

Two implementations ship in the box:

* :class:`LicenseGatedDownloader` — talks to the velxio.dev licence-
  gated download endpoint (the same one ``Dockerfile.prod`` uses to
  pull ``libqemu-xtensa.so`` at image-build time).

* :class:`LocalDirectoryDownloader` — copies from a directory on the
  host. Useful for tests, air-gapped self-hosting, and bootstrapping
  new asset sets before they're uploaded to the licence endpoint.

The :class:`AssetDownloader` ``Protocol`` is intentionally tiny: one
``fetch()`` method that materialises a blob atomically. The provider
handles SHA256 verification and decompression on top.
"""

from __future__ import annotations

import logging
import os
import shutil
from pathlib import Path
from typing import Protocol

from .errors import DownloadError, NoDownloaderConfiguredError


logger = logging.getLogger(__name__)


class AssetDownloader(Protocol):
    """Strategy interface for materialising one opaque blob on disk.

    Implementations MUST write to a sibling temp file and ``rename()``
    atomically — partial writes from an aborted fetch must not leave a
    half-finished file at ``target_path``.
    """

    async def fetch(self, asset_id: str, target_path: Path) -> None:
        """Stream the bytes for ``asset_id`` into ``target_path``.

        Raises:
            DownloadError: any failure (network, auth, server-side).
        """
        ...


class LicenseGatedDownloader:
    """Fetch from ``${VELXIO_BINARY_BASE_URL}/{asset_id}?key=$KEY``.

    Mirrors the URL pattern the ``qemu-provider`` stage of
    ``Dockerfile.prod`` uses for ESP32 / RISC-V libs, so adding a new
    board's assets is "upload to the licence module, list the asset_id
    in manifest.json" with no plumbing per board.
    """

    def __init__(
        self,
        base_url: str,
        license_key: str,
        *,
        timeout_s: float = 600.0,
    ):
        self._base_url = base_url.rstrip("/")
        self._key = license_key
        self._timeout_s = timeout_s

    async def fetch(self, asset_id: str, target_path: Path) -> None:
        # httpx is imported lazily so unit tests that mock the
        # downloader don't need it in the test graph.
        import httpx

        url = f"{self._base_url}/{asset_id}"
        tmp = target_path.with_suffix(target_path.suffix + ".tmp")
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(self._timeout_s, connect=10.0),
                follow_redirects=True,
            ) as client:
                async with client.stream(
                    "GET", url, params={"key": self._key},
                ) as response:
                    if response.status_code != 200:
                        body = (await response.aread())[:256].decode(
                            "utf-8", "replace",
                        )
                        raise DownloadError(
                            f"GET {url} → HTTP {response.status_code}: {body!r}"
                        )
                    with tmp.open("wb") as f:
                        async for chunk in response.aiter_bytes(1024 * 1024):
                            f.write(chunk)
            tmp.replace(target_path)
        except DownloadError:
            tmp.unlink(missing_ok=True)
            raise
        except Exception as exc:
            tmp.unlink(missing_ok=True)
            raise DownloadError(
                f"download failed for {asset_id}: {exc}"
            ) from exc


class LocalDirectoryDownloader:
    """Resolve assets from ``source_dir/<asset_id>``.

    Two flavours of ``source_dir`` layout are recognised:

    * Flat — ``source_dir/<asset_id>`` is the binary itself.
    * Manifest — ``source_dir/<asset_id>/`` is a directory containing
      ``manifest.json`` + the real binary file (the same layout the
      licence module's ``AssetStorage`` uses). The downloader reads
      ``binary_filename`` from the manifest.

    The licence-module layout flavour is what lets the in-prod backend
    point at ``/var/velxio-pro/binaries`` directly for boot-image
    resolution (skipping the round-trip through the HTTP endpoint) if
    that's ever desired for tests or co-located deployments.
    """

    def __init__(self, source_dir: Path):
        self._source_dir = source_dir

    async def fetch(self, asset_id: str, target_path: Path) -> None:
        src = self._resolve(asset_id)
        if src is None:
            raise DownloadError(
                f"asset {asset_id!r} not present under {self._source_dir}"
            )
        tmp = target_path.with_suffix(target_path.suffix + ".tmp")
        try:
            shutil.copyfile(src, tmp)
            tmp.replace(target_path)
        except Exception as exc:
            tmp.unlink(missing_ok=True)
            raise DownloadError(
                f"local copy failed for {asset_id}: {exc}"
            ) from exc

    def _resolve(self, asset_id: str) -> Path | None:
        flat = self._source_dir / asset_id
        if flat.is_file():
            return flat
        manifest_dir = self._source_dir / asset_id
        if manifest_dir.is_dir():
            mf = manifest_dir / "manifest.json"
            if mf.is_file():
                import json

                try:
                    data = json.loads(mf.read_text(encoding="utf-8"))
                    binary = manifest_dir / str(data["binary_filename"])
                    if binary.is_file():
                        return binary
                except (OSError, json.JSONDecodeError, KeyError):
                    pass
        return None


def build_downloader_from_env() -> AssetDownloader:
    """Choose a downloader using environment variables.

    Resolution order — first match wins:

    1. ``VELXIO_BOOT_IMAGES_LOCAL_DIR`` → :class:`LocalDirectoryDownloader`
       (preferred for tests / air-gapped self-hosting).
    2. ``VELXIO_BINARY_BASE_URL`` + ``VELXIO_LICENSE_KEY`` →
       :class:`LicenseGatedDownloader` (production default).

    Raises :class:`NoDownloaderConfiguredError` if neither path is
    configured — fail-fast at startup so deployments without the
    correct env hit the error in CI rather than at first user request.
    """
    local_dir = os.environ.get("VELXIO_BOOT_IMAGES_LOCAL_DIR", "").strip()
    if local_dir:
        return LocalDirectoryDownloader(Path(local_dir))

    base_url = os.environ.get("VELXIO_BINARY_BASE_URL", "").strip()
    license_key = os.environ.get("VELXIO_LICENSE_KEY", "").strip()
    if base_url and license_key:
        return LicenseGatedDownloader(base_url, license_key)

    raise NoDownloaderConfiguredError(
        "Boot-image downloader is not configured. Set "
        "VELXIO_BINARY_BASE_URL + VELXIO_LICENSE_KEY for the velxio.dev "
        "licence flow, or VELXIO_BOOT_IMAGES_LOCAL_DIR pointing at a "
        "directory holding the asset files."
    )
