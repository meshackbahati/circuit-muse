"""
test_dual_esp32_serial.py
=========================

Backend integration test: two ESP32 QEMU instances, both running the
SerialPassthrough sketch on UART2 (GPIO16/17), bridged via the same
Interconnect logic the frontend uses.

Architecture
------------
    [host]  ──USB Serial──>  [ESP32-A QEMU]   <──UART2/GPIO16/17──>   [ESP32-B QEMU]  ──USB Serial──> [host]

Each ESP32 instance runs a copy of `serial_passthrough.ino`. The
Python harness:
  1. Spins up two `Esp32LibBridge` instances (one per emulated ESP32),
     each loaded with the same merged firmware.
  2. Wires their `on_serial_data` / `uart_send` (UART2) so that a byte
     emitted by A on Serial2 gets fed into B's Serial2 RX, and vice
     versa.  This mirrors what `frontend/src/simulation/Interconnect.ts`
     does in the browser.
  3. Sends "PING-A\\n" on A's USB Serial; expects to read it back on
     B's USB Serial output.

Skips
-----
This test is heavy (~5–10 min, two QEMU/lcgamboa libs + arduino-cli
ESP32 toolchain).  It auto-skips when:
  - the lcgamboa ESP32 emulator DLL is missing (the typical CI shape),
  - or no `serial_passthrough.ino.merged.bin` is present alongside.

Run locally:
    cd <repo>
    python -m pytest test/multi_board_esp32/test_dual_esp32_serial.py -v
"""

import asyncio
import os
import pathlib
import sys
import time
import unittest

_REPO = pathlib.Path(__file__).parent.parent.parent
_BACKEND = _REPO / "backend"
sys.path.insert(0, str(_BACKEND))

# Firmware compiled from the .ino in this folder. Build with:
#   arduino-cli compile --fqbn esp32:esp32:esp32 \
#     --output-dir test/multi_board_esp32/out \
#     test/multi_board_esp32/sketches/serial_passthrough
#   esptool.py --chip esp32 merge_bin --fill-flash-size 4MB \
#     -o test/multi_board_esp32/serial_passthrough.merged.bin \
#     --flash_mode dio --flash_size 4MB \
#     0x1000 test/multi_board_esp32/out/serial_passthrough.ino.bootloader.bin \
#     0x8000 test/multi_board_esp32/out/serial_passthrough.ino.partitions.bin \
#     0x10000 test/multi_board_esp32/out/serial_passthrough.ino.bin
_FW_PATH = pathlib.Path(__file__).parent / "serial_passthrough.merged.bin"

try:
    from app.services.esp32_lib_bridge import Esp32LibBridge  # type: ignore
    from app.services.esp32_lib_manager import LIB_PATH  # type: ignore

    _DLL_AVAILABLE = bool(LIB_PATH) and os.path.isfile(LIB_PATH)
except Exception:
    _DLL_AVAILABLE = False
    Esp32LibBridge = None  # type: ignore

_FW_AVAILABLE = _FW_PATH.is_file()
_SKIP = (
    not _DLL_AVAILABLE
    or not _FW_AVAILABLE
    or os.environ.get("SKIP_LIB_INTEGRATION", "") == "1"
)


@unittest.skipIf(_SKIP, "ESP32 lcgamboa lib or firmware not available")
class DualEsp32SerialTest(unittest.IsolatedAsyncioTestCase):
    """Two ESP32 QEMU instances exchange bytes over UART2."""

    async def asyncSetUp(self):
        self.bridge_a = Esp32LibBridge("esp-a")
        self.bridge_b = Esp32LibBridge("esp-b")

        self.usb_serial_a: list[str] = []
        self.usb_serial_b: list[str] = []

        # Wire UART0 (USB Serial) sinks for the host
        self.bridge_a.on_serial_data = lambda ch, uart=0: self._on_uart(
            self.usb_serial_a, self.bridge_b, ch, uart
        )
        self.bridge_b.on_serial_data = lambda ch, uart=0: self._on_uart(
            self.usb_serial_b, self.bridge_a, ch, uart
        )

        await self.bridge_a.start(_FW_PATH)
        await self.bridge_b.start(_FW_PATH)
        # Give both ESP32s a chance to boot and print READY
        await asyncio.sleep(2.0)

    async def asyncTearDown(self):
        await self.bridge_a.stop()
        await self.bridge_b.stop()

    def _on_uart(self, sink: list[str], peer, ch: str, uart: int) -> None:
        """Mirror of the frontend Interconnect's UART byte-shortcut.

        UART0 = USB Serial → goes to the host transcript.
        UART2 = GPIO16/17 = the cross-board wire → forward to peer's UART2 RX.
        """
        if uart == 0:
            sink.append(ch)
        elif uart == 2:
            # Wire-routing: A.UART2 TX → B.UART2 RX
            peer.uart_send(ord(ch), uart=2)

    async def test_pi_a_sees_byte_from_b(self):
        # Send via A's USB Serial — sketch forwards to A.Serial2 → wire → B.Serial2
        # → sketch on B forwards to B's USB Serial.  Host reads it on bridge_b.
        line = "HELLO_FROM_A\n"
        for ch in line:
            self.bridge_a.uart_send(ord(ch), uart=0)

        # Wait up to 5 s for the round-trip
        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline:
            if "HELLO_FROM_A" in "".join(self.usb_serial_b):
                break
            await asyncio.sleep(0.05)

        self.assertIn("HELLO_FROM_A", "".join(self.usb_serial_b))

    async def test_pi_b_sees_byte_from_a(self):
        line = "PING_FROM_B\n"
        for ch in line:
            self.bridge_b.uart_send(ord(ch), uart=0)

        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline:
            if "PING_FROM_B" in "".join(self.usb_serial_a):
                break
            await asyncio.sleep(0.05)

        self.assertIn("PING_FROM_B", "".join(self.usb_serial_a))


if __name__ == "__main__":
    unittest.main(verbosity=2)
