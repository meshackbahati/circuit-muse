"""ESP32 + Custom Chip I2C round-trip — the full architecture validated end-to-end.

This is the test that proves the WASM-in-backend approach works:

  - Compile the user's chip C source via /api/compile-chip → wasm_b64.
  - Compile an Arduino sketch (Wire.h) via /api/compile/ → firmware_b64.
  - Send both to the backend in a single `start_esp32` payload.
  - The backend's worker subprocess loads the chip's WASM in-process,
    registers it as an I2C slave (synchronous to QEMU), and boots the firmware.
  - The sketch's Wire.beginTransmission/endTransmission/requestFrom calls all
    end up calling the chip's WASM I2C callbacks SYNCHRONOUSLY — no WebSocket
    round-trip, no race condition.
  - The four bytes (0xAA..0xDD) flow back to the sketch via Serial output,
    proving the chain works end-to-end.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import pathlib

import pytest
import websockets

from .conftest import REPO_ROOT, BACKEND_URL, WS_URL


# Pre-flight: ESP32 backend must be available (lcgamboa libqemu-xtensa).
def _esp32_available() -> bool:
    services_dir = REPO_ROOT / "backend" / "app" / "services"
    for name in ("libqemu-xtensa.dll", "libqemu-xtensa.so"):
        if (services_dir / name).is_file():
            return True
    if os.environ.get("QEMU_ESP32_LIB") and pathlib.Path(os.environ["QEMU_ESP32_LIB"]).is_file():
        return True
    return False


SKIP_REASON: str | None = None
if not _esp32_available():
    SKIP_REASON = (
        "ESP32 backend toolchain unavailable (libqemu-xtensa not in backend/app/services/). "
        "See test/test_custom_chips_boards/test_esp32_gpio_bridge.py docstring for setup."
    )

pytestmark = pytest.mark.skipif(SKIP_REASON is not None, reason=SKIP_REASON or "")


_SKETCH_PATH = (
    REPO_ROOT
    / "test" / "test_custom_chips_boards" / "sketches" / "esp32_eeprom_demo"
    / "esp32_eeprom_demo.ino"
)
_CHIP_C_PATH = (
    REPO_ROOT / "test" / "test_custom_chips" / "sdk" / "examples" / "eeprom-24c01.c"
)


async def _wait_for_serial_text(ws, needle: str, *, timeout: float = 30.0) -> str:
    buf = ""
    deadline = asyncio.get_event_loop().time() + timeout
    while needle not in buf:
        remaining = deadline - asyncio.get_event_loop().time()
        if remaining <= 0:
            raise asyncio.TimeoutError(f"serial never contained {needle!r}; got {buf!r}")
        raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
        try:
            msg = json.loads(raw)
        except Exception:
            continue
        if msg.get("type") == "serial_output":
            buf += str(msg.get("data", {}).get("data", ""))
    return buf


@pytest.mark.asyncio
async def test_esp32_sketch_talks_to_wasm_eeprom_chip(http):
    """Full round-trip: ESP32 sketch ↔ user-supplied 24C01 chip running in the QEMU worker."""

    # ── 1. Compile the chip WASM ───────────────────────────────────────────────
    chip_c = _CHIP_C_PATH.read_text(encoding="utf-8")
    res = await http.post("/api/compile-chip/", json={"source": chip_c}, timeout=120.0)
    assert res.status_code == 200, res.text
    chip_data = res.json()
    assert chip_data["success"], f"chip compile failed: {chip_data.get('stderr', '')}"
    wasm_b64 = chip_data["wasm_base64"]
    assert wasm_b64, "no wasm_base64 in chip compile response"

    # ── 2. Compile the ESP32 sketch ────────────────────────────────────────────
    sketch_ino = _SKETCH_PATH.read_text(encoding="utf-8")
    res = await http.post(
        "/api/compile/",
        json={
            "files": [{"name": "esp32_eeprom_demo.ino", "content": sketch_ino}],
            "board_fqbn": "esp32:esp32:esp32",
        },
        timeout=300.0,
    )
    assert res.status_code == 200, res.text
    sketch_data = res.json()
    if not sketch_data.get("success"):
        pytest.skip(
            f"ESP32 sketch compile failed on this backend: "
            f"{sketch_data.get('error')}\n{sketch_data.get('stderr', '')[:600]}"
        )
    firmware_b64 = sketch_data.get("binary_content")
    assert firmware_b64, f"sketch built but no binary_content; full response: {sketch_data}"

    # ── 3. Boot ESP32 with the chip attached as a custom-chip sensor ────────────
    ws_url = f"{WS_URL}/api/simulation/ws/test-custom-chip-esp32-i2c"

    async with websockets.connect(ws_url, max_size=16 * 1024 * 1024) as ws:
        await ws.send(json.dumps({
            "type": "start_esp32",
            "data": {
                "board": "esp32",
                "firmware_b64": firmware_b64,
                "sensors": [
                    {
                        "sensor_type": "custom-chip",
                        "pin": 0,                # virtual / unused
                        "wasm_b64": wasm_b64,
                        "attrs": {},
                    },
                ],
            },
        }))

        # ── 4. Wait for sketch boot banner ─────────────────────────────────────
        await _wait_for_serial_text(ws, "READY", timeout=60.0)

        # ── 5. Wait for DONE marker (after 4 BYTE=… lines) ─────────────────────
        full_serial = await _wait_for_serial_text(ws, "DONE", timeout=30.0)

        # ── 6. Assert the four bytes appear in the right order ─────────────────
        # Sketch prints "BYTE=170" / "BYTE=187" / "BYTE=204" / "BYTE=221" sequentially.
        for expected in ("BYTE=170", "BYTE=187", "BYTE=204", "BYTE=221"):
            assert expected in full_serial, (
                f"missing {expected} in serial output; got: {full_serial!r}"
            )
        # And in order
        idx = [full_serial.index(s) for s in ("BYTE=170", "BYTE=187", "BYTE=204", "BYTE=221")]
        assert idx == sorted(idx), f"bytes out of order: indices {idx}"

        await ws.send(json.dumps({"type": "stop_esp32"}))
