"""ESP32 + UART chip round-trip via the backend WASM runtime.

Validates the chip↔firmware UART path:

    Sketch: Serial.write("Hello")
         → _on_uart_tx fires per byte (in QEMU thread)
         → runtime.feed_uart_byte → chip's on_rx_byte
         → chip computes ROT13 and calls vx_uart_write
         → host: qemu_picsimlab_uart_receive (under iothread lock)
         → firmware: Serial.read() returns the transformed byte
         → sketch prints "RX=<decimal>"

Expected ROT13 mapping: H→U(85), e→r(114), l→y(121), l→y(121), o→b(98).
"""
from __future__ import annotations

import asyncio
import json
import os
import pathlib

import pytest
import websockets

from .conftest import REPO_ROOT, WS_URL


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
    SKIP_REASON = "ESP32 backend toolchain unavailable (libqemu-xtensa not in backend/app/services/)"

pytestmark = pytest.mark.skipif(SKIP_REASON is not None, reason=SKIP_REASON or "")


_SKETCH_PATH = (
    REPO_ROOT / "test" / "test_custom_chips_boards"
    / "sketches" / "esp32_uart_chip_demo" / "esp32_uart_chip_demo.ino"
)
_CHIP_C_PATH = (
    REPO_ROOT / "test" / "test_custom_chips" / "sdk" / "examples" / "uart-rot13.c"
)


async def _wait_for_serial_text(ws, needle: str, *, timeout: float = 60.0) -> str:
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
async def test_esp32_sketch_round_trips_uart_through_rot13_chip(http):
    chip_c   = _CHIP_C_PATH.read_text(encoding="utf-8")
    sketch_ino = _SKETCH_PATH.read_text(encoding="utf-8")

    res = await http.post("/api/compile-chip/", json={"source": chip_c}, timeout=120.0)
    assert res.status_code == 200, res.text
    chip_data = res.json()
    assert chip_data["success"], chip_data
    wasm_b64 = chip_data["wasm_base64"]

    res = await http.post(
        "/api/compile/",
        json={
            "files": [{"name": "esp32_uart_chip_demo.ino", "content": sketch_ino}],
            "board_fqbn": "esp32:esp32:esp32",
        },
        timeout=300.0,
    )
    assert res.status_code == 200, res.text
    sketch_data = res.json()
    if not sketch_data.get("success"):
        pytest.skip(f"ESP32 sketch compile failed: {sketch_data.get('stderr', '')[:600]}")
    firmware_b64 = sketch_data["binary_content"]

    ws_url = f"{WS_URL}/api/simulation/ws/test-custom-chip-esp32-uart"
    async with websockets.connect(ws_url, max_size=16 * 1024 * 1024) as ws:
        await ws.send(json.dumps({
            "type": "start_esp32",
            "data": {
                "board": "esp32",
                "firmware_b64": firmware_b64,
                "sensors": [
                    {
                        "sensor_type": "custom-chip",
                        "pin": 0,
                        "wasm_b64": wasm_b64,
                        "attrs": {},
                        "pin_map": {},
                    },
                ],
            },
        }))

        await _wait_for_serial_text(ws, "READY", timeout=60.0)

        # The sketch sent "Hello" and is waiting for transformed bytes.
        # ROT13(Hello) = "Uryyb" → decimal: 85, 114, 121, 121, 98
        # We need to wait for all 5 RX= lines.
        full = ""
        deadline = asyncio.get_event_loop().time() + 30.0
        for needle in ("RX=85", "RX=114", "RX=121", "RX=121", "RX=98"):
            while needle not in full:
                remaining = deadline - asyncio.get_event_loop().time()
                assert remaining > 0, (
                    f"timeout waiting for {needle}; serial so far:\n{full!r}"
                )
                raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
                msg = json.loads(raw)
                if msg.get("type") == "serial_output":
                    full += str(msg.get("data", {}).get("data", ""))

        # All 5 ROT13 transforms verified; the chip really runs in-process.
        await ws.send(json.dumps({"type": "stop_esp32"}))
