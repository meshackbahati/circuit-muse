"""Hashing + decompression helpers used by the boot-image provider.

Kept separate from ``provider.py`` so the unit tests can exercise the
verification paths without spinning up a real provider.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

from .errors import DecompressionError, IntegrityError


_READ_CHUNK = 1024 * 1024  # 1 MiB; matches the download chunk in downloader.py.


def sha256_file(path: Path) -> str:
    """Compute the SHA256 of ``path`` in fixed-size chunks.

    Used by the provider both pre-download (cache validity probe) and
    post-download (integrity gate). 1 MiB chunks keep peak RSS bounded
    even for the 3 GiB SD image.
    """
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(_READ_CHUNK), b""):
            h.update(chunk)
    return h.hexdigest()


def verify_sha256(path: Path, expected: str, *, label: str | None = None) -> None:
    """Raise :class:`IntegrityError` if ``path`` doesn't hash to ``expected``."""
    actual = sha256_file(path)
    if actual.lower() != expected.lower():
        raise IntegrityError(
            name=label or str(path),
            expected=expected.lower(),
            actual=actual.lower(),
        )


def decompress_zstd(src: Path, dst: Path) -> None:
    """Stream-decompress ``src`` (zstd) into ``dst``.

    Uses the ``zstandard`` package's ``copy_stream`` so a 3 GiB image
    decompresses with bounded memory. The package is declared in
    ``backend/requirements.txt``.
    """
    try:
        import zstandard
    except ImportError as exc:  # pragma: no cover - environment defect
        raise DecompressionError(
            "the 'zstandard' package is required to decompress .zst assets"
        ) from exc

    dctx = zstandard.ZstdDecompressor()
    try:
        with src.open("rb") as fin, dst.open("wb") as fout:
            dctx.copy_stream(
                fin, fout, read_size=_READ_CHUNK, write_size=_READ_CHUNK,
            )
    except zstandard.ZstdError as exc:
        raise DecompressionError(f"zstd decode failed: {exc}") from exc
