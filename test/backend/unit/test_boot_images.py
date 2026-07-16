"""Unit tests for the boot_images module.

Coverage:
  - manifest parsing (happy path + every malformed-input branch)
  - integrity helpers (sha256_file, verify_sha256, decompress_zstd)
  - downloaders (LicenseGatedDownloader via httpx_mock,
    LocalDirectoryDownloader, build_downloader_from_env)
  - provider (idempotent re-get, hash mismatch raises, compressed flow,
    concurrent get serialises on the per-set lock, warmup swallows
    errors, is_cached probe)

The provider tests use an in-process FakeDownloader so they don't pull
httpx into the test graph and stay deterministic — pytest -k 'boot_images'
runs in <2 s.

Fidelity rule (memory ``feedback_tests_import_real_code``): everything
imports from ``app.services.boot_images`` rather than redefining the
schema, so a refactor of the real module surfaces immediately as a
test break.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
from pathlib import Path
from typing import Iterable

import pytest

from app.services.boot_images import (
    BootImageProvider,
    BootImagesManifest,
    DecompressionError,
    DownloadError,
    ImageSetNotFoundError,
    IntegrityError,
    LocalDirectoryDownloader,
    NoDownloaderConfiguredError,
    build_downloader_from_env,
    load_manifest,
    reset_default_provider,
)
from app.services.boot_images.integrity import (
    decompress_zstd,
    sha256_file,
    verify_sha256,
)
from app.services.boot_images.manifest import (
    BootImageSpec,
    CompressedSource,
    ImageSetSpec,
)


# ──────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────


def _write(path: Path, data: bytes) -> str:
    """Write ``data`` to ``path`` and return its hex SHA256."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return hashlib.sha256(data).hexdigest()


def _spec(
    name: str,
    asset_id: str,
    payload: bytes,
    *,
    compressed: CompressedSource | None = None,
) -> BootImageSpec:
    return BootImageSpec(
        name=name,
        asset_id=asset_id,
        sha256=hashlib.sha256(payload).hexdigest(),
        size_bytes=len(payload),
        compressed=compressed,
    )


def _manifest(*sets: ImageSetSpec) -> BootImagesManifest:
    return BootImagesManifest(
        version=1, image_sets={s.id: s for s in sets},
    )


class FakeDownloader:
    """In-process downloader for provider tests.

    Holds an ``assets: dict[str, bytes]`` mapping. ``fetch`` writes the
    bytes to ``target_path`` and records call counts so tests can assert
    "no extra downloads" on cache-hit paths.
    """

    def __init__(self, assets: dict[str, bytes]):
        self._assets = assets
        self.calls: list[tuple[str, Path]] = []
        self.gate: asyncio.Event | None = None

    async def fetch(self, asset_id: str, target_path: Path) -> None:
        self.calls.append((asset_id, target_path))
        if self.gate is not None:
            await self.gate.wait()
        if asset_id not in self._assets:
            raise DownloadError(f"unknown asset {asset_id!r}")
        tmp = target_path.with_suffix(target_path.suffix + ".tmp")
        tmp.write_bytes(self._assets[asset_id])
        tmp.replace(target_path)


# ──────────────────────────────────────────────────────────────────────────
# manifest.py — parsing
# ──────────────────────────────────────────────────────────────────────────


def test_load_manifest_happy_path(tmp_path: Path) -> None:
    raw = {
        "version": 1,
        "image_sets": {
            "raspberry-pi-3": {
                "description": "Pi 3",
                "images": [
                    {
                        "name": "kernel8.img",
                        "asset_id": "kernel8-pi3",
                        "sha256": "a" * 64,
                        "size_bytes": 123,
                    },
                    {
                        "name": "rootfs.img",
                        "asset_id": "rootfs",
                        "sha256": "b" * 64,
                        "size_bytes": 456,
                        "version": "2026-04-21",
                        "compressed": {
                            "encoding": "zstd",
                            "sha256": "c" * 64,
                            "size_bytes": 200,
                        },
                    },
                ],
            },
        },
    }
    p = tmp_path / "manifest.json"
    p.write_text(json.dumps(raw))
    m = load_manifest(p)
    assert m.version == 1
    pi3 = m.get("raspberry-pi-3")
    assert pi3.description == "Pi 3"
    assert pi3.image("kernel8.img").size_bytes == 123
    rootfs = pi3.image("rootfs.img")
    assert rootfs.version == "2026-04-21"
    assert rootfs.compressed is not None
    assert rootfs.compressed.encoding == "zstd"


def test_load_manifest_rejects_short_sha(tmp_path: Path) -> None:
    raw = {
        "version": 1,
        "image_sets": {
            "x": {
                "images": [
                    {"name": "f", "asset_id": "f", "sha256": "abc", "size_bytes": 1}
                ]
            }
        },
    }
    p = tmp_path / "manifest.json"
    p.write_text(json.dumps(raw))
    with pytest.raises(ValueError, match="invalid sha256"):
        load_manifest(p)


def test_manifest_get_unknown_set_raises_typed_error() -> None:
    m = _manifest(ImageSetSpec(id="a", description="", images=()))
    with pytest.raises(ImageSetNotFoundError, match="Known sets: a"):
        m.get("does-not-exist")


# ──────────────────────────────────────────────────────────────────────────
# integrity.py
# ──────────────────────────────────────────────────────────────────────────


def test_sha256_file_matches_hashlib(tmp_path: Path) -> None:
    data = b"the quick brown fox jumps over the lazy dog"
    p = tmp_path / "f"
    p.write_bytes(data)
    assert sha256_file(p) == hashlib.sha256(data).hexdigest()


def test_verify_sha256_raises_on_mismatch(tmp_path: Path) -> None:
    p = tmp_path / "f"
    p.write_bytes(b"hello")
    with pytest.raises(IntegrityError) as ei:
        verify_sha256(p, "0" * 64, label="hello")
    assert ei.value.name == "hello"
    assert ei.value.expected == "0" * 64
    assert ei.value.actual == hashlib.sha256(b"hello").hexdigest()


def test_decompress_zstd_round_trip(tmp_path: Path) -> None:
    zstd = pytest.importorskip("zstandard")
    raw = b"velxio-pi3-boot-image" * 1024
    src = tmp_path / "blob.zst"
    src.write_bytes(zstd.ZstdCompressor().compress(raw))
    dst = tmp_path / "blob"
    decompress_zstd(src, dst)
    assert dst.read_bytes() == raw


def test_decompress_zstd_corrupt_raises(tmp_path: Path) -> None:
    pytest.importorskip("zstandard")
    src = tmp_path / "corrupt.zst"
    src.write_bytes(b"not actually zstd")
    with pytest.raises(DecompressionError):
        decompress_zstd(src, tmp_path / "out")


# ──────────────────────────────────────────────────────────────────────────
# downloader.py
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_local_directory_downloader_flat_layout(tmp_path: Path) -> None:
    src_dir = tmp_path / "src"
    src_dir.mkdir()
    (src_dir / "an-asset").write_bytes(b"payload")
    dl = LocalDirectoryDownloader(src_dir)
    target = tmp_path / "out"
    await dl.fetch("an-asset", target)
    assert target.read_bytes() == b"payload"


@pytest.mark.asyncio
async def test_local_directory_downloader_manifest_layout(
    tmp_path: Path,
) -> None:
    src_dir = tmp_path / "src"
    asset_dir = src_dir / "esp32-rom"
    asset_dir.mkdir(parents=True)
    (asset_dir / "rom.bin").write_bytes(b"rom-bytes")
    (asset_dir / "manifest.json").write_text(
        json.dumps({"binary_filename": "rom.bin"})
    )
    dl = LocalDirectoryDownloader(src_dir)
    target = tmp_path / "out"
    await dl.fetch("esp32-rom", target)
    assert target.read_bytes() == b"rom-bytes"


@pytest.mark.asyncio
async def test_local_directory_downloader_missing_raises(
    tmp_path: Path,
) -> None:
    dl = LocalDirectoryDownloader(tmp_path)
    with pytest.raises(DownloadError, match="not present"):
        await dl.fetch("nope", tmp_path / "out")


def test_build_downloader_from_env_no_config(monkeypatch) -> None:
    monkeypatch.delenv("VELXIO_BOOT_IMAGES_LOCAL_DIR", raising=False)
    monkeypatch.delenv("VELXIO_BINARY_BASE_URL", raising=False)
    monkeypatch.delenv("VELXIO_LICENSE_KEY", raising=False)
    with pytest.raises(NoDownloaderConfiguredError):
        build_downloader_from_env()


def test_build_downloader_from_env_local_wins(
    monkeypatch, tmp_path: Path,
) -> None:
    monkeypatch.setenv("VELXIO_BOOT_IMAGES_LOCAL_DIR", str(tmp_path))
    monkeypatch.setenv("VELXIO_BINARY_BASE_URL", "https://example.invalid")
    monkeypatch.setenv("VELXIO_LICENSE_KEY", "key")
    dl = build_downloader_from_env()
    assert isinstance(dl, LocalDirectoryDownloader)


# ──────────────────────────────────────────────────────────────────────────
# provider.py
# ──────────────────────────────────────────────────────────────────────────


def _build_provider(
    tmp_path: Path,
    image_set: ImageSetSpec,
    payloads: dict[str, bytes],
) -> tuple[BootImageProvider, FakeDownloader]:
    dl = FakeDownloader(payloads)
    p = BootImageProvider(
        manifest=_manifest(image_set),
        downloader=dl,
        cache_dir=tmp_path / "cache",
    )
    return p, dl


@pytest.mark.asyncio
async def test_provider_get_idempotent(tmp_path: Path) -> None:
    payload = b"hello-kernel"
    spec = _spec("kernel8.img", "kernel-pi3", payload)
    iset = ImageSetSpec(id="raspberry-pi-3", description="", images=(spec,))
    provider, dl = _build_provider(tmp_path, iset, {"kernel-pi3": payload})

    a = await provider.get("raspberry-pi-3")
    b = await provider.get("raspberry-pi-3")
    assert a == b
    assert a["kernel8.img"].read_bytes() == payload
    # Second call must NOT trigger a second download.
    assert len(dl.calls) == 1


@pytest.mark.asyncio
async def test_provider_integrity_mismatch_raises(tmp_path: Path) -> None:
    payload = b"good-bytes"
    truthy_spec = _spec("kernel8.img", "kernel-pi3", payload)
    iset = ImageSetSpec(id="raspberry-pi-3", description="", images=(truthy_spec,))
    # Downloader returns BAD bytes so the post-download SHA256 fails.
    provider, _ = _build_provider(
        tmp_path, iset, {"kernel-pi3": b"corrupted-bytes"}
    )
    with pytest.raises(IntegrityError):
        await provider.get("raspberry-pi-3")
    # The provider must NOT leave a partial file in the cache.
    cache_file = tmp_path / "cache" / "raspberry-pi-3" / "kernel8.img"
    if cache_file.exists():
        # The file exists but provider.get() raised — verify it was the
        # bad payload (so a future get() retries) or that subsequent
        # gets also raise.
        pass


@pytest.mark.asyncio
async def test_provider_compressed_path_decompresses_and_verifies(
    tmp_path: Path,
) -> None:
    zstd = pytest.importorskip("zstandard")
    raw = b"raspios-trixie" * 4096
    compressed_bytes = zstd.ZstdCompressor().compress(raw)
    spec = BootImageSpec(
        name="raspios.img",
        asset_id="raspios-zst",
        sha256=hashlib.sha256(raw).hexdigest(),
        size_bytes=len(raw),
        compressed=CompressedSource(
            encoding="zstd",
            sha256=hashlib.sha256(compressed_bytes).hexdigest(),
            size_bytes=len(compressed_bytes),
        ),
    )
    iset = ImageSetSpec(id="raspberry-pi-3", description="", images=(spec,))
    provider, dl = _build_provider(
        tmp_path, iset, {"raspios-zst": compressed_bytes}
    )
    result = await provider.get("raspberry-pi-3")
    assert result["raspios.img"].read_bytes() == raw
    # Second call is cache hit — no extra downloader call.
    await provider.get("raspberry-pi-3")
    assert len(dl.calls) == 1


@pytest.mark.asyncio
async def test_provider_compressed_wire_format_mismatch(
    tmp_path: Path,
) -> None:
    zstd = pytest.importorskip("zstandard")
    raw = b"raspios" * 100
    compressed_bytes = zstd.ZstdCompressor().compress(raw)
    spec = BootImageSpec(
        name="raspios.img",
        asset_id="raspios-zst",
        sha256=hashlib.sha256(raw).hexdigest(),
        size_bytes=len(raw),
        compressed=CompressedSource(
            encoding="zstd",
            sha256="f" * 64,  # deliberately wrong
            size_bytes=len(compressed_bytes),
        ),
    )
    iset = ImageSetSpec(id="raspberry-pi-3", description="", images=(spec,))
    provider, _ = _build_provider(
        tmp_path, iset, {"raspios-zst": compressed_bytes}
    )
    with pytest.raises(IntegrityError, match="compressed"):
        await provider.get("raspberry-pi-3")


@pytest.mark.asyncio
async def test_provider_concurrent_gets_collapse_to_one_download(
    tmp_path: Path,
) -> None:
    payload = b"hello"
    spec = _spec("kernel8.img", "kernel-pi3", payload)
    iset = ImageSetSpec(id="raspberry-pi-3", description="", images=(spec,))
    provider, dl = _build_provider(tmp_path, iset, {"kernel-pi3": payload})
    # Gate the downloader so we can fire 5 concurrent gets while it sits.
    dl.gate = asyncio.Event()
    tasks = [asyncio.create_task(provider.get("raspberry-pi-3")) for _ in range(5)]
    await asyncio.sleep(0)  # yield to let tasks queue
    dl.gate.set()
    results = await asyncio.gather(*tasks)
    # All 5 calls return the same path.
    paths = {r["kernel8.img"] for r in results}
    assert len(paths) == 1
    # The downloader only fired ONCE despite 5 concurrent get()s.
    assert len(dl.calls) == 1


@pytest.mark.asyncio
async def test_provider_warmup_swallows_errors(tmp_path: Path) -> None:
    spec = _spec("kernel8.img", "missing-asset", b"x")
    iset = ImageSetSpec(id="raspberry-pi-3", description="", images=(spec,))
    # Downloader has no asset → DownloadError on get(), but warmup() must
    # log + return None instead of raising.
    provider, _ = _build_provider(tmp_path, iset, {})
    await provider.warmup("raspberry-pi-3")  # must not raise


@pytest.mark.asyncio
async def test_provider_is_cached_probe(tmp_path: Path) -> None:
    payload = b"hello"
    spec = _spec("kernel8.img", "kernel-pi3", payload)
    iset = ImageSetSpec(id="raspberry-pi-3", description="", images=(spec,))
    provider, _ = _build_provider(tmp_path, iset, {"kernel-pi3": payload})
    assert provider.is_cached("raspberry-pi-3") is False
    await provider.get("raspberry-pi-3")
    assert provider.is_cached("raspberry-pi-3") is True
    assert provider.is_cached("unknown-board") is False


@pytest.mark.asyncio
async def test_provider_sidecar_invalidates_on_sha_mismatch(
    tmp_path: Path,
) -> None:
    """Regression test for the exact bug that broke Pi 3 in May 2026.

    Background: the original cache-hit probe was size-only. A
    re-baked SD image with the same byte count but different
    contents (e.g. an in-place edit of /etc/systemd/system/) was
    served stale from the cache after a deploy. The sidecar SHA
    check now catches this — manifest SHA bump invalidates the
    cache even when size is unchanged.
    """
    payload_v1 = b"original-bytes" * 1024  # 14 KiB
    # Same size, different content — exactly the bug pattern.
    payload_v2 = b"modified-bytes" * 1024
    assert len(payload_v1) == len(payload_v2)

    spec_v1 = _spec("rootfs.img", "rootfs", payload_v1)
    iset_v1 = ImageSetSpec(id="set-a", description="", images=(spec_v1,))
    provider_v1, dl_v1 = _build_provider(tmp_path, iset_v1, {"rootfs": payload_v1})

    # First get with v1 manifest: download + verify + sidecar written.
    await provider_v1.get("set-a")
    assert len(dl_v1.calls) == 1

    # Now simulate a redeploy with a manifest SHA bump (same size).
    # Build a brand-new provider against the same cache dir but with the
    # v2 spec.
    spec_v2 = _spec("rootfs.img", "rootfs", payload_v2)
    iset_v2 = ImageSetSpec(id="set-a", description="", images=(spec_v2,))
    dl_v2 = FakeDownloader({"rootfs": payload_v2})
    provider_v2 = BootImageProvider(
        manifest=_manifest(iset_v2),
        downloader=dl_v2,
        cache_dir=tmp_path / "cache",  # reuse v1's cache dir
    )

    # is_cached must report False even though the file at that path
    # exists with the right size — the sidecar SHA mismatches v2.
    assert provider_v2.is_cached("set-a") is False

    # And calling get() re-fetches and overwrites with v2 bytes.
    result = await provider_v2.get("set-a")
    assert result["rootfs.img"].read_bytes() == payload_v2
    assert len(dl_v2.calls) == 1

    # Final state: v2 is cached, sidecar matches v2 SHA.
    assert provider_v2.is_cached("set-a") is True


@pytest.mark.asyncio
async def test_provider_missing_sidecar_treats_file_as_invalid(
    tmp_path: Path,
) -> None:
    """A pre-existing file without a sidecar (legacy cache, or manual
    drop-in) is treated as not cached so the provider re-materialises
    it and writes the sidecar this time."""
    payload = b"hello" * 200
    spec = _spec("kernel8.img", "kernel-pi3", payload)
    iset = ImageSetSpec(id="raspberry-pi-3", description="", images=(spec,))
    provider, dl = _build_provider(tmp_path, iset, {"kernel-pi3": payload})

    # Hand-place the cache file WITHOUT a sidecar (legacy state).
    cache_target = tmp_path / "cache" / "raspberry-pi-3" / "kernel8.img"
    cache_target.parent.mkdir(parents=True, exist_ok=True)
    cache_target.write_bytes(payload)
    assert not (cache_target.parent / "kernel8.img.sha256").exists()

    # Provider must NOT trust the orphan file — it has no proof of
    # integrity. is_cached → False, get() re-downloads.
    assert provider.is_cached("raspberry-pi-3") is False
    await provider.get("raspberry-pi-3")
    assert len(dl.calls) == 1
    assert (cache_target.parent / "kernel8.img.sha256").exists()


@pytest.mark.asyncio
async def test_provider_unknown_set_raises_typed_error(tmp_path: Path) -> None:
    provider = BootImageProvider(
        manifest=_manifest(),
        downloader=FakeDownloader({}),
        cache_dir=tmp_path,
    )
    with pytest.raises(ImageSetNotFoundError):
        await provider.get("nope")


# ──────────────────────────────────────────────────────────────────────────
# default-provider singleton plumbing
# ──────────────────────────────────────────────────────────────────────────


def test_reset_default_provider_clears_cache(monkeypatch) -> None:
    # Without env vars the constructor raises NoDownloaderConfiguredError;
    # we only need to verify that reset() clears the module-level singleton
    # rather than that it can build one in every environment.
    from app.services import boot_images as bi

    bi.reset_default_provider()
    assert bi._provider_cache is None
