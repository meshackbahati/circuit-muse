"""ESP32 WebSocket bridge round-trip — same path a custom chip uses.

This test validates the bridge that links the browser's ChipInstance to the
backend's ESP32 QEMU. We don't load a real custom chip here (chips run in
the browser); instead we drive the WebSocket from Python, mimicking what the
ChipInstance would do via Esp32BridgeShim.

Sketch: `test/esp32-emulator/sketches/serial_led/serial_led.ino` (pre-built
merged binary at `test/esp32-emulator/binaries_lcgamboa/serial_led.ino.merged.bin`).

Round-trip we exercise:
  Python ──"LED_ON\\n"──▶ esp32_serial_input ──▶ ESP32 ──▶ digitalWrite(2,HIGH)
                                                      │
                                                      ├──▶ gpio_change pin=2 state=1
                                                      └──▶ serial_output "OK:ON"

That's the exact path a custom chip would take when its `vx_uart_write` reaches
the AVR's USART (via simulator bridge → ESP32 firmware → ESP32 GPIO event →
chip's `vx_pin_watch`).
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import pathlib
import shutil
import subprocess

import pytest
import websockets

from .conftest import REPO_ROOT, WS_URL


_FW_PATH = REPO_ROOT / "test" / "esp32-emulator" / "binaries_lcgamboa" / "serial_led.ino.merged.bin"


def _esp32_backend_available() -> tuple[bool, str]:
    """Return (available, reason).

    The backend can run ESP32 if any of these is true:
      1. The lcgamboa libqemu-xtensa library is present at the standard
         backend path `backend/app/services/libqemu-xtensa.{dll,so}` (this is
         what the docker image bundles via Dockerfile.standalone stage 0).
      2. `$QEMU_ESP32_LIB` env var points to a valid library file.
      3. An upstream `qemu-system-xtensa` binary supports the `esp32` machine
         (rare — Espressif's fork is what most users have).
    """
    # Option 1+2: lcgamboa library in the backend tree or env var
    services_dir = REPO_ROOT / "backend" / "app" / "services"
    lib_candidates: list[pathlib.Path] = []
    env_lib = os.environ.get("QEMU_ESP32_LIB")
    if env_lib:
        lib_candidates.append(pathlib.Path(env_lib))
    lib_candidates.extend([
        services_dir / "libqemu-xtensa.dll",
        services_dir / "libqemu-xtensa.so",
    ])
    for p in lib_candidates:
        if p.is_file():
            return True, f"lcgamboa libqemu-xtensa found at {p}"

    # Option 3: upstream qemu-system-xtensa with esp32 machine
    qemu = shutil.which("qemu-system-xtensa") or shutil.which("qemu-system-xtensa.exe")
    if qemu:
        try:
            res = subprocess.run(
                [qemu, "-machine", "help"], capture_output=True, text=True, timeout=10
            )
            if "esp32" in (res.stdout or "").lower():
                return True, "qemu-system-xtensa supports esp32"
        except Exception:
            pass

    return False, (
        "ESP32 backend toolchain unavailable: drop the lcgamboa libqemu-xtensa.{dll,so} "
        "into backend/app/services/ (the Dockerfile.standalone bundles it; you can "
        "`docker cp velxio-dev:/app/app/services/libqemu-xtensa.dll <local>` from a "
        "running velxio container), or run pytest inside the container."
    )


SKIP_REASON: str | None = None
if not _FW_PATH.is_file():
    SKIP_REASON = f"missing firmware: {_FW_PATH}"
elif os.environ.get("SKIP_ESP32_INTEGRATION") == "1":
    SKIP_REASON = "SKIP_ESP32_INTEGRATION=1"
else:
    available, why = _esp32_backend_available()
    if not available:
        SKIP_REASON = why


pytestmark = pytest.mark.skipif(SKIP_REASON is not None, reason=SKIP_REASON or "")


async def _wait_for_serial_text(ws, needle: str, *, timeout: float = 30.0) -> str:
    """Accumulate `serial_output` chunks until `needle` appears. Returns full buffer."""
    buf = ""
    deadline = asyncio.get_event_loop().time() + timeout
    while needle not in buf:
        remaining = deadline - asyncio.get_event_loop().time()
        if remaining <= 0:
            raise asyncio.TimeoutError(f"serial_output never contained {needle!r} (got: {buf!r})")
        raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
        try:
            msg = json.loads(raw)
        except Exception:
            continue
        if msg.get("type") == "serial_output":
            buf += str(msg.get("data", {}).get("data", ""))
    return buf


@pytest.mark.asyncio
async def test_esp32_serial_to_gpio_round_trip():
    """
    Drive the ESP32 over UART0 (the chip→ESP32 direction) and observe both the
    GPIO change and the echoed serial reply (the ESP32→chip direction).
    """
    fw_b64 = base64.b64encode(_FW_PATH.read_bytes()).decode("ascii")
    ws_url = f"{WS_URL}/api/simulation/ws/test-custom-chip-esp32"

    async with websockets.connect(ws_url, max_size=8 * 1024 * 1024) as ws:
        # ── 1. Boot the ESP32 with our firmware ────────────────────────────────
        await ws.send(json.dumps({
            "type": "start_esp32",
            "data": {"board": "esp32", "firmware_b64": fw_b64},
        }))

        # ── 2. Wait for the sketch's READY banner on UART0 ─────────────────────
        await _wait_for_serial_text(ws, "READY", timeout=45.0)

        # ── 3. Send LED_ON, expect both gpio_change(pin=2,state=1) AND OK:ON ───
        cmd = b"LED_ON\n"
        await ws.send(json.dumps({
            "type": "esp32_serial_input",
            "data": {"bytes": list(cmd), "uart": 0},
        }))

        # The ESP32 emits both events around the same time; wait for either,
        # then for the other one. Concurrent buffering keeps us from missing.
        seen_high = False
        seen_ok_on = False
        deadline = asyncio.get_event_loop().time() + 15.0
        serial_buf = ""
        while not (seen_high and seen_ok_on):
            remaining = deadline - asyncio.get_event_loop().time()
            assert remaining > 0, (
                f"timeout waiting for LED_ON response — "
                f"seen_high={seen_high} seen_ok_on={seen_ok_on} buf={serial_buf!r}"
            )
            raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
            msg = json.loads(raw)
            t = msg.get("type")
            if t == "gpio_change":
                d = msg.get("data", {})
                if d.get("pin") == 2 and d.get("state") in (1, True):
                    seen_high = True
            elif t == "serial_output":
                serial_buf += str(msg.get("data", {}).get("data", ""))
                if "OK:ON" in serial_buf:
                    seen_ok_on = True

        # ── 4. Send LED_OFF, expect gpio_change(pin=2,state=0) AND OK:OFF ──────
        await ws.send(json.dumps({
            "type": "esp32_serial_input",
            "data": {"bytes": list(b"LED_OFF\n"), "uart": 0},
        }))

        seen_low = False
        seen_ok_off = False
        deadline = asyncio.get_event_loop().time() + 15.0
        serial_buf = ""
        while not (seen_low and seen_ok_off):
            remaining = deadline - asyncio.get_event_loop().time()
            assert remaining > 0, (
                f"timeout waiting for LED_OFF response — "
                f"seen_low={seen_low} seen_ok_off={seen_ok_off} buf={serial_buf!r}"
            )
            raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
            msg = json.loads(raw)
            t = msg.get("type")
            if t == "gpio_change":
                d = msg.get("data", {})
                if d.get("pin") == 2 and d.get("state") in (0, False):
                    seen_low = True
            elif t == "serial_output":
                serial_buf += str(msg.get("data", {}).get("data", ""))
                if "OK:OFF" in serial_buf:
                    seen_ok_off = True

        # ── 5. Cleanly stop the QEMU instance ──────────────────────────────────
        await ws.send(json.dumps({"type": "stop_esp32"}))


@pytest.mark.asyncio
async def test_esp32_ping_round_trip():
    """Lighter-weight check: PING ↔ PONG, no GPIO. Confirms full duplex works."""
    fw_b64 = base64.b64encode(_FW_PATH.read_bytes()).decode("ascii")
    ws_url = f"{WS_URL}/api/simulation/ws/test-custom-chip-esp32-ping"

    async with websockets.connect(ws_url, max_size=8 * 1024 * 1024) as ws:
        await ws.send(json.dumps({
            "type": "start_esp32",
            "data": {"board": "esp32", "firmware_b64": fw_b64},
        }))
        await _wait_for_serial_text(ws, "READY", timeout=45.0)

        await ws.send(json.dumps({
            "type": "esp32_serial_input",
            "data": {"bytes": list(b"PING\n"), "uart": 0},
        }))
        out = await _wait_for_serial_text(ws, "PONG", timeout=10.0)
        assert "PONG" in out

        await ws.send(json.dumps({"type": "stop_esp32"}))
