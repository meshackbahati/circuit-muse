"""Helpers for ESP32 flash images shared between the in-process bridge and
the subprocess worker.

The ESP-IDF compiler in `espidf_compiler.py` builds a full 4 MB merged flash
image and then **trims the trailing 0xFF padding** before serializing the
binary into the JSON compile response (issue #101 — sending the full 4 MB
gave a ~5.5 MB base64 string that nginx / Cloudflare would buffer-fail with
"No response from server"). The frontend stores the trimmed bytes; this
module re-pads them on the receiving side just before QEMU attaches the
image as an MTD drive — QEMU rejects flash sizes that aren't a power-of-2
megabyte (2 / 4 / 8 / 16 MB).

This is a lossless round trip: bytes after `last_used` in the compiler's
merge are 0xFF by construction, so trim → pad reproduces the original
image byte-for-byte.
"""

from __future__ import annotations

# Sizes QEMU's esp32-picsimlab MTD layer accepts. ESP32 / S3 / C3 builds
# all default to 4 MB (CONFIG_ESPTOOLPY_FLASHSIZE_4MB). We only ever
# round UP — never down.
_VALID_FLASH_SIZES = [s * 1024 * 1024 for s in (2, 4, 8, 16)]
_MIN_FLASH_BYTES = 4 * 1024 * 1024


def pad_to_flash_size(fw_bytes: bytes) -> bytes:
    """Pad `fw_bytes` with 0xFF up to the next valid QEMU flash size.

    Returns the input unchanged when it's already at or above a valid size.
    Raises `ValueError` if the firmware exceeds the largest size we accept
    (16 MB) — at that point something is wrong with the upstream merge.
    """
    target = next(
        (s for s in _VALID_FLASH_SIZES if s >= max(len(fw_bytes), _MIN_FLASH_BYTES)),
        None,
    )
    if target is None:
        raise ValueError(
            f'ESP32 firmware too large for QEMU: {len(fw_bytes)} bytes (max 16 MB)'
        )
    if len(fw_bytes) >= target:
        return fw_bytes
    return fw_bytes + b'\xff' * (target - len(fw_bytes))
