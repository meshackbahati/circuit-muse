"""Typed exceptions for the boot-image provisioning subsystem.

Catching ``BootImageError`` covers every failure mode the provider can
surface; individual subclasses exist so callers can render different
user-facing messages (network outage vs corrupt download vs missing
configuration).
"""

from __future__ import annotations


class BootImageError(Exception):
    """Base class for every failure raised by the boot-image module."""


class ImageSetNotFoundError(BootImageError):
    """The requested image-set id is not declared in the manifest."""


class DownloadError(BootImageError):
    """The pluggable AssetDownloader failed (network / auth / server)."""


class IntegrityError(BootImageError):
    """A materialised file did not match its expected SHA256."""

    def __init__(self, *, name: str, expected: str, actual: str):
        super().__init__(
            f"integrity check failed for {name!r}: "
            f"expected {expected}, got {actual}"
        )
        self.name = name
        self.expected = expected
        self.actual = actual


class DecompressionError(BootImageError):
    """A compressed asset failed to decompress."""


class NoDownloaderConfiguredError(BootImageError):
    """No AssetDownloader could be built from the process environment."""
