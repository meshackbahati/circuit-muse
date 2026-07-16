"""ESP32 + SPI chip round-trip via the backend WASM runtime.

Sketch wires GPIOs to a 74HC595 chip running in the backend:
  - SPI.transfer(0xA5) → _on_spi_event → chip's vx_spi_start buffer fills
    with 0xA5 → chip's on_done stores it in shift_reg
  - Sketch pulses RCLK (a GPIO output via qemu_picsimlab_set_pin) → chip's
    vx_pin_watch on RCLK fires (synchronously, in QEMU thread) → chip
    latches shift_reg to Q0..Q7 via vx_pin_write → those calls hit
    qemu_picsimlab_set_pin → ESP32's GPIO inputs read 0xA5 LSB-first.

This is the strictest end-to-end test we have: it exercises SPI transfer +
pin_watch (edge detection) + GPIO output from chip → real GPIO IN read by
firmware. Every link of the chain runs synchronously inside the worker.
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
    SKIP_REASON = "ESP32 backend toolchain unavailable"

pytestmark = pytest.mark.skipif(SKIP_REASON is not None, reason=SKIP_REASON or "")


_SKETCH_PATH = (
    REPO_ROOT / "test" / "test_custom_chips_boards"
    / "sketches" / "esp32_spi_chip_demo" / "esp32_spi_chip_demo.ino"
)
_CHIP_C_PATH = (
    REPO_ROOT / "test" / "test_custom_chips" / "sdk" / "examples" / "sn74hc595.c"
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
async def test_esp32_sketch_drives_74hc595_chip_via_spi(http):
    chip_c = _CHIP_C_PATH.read_text(encoding="utf-8")
    sketch_ino = _SKETCH_PATH.read_text(encoding="utf-8")

    res = await http.post("/api/compile-chip/", json={"source": chip_c}, timeout=120.0)
    assert res.status_code == 200, res.text
    chip_data = res.json()
    assert chip_data["success"], chip_data
    wasm_b64 = chip_data["wasm_base64"]

    res = await http.post(
        "/api/compile/",
        json={
            "files": [{"name": "esp32_spi_chip_demo.ino", "content": sketch_ino}],
            "board_fqbn": "esp32:esp32:esp32",
        },
        timeout=300.0,
    )
    assert res.status_code == 200, res.text
    sketch_data = res.json()
    if not sketch_data.get("success"):
        pytest.skip(f"ESP32 sketch compile failed: {sketch_data.get('stderr', '')[:600]}")
    firmware_b64 = sketch_data["binary_content"]

    pin_map = {
        "SER":   23,
        "SRCLK": 18,
        "RCLK":  5,
        "SRCLR": 22,
        "OE":    21,
        "QH":    19,
        "Q0":    13,
        "Q1":    14,
        "Q2":    15,
        "Q3":    16,
        "Q4":    17,
        "Q5":    25,
        "Q6":    26,
        "Q7":    27,
    }

    ws_url = f"{WS_URL}/api/simulation/ws/test-custom-chip-esp32-spi"
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
                        "pin_map": pin_map,
                    },
                ],
            },
        }))

        await _wait_for_serial_text(ws, "READY", timeout=60.0)
        full = await _wait_for_serial_text(ws, "Q=", timeout=30.0)

        # Find the Q=... line and extract its 8 bits.
        for line in full.splitlines():
            if line.startswith("Q="):
                q_pattern = line[2:].strip()
                break
        else:
            pytest.fail(f"no Q= line in serial output: {full!r}")

        # 0xA5 = 10100101 LSB-first → Q0=1,Q1=0,Q2=1,Q3=0,Q4=0,Q5=1,Q6=0,Q7=1
        # Sketch prints them in pin order (Q0 first), so the pattern is "10100101".
        assert q_pattern == "10100101", (
            f"chip should latch 0xA5 LSB-first to Q0..Q7; expected '10100101', got {q_pattern!r}\n"
            f"full serial: {full!r}"
        )

        await ws.send(json.dumps({"type": "stop_esp32"}))
