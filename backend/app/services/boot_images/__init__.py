"""Boot-image provider for QEMU-emulated boards (Raspberry Pi 3, etc.).

See ``manifest.json`` next to this module for the declared image sets,
and ``docs/BOOT_IMAGES.md`` for the architecture overview.

Public entry point:

    from app.services.boot_images import get_default_provider
    provider = get_default_provider()
    images = await provider.get("raspberry-pi-3")
    # images["kernel8.img"], images["bcm2710-rpi-3-b.dtb"], ...
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from .downloader import (
    AssetDownloader,
    LicenseGatedDownloader,
    LocalDirectoryDownloader,
    build_downloader_from_env,
)
from .errors import (
    BootImageError,
    DecompressionError,
    DownloadError,
    ImageSetNotFoundError,
    IntegrityError,
    NoDownloaderConfiguredError,
)
from .manifest import (
    BootImageSpec,
    BootImagesManifest,
    CompressedSource,
    ImageSetSpec,
    load_manifest,
)
from .provider import BootImageProvider


__all__ = [
    "AssetDownloader",
    "BootImageError",
    "BootImageProvider",
    "BootImageSpec",
    "BootImagesManifest",
    "CompressedSource",
    "DecompressionError",
    "DownloadError",
    "ImageSetNotFoundError",
    "ImageSetSpec",
    "IntegrityError",
    "LicenseGatedDownloader",
    "LocalDirectoryDownloader",
    "NoDownloaderConfiguredError",
    "build_downloader_from_env",
    "get_default_provider",
    "load_manifest",
    "reset_default_provider",
]


_DEFAULT_MANIFEST_PATH = Path(__file__).parent / "manifest.json"
_DEFAULT_CACHE_DIR = Path("/var/cache/velxio/boot-images")


_provider_cache: Optional[BootImageProvider] = None


def get_default_provider() -> BootImageProvider:
    """Lazy process-wide singleton.

    Built once from the bundled ``manifest.json`` + ``build_downloader_from_env()``
    + ``VELXIO_BOOT_IMAGE_CACHE_DIR`` (or the default mount path).
    Re-imported tests should call :func:`reset_default_provider`
    between fixtures.
    """
    global _provider_cache
    if _provider_cache is None:
        manifest = load_manifest(_DEFAULT_MANIFEST_PATH)
        cache_dir = Path(
            os.environ.get(
                "VELXIO_BOOT_IMAGE_CACHE_DIR",
                str(_DEFAULT_CACHE_DIR),
            )
        )
        _provider_cache = BootImageProvider(
            manifest=manifest,
            downloader=build_downloader_from_env(),
            cache_dir=cache_dir,
        )
    return _provider_cache


def reset_default_provider() -> None:
    """Test helper — clears the lazy singleton so the next
    ``get_default_provider()`` call rebuilds from current env."""
    global _provider_cache
    _provider_cache = None
