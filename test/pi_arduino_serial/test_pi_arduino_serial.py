#!/usr/bin/env python3
"""
Pi <-> Arduino Serial Integration Test
=======================================

What this test proves
---------------------
Python code running on an **emulated Raspberry Pi 3B** (QEMU) sends the
string "HELLO_FROM_PI" over its UART serial port (ttyAMA0).
An **emulated Arduino Uno** (avr8js, via Node.js) receives it and replies
"ACK_FROM_ARDUINO".
The Pi receives that reply and prints "TEST_PASSED".

Architecture
------------

  Pi ttyAMA0 <-> TCP:15555 <-> [SerialBroker] <-> TCP:15556 <-> avr_runner.js
                                      |
                              (state machine automates Pi console)

Prerequisites
-------------
  - qemu-system-aarch64 in PATH
  - node (Node.js >= 18) in PATH
  - arduino-cli in PATH, with arduino:avr core installed
  - QEMU images in <repo>/img/:
      kernel8.img    (64-bit ARM64 Pi3 kernel)
      bcm271~1.dtb   (BCM2710 device tree)
      2025-12-04-raspios-trixie-armhf.img

Run
---
  cd <repo>
  python test/pi_arduino_serial/test_pi_arduino_serial.py
"""

import asyncio
import base64
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Optional

# Set UTF-8 for Windows console output
if sys.platform == "win32":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# || Paths ||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||
REPO_ROOT   = Path(__file__).resolve().parent.parent.parent
IMG_DIR     = REPO_ROOT / "img"
TEST_DIR    = Path(__file__).resolve().parent

SKETCH_FILE = TEST_DIR / "arduino_sketch.ino"
AVR_RUNNER  = TEST_DIR / "avr_runner.js"

KERNEL_IMG  = IMG_DIR / "kernel8.img"
DTB_FILE    = IMG_DIR / "bcm271~1.dtb"
SD_IMAGE    = IMG_DIR / "2025-12-04-raspios-trixie-armhf.img"

# || Network ports |||||||||||||||||||||||||||||||||||||||||||||||||||||||||||
BROKER_PI_PORT  = 15555
BROKER_AVR_PORT = 15556

# || Timeouts ||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||
BOOT_TIMEOUT_S    = 120   # 2 min -- Pi boots in ~5-30s with init=/bin/sh
SCRIPT_TIMEOUT_S  = 45    # script execution after prompt seen
COMPILE_TIMEOUT_S = 120   # arduino-cli

# || Pi console state-machine ||||||||||||||||||||||||||||||||||||||||||||||||
ST_BOOT   = "BOOT"
ST_SETUP  = "SETUP"
ST_INJECT = "INJECT"
ST_DONE   = "DONE"

PROMPT_BYTES = [b"# ", b"$ "]

# || Pi test script (base64-encoded and injected into the Pi shell) ||||||||||
_PI_SCRIPT_SRC = b"""\
import sys, os, time, select

sys.stdout.write("HELLO_FROM_PI\\n")
sys.stdout.flush()

resp = b""
deadline = time.time() + 15

while time.time() < deadline:
    readable, _, _ = select.select([sys.stdin], [], [], 1.0)
    if readable:
        chunk = os.read(sys.stdin.fileno(), 256)
        resp += chunk
        if b"ACK_FROM_ARDUINO" in resp:
            sys.stdout.write("TEST_PASSED\\n")
            sys.stdout.flush()
            sys.exit(0)

sys.stdout.write("TEST_FAILED_TIMEOUT\\n")
sys.stdout.flush()
sys.exit(1)
"""

_PI_B64 = base64.b64encode(_PI_SCRIPT_SRC).decode()
_PI_CMD = (
    "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
    " && stty -echo"
    f" && printf '%s' '{_PI_B64}' | /usr/bin/base64 -d > /tmp/pi_test.py"
    " && /usr/bin/python3 /tmp/pi_test.py"
    "\n"
)

# Max bytes to keep in the Pi receive buffer (only need last N bytes for prompts)
_PI_BUF_MAX = 8192


# ||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||
class SerialBroker:
    """
    TCP broker bridging emulated Pi (QEMU) <-> emulated Arduino (avr_runner.js).
    Automates the Pi serial console via a state machine.
    """

    def __init__(self) -> None:
        self._pi_reader:  Optional[asyncio.StreamReader]  = None
        self._pi_writer:  Optional[asyncio.StreamWriter]  = None
        self._avr_reader: Optional[asyncio.StreamReader]  = None
        self._avr_writer: Optional[asyncio.StreamWriter]  = None

        # Rolling window of Pi output for prompt matching
        self._pi_buf: bytearray = bytearray()

        # Accumulated Pi output lines for human-readable logging
        self._pi_line_buf: str = ""

        self._state = ST_BOOT
        self._script_deadline: float = 0.0

        self.pi_connected  = asyncio.Event()
        self.avr_connected = asyncio.Event()
        self.result_event  = asyncio.Event()
        self.test_passed   = False

        # Background relay tasks (kept so we can cancel them)
        self._relay_tasks: list[asyncio.Task] = []

    # || Server callbacks |||||||||||||||||||||||||||||||||||||||||||||||||||
    async def _on_pi_connect(self, r: asyncio.StreamReader,
                              w: asyncio.StreamWriter) -> None:
        print(f"[broker] Pi (QEMU) connected from {w.get_extra_info('peername')}")
        self._pi_reader = r
        self._pi_writer = w
        self.pi_connected.set()

    async def _on_avr_connect(self, r: asyncio.StreamReader,
                               w: asyncio.StreamWriter) -> None:
        print(f"[broker] Arduino (avr_runner.js) connected from {w.get_extra_info('peername')}")
        self._avr_reader = r
        self._avr_writer = w
        self.avr_connected.set()

    # || Start servers ||||||||||||||||||||||||||||||||||||||||||||||||||||||
    async def start(self):
        pi_srv = await asyncio.start_server(
            self._on_pi_connect, "127.0.0.1", BROKER_PI_PORT)
        avr_srv = await asyncio.start_server(
            self._on_avr_connect, "127.0.0.1", BROKER_AVR_PORT)
        print(f"[broker] Listening -- Pi:{BROKER_PI_PORT}  Arduino:{BROKER_AVR_PORT}")
        return pi_srv, avr_srv

    # || Start relay tasks |||||||||||||||||||||||||||||||||||||||||||||||||
    def start_relay(self) -> None:
        loop = asyncio.get_event_loop()
        self._relay_tasks = [
            loop.create_task(self._relay_pi_to_avr()),
            loop.create_task(self._relay_avr_to_pi()),
            loop.create_task(self._console_automator()),
        ]

    def cancel_relay(self) -> None:
        for t in self._relay_tasks:
            t.cancel()

    # || Pi -> Arduino |||||||||||||||||||||||||||||||||||||||||||||||||||||||
    async def _relay_pi_to_avr(self) -> None:
        reader = self._pi_reader
        if not reader:
            return
        while True:
            try:
                data = await reader.read(512)
            except Exception:
                break
            if not data:
                break

            # Append to rolling buffer, cap size to avoid unbounded growth
            self._pi_buf.extend(data)
            if len(self._pi_buf) > _PI_BUF_MAX:
                del self._pi_buf[:len(self._pi_buf) - _PI_BUF_MAX]

            # Log Pi output as lines (not char-by-char)
            self._pi_line_buf += data.decode("utf-8", errors="replace")
            while "\n" in self._pi_line_buf:
                line, self._pi_line_buf = self._pi_line_buf.split("\n", 1)
                stripped = line.strip()
                if stripped:
                    print(f"  [Pi->AVR] {stripped}")

            # Only forward Pi output to Arduino once the test script is running.
            # Kernel boot messages must not flood the AVR USART RX queue.
            if (self._state == ST_INJECT
                    and self._avr_writer
                    and not self._avr_writer.is_closing()):
                self._avr_writer.write(data)
                await self._avr_writer.drain()

    # || Arduino -> Pi |||||||||||||||||||||||||||||||||||||||||||||||||||||||
    async def _relay_avr_to_pi(self) -> None:
        reader = self._avr_reader
        if not reader:
            return
        while True:
            try:
                data = await reader.read(512)
            except Exception:
                break
            if not data:
                break

            text = data.decode("utf-8", errors="replace").strip()
            if text:
                print(f"  [AVR->Pi] {text}")

            if self._pi_writer and not self._pi_writer.is_closing():
                self._pi_writer.write(data)
                await self._pi_writer.drain()

    # || Console state machine |||||||||||||||||||||||||||||||||||||||||||||
    async def _console_automator(self) -> None:
        boot_deadline  = time.monotonic() + BOOT_TIMEOUT_S
        last_poke_time = time.monotonic()

        # Small delay before first poke so QEMU starts outputting
        await asyncio.sleep(3.0)
        self._send_to_pi(b"\n")
        print(f"[broker] Waiting for shell prompt (boot timeout: {BOOT_TIMEOUT_S}s) ...")

        while self._state != ST_DONE:
            await asyncio.sleep(0.2)
            now = time.monotonic()

            # Boot timeout
            if now > boot_deadline:
                elapsed = int(now - (boot_deadline - BOOT_TIMEOUT_S))
                print(f"\n[broker] BOOT TIMEOUT after {elapsed}s -- shell prompt never seen")
                print(f"[broker] Last Pi buffer tail: {bytes(self._pi_buf[-64:])!r}")
                self.test_passed = False
                self._state = ST_DONE
                self.result_event.set()
                return

            # Script timeout
            if self._state == ST_INJECT and self._script_deadline and now > self._script_deadline:
                print("\n[broker] SCRIPT TIMEOUT -- no result from Pi script")
                print(f"[broker] Pi buffer tail: {bytes(self._pi_buf[-128:])!r}")
                self.test_passed = False
                self._state = ST_DONE
                self.result_event.set()
                return

            buf = bytes(self._pi_buf)

            if self._state == ST_BOOT:
                if now - last_poke_time > 8.0:
                    self._send_to_pi(b"\n")
                    last_poke_time = now
                    elapsed_s = int(now - (boot_deadline - BOOT_TIMEOUT_S))
                    print(f"[broker] Still booting... ({elapsed_s}s) buf tail: {buf[-16:]!r}")

                if self._prompt_seen(buf):
                    print("\n[broker] Shell prompt detected!")
                    self._pi_buf.clear()
                    self._send_to_pi(
                        b"export PATH=/usr/local/sbin:/usr/local/bin"
                        b":/usr/sbin:/usr/bin:/sbin:/bin && stty -echo\n"
                    )
                    self._state = ST_SETUP

            elif self._state == ST_SETUP:
                if self._prompt_seen(buf) or len(buf) > 10:
                    await asyncio.sleep(0.3)
                    self._pi_buf.clear()
                    print("[broker] Injecting Pi test script ...")
                    self._send_to_pi(_PI_CMD.encode())
                    self._state = ST_INJECT
                    self._script_deadline = time.monotonic() + SCRIPT_TIMEOUT_S

            elif self._state == ST_INJECT:
                if b"TEST_PASSED" in buf:
                    print("\n[broker] TEST_PASSED received from Pi!")
                    self.test_passed = True
                    self._state = ST_DONE
                    self.result_event.set()
                elif b"TEST_FAILED" in buf:
                    snippet = buf.decode("utf-8", errors="replace")[-120:]
                    print(f"\n[broker] TEST_FAILED from Pi. Last output: {snippet!r}")
                    self.test_passed = False
                    self._state = ST_DONE
                    self.result_event.set()

    # || Helpers |||||||||||||||||||||||||||||||||||||||||||||||||||||||||||
    def _prompt_seen(self, buf: bytes) -> bool:
        tail = buf[-32:]
        return any(p in tail for p in PROMPT_BYTES)

    def _send_to_pi(self, data: bytes) -> None:
        if self._pi_writer and not self._pi_writer.is_closing():
            self._pi_writer.write(data)
            asyncio.get_event_loop().create_task(self._pi_writer.drain())


# ||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||
# Compilation
# ||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||
def compile_arduino_sketch() -> Path:
    print("\n[compile] Compiling Arduino sketch with arduino-cli ...")
    tmp_root  = Path(tempfile.mkdtemp())
    sk_dir    = tmp_root / "arduino_sketch"
    build_dir = tmp_root / "build"
    sk_dir.mkdir()
    build_dir.mkdir()
    shutil.copy(SKETCH_FILE, sk_dir / "arduino_sketch.ino")

    cli = shutil.which("arduino-cli") or "arduino-cli"
    cmd = [cli, "compile", "--fqbn", "arduino:avr:uno",
           "--output-dir", str(build_dir), str(sk_dir)]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True,
                                timeout=COMPILE_TIMEOUT_S)
    except FileNotFoundError:
        raise RuntimeError("arduino-cli not found in PATH")
    except subprocess.TimeoutExpired:
        raise RuntimeError("arduino-cli compile timed out")

    if result.returncode != 0:
        raise RuntimeError(
            f"Compilation failed:\n  STDOUT: {result.stdout.strip()}\n"
            f"  STDERR: {result.stderr.strip()}"
        )

    hex_files = sorted(build_dir.glob("*.hex"))
    if not hex_files:
        raise RuntimeError(f"No .hex file produced in {build_dir}")

    hex_path = hex_files[0]
    print(f"[compile] OK  {hex_path.name}  ({hex_path.stat().st_size:,} bytes)")
    return hex_path


# ||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||
# QEMU SD overlay
# ||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||
def _ensure_sd_overlay() -> Path:
    overlay  = IMG_DIR / "sd_overlay.qcow2"
    qemu_img = shutil.which("qemu-img") or "C:/Program Files/qemu/qemu-img.exe"

    if overlay.exists():
        try:
            overlay.unlink()
            print("[qemu-img] Removed old overlay")
        except PermissionError:
            print("[qemu-img] WARNING: overlay locked by another process, reusing")
            return overlay

    cmd = [qemu_img, "create", "-f", "qcow2",
           "-b", str(SD_IMAGE), "-F", "raw", str(overlay), "8G"]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if r.returncode != 0:
        raise RuntimeError(f"qemu-img failed:\n{r.stderr}")
    print(f"[qemu-img] Created {overlay.name} (8G virtual, backed by {SD_IMAGE.name})")
    return overlay


# ||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||
# QEMU command builder
# ||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||
def build_qemu_cmd() -> list[str]:
    missing = [f"  {lbl}: {p}" for lbl, p in
               [("kernel", KERNEL_IMG), ("dtb", DTB_FILE), ("sd", SD_IMAGE)]
               if not p.exists()]
    if missing:
        raise RuntimeError("Missing QEMU images:\n" + "\n".join(missing))

    sd_path  = _ensure_sd_overlay()
    qemu_bin = shutil.which("qemu-system-aarch64") or "qemu-system-aarch64"

    return [
        qemu_bin,
        "-M",      "raspi3b",
        "-kernel", str(KERNEL_IMG),
        "-dtb",    str(DTB_FILE),
        "-drive",  f"file={sd_path},if=sd,format=qcow2",
        "-append", (
            "console=ttyAMA0,115200 "
            "root=/dev/mmcblk0p2 rootwait rw "
            "init=/bin/sh"
        ),
        "-m",      "1G",
        "-smp",    "4",
        "-display", "none",
        "-serial", f"tcp:127.0.0.1:{BROKER_PI_PORT}",
    ]


# ||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||
# Subprocess stdout drainer
# ||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||
async def drain_log(stream: Optional[asyncio.StreamReader], prefix: str) -> None:
    if stream is None:
        return
    async for raw in stream:
        line = raw.decode("utf-8", errors="replace").rstrip()
        if line:
            print(f"{prefix} {line}")


# ||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||
# Main test coroutine
# ||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||
async def run_test() -> bool:
    _banner("Pi <-> Arduino Serial Integration Test")

    # 1. Compile
    hex_path = compile_arduino_sketch()

    # 2. Start broker
    broker = SerialBroker()
    pi_srv, avr_srv = await broker.start()

    procs: list[asyncio.subprocess.Process] = []
    drain_tasks: list[asyncio.Task] = []

    try:
        # 3. avr_runner.js (Arduino emulation)
        node_exe = shutil.which("node") or "node"
        avr_cmd  = [node_exe, str(AVR_RUNNER), str(hex_path),
                    "127.0.0.1", str(BROKER_AVR_PORT)]
        print(f"\n[avr] {' '.join(avr_cmd[:4])} ...")
        avr_proc = await asyncio.create_subprocess_exec(
            *avr_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        procs.append(avr_proc)
        drain_tasks.append(asyncio.create_task(drain_log(avr_proc.stdout, "[avr]")))

        # 4. QEMU (Raspberry Pi 3B)
        qemu_cmd = build_qemu_cmd()
        print(f"\n[qemu] {' '.join(qemu_cmd[:3])} ...")
        qemu_proc = await asyncio.create_subprocess_exec(
            *qemu_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        procs.append(qemu_proc)
        drain_tasks.append(asyncio.create_task(drain_log(qemu_proc.stdout, "[qemu]")))

        # 5. Wait for both TCP connections
        print(f"\n[broker] Waiting for Pi + Arduino connections (30s) ...")
        try:
            await asyncio.wait_for(
                asyncio.gather(broker.pi_connected.wait(),
                               broker.avr_connected.wait()),
                timeout=30.0,
            )
        except asyncio.TimeoutError:
            print("[broker] TIMEOUT waiting for TCP connections")
            return False

        # 6. Start relay + state machine
        print(f"\n[broker] Both connected. Starting relay and automator.\n")
        broker.start_relay()

        # 7. Wait for test result
        total_timeout = BOOT_TIMEOUT_S + SCRIPT_TIMEOUT_S + 15
        try:
            await asyncio.wait_for(broker.result_event.wait(),
                                   timeout=total_timeout)
        except asyncio.TimeoutError:
            print(f"[test] Global timeout ({total_timeout}s) -- no result")
            return False

        return broker.test_passed

    finally:
        # Cancel relay tasks
        broker.cancel_relay()

        # Stop servers
        pi_srv.close()
        avr_srv.close()
        try:
            await asyncio.wait_for(pi_srv.wait_closed(), timeout=3.0)
            await asyncio.wait_for(avr_srv.wait_closed(), timeout=3.0)
        except asyncio.TimeoutError:
            pass

        # Terminate subprocesses
        for p in procs:
            try:
                p.terminate()
                await asyncio.wait_for(p.wait(), timeout=5.0)
            except Exception:
                try:
                    p.kill()
                except Exception:
                    pass

        # Cancel drain tasks
        for t in drain_tasks:
            t.cancel()

        # Remove temp dir
        try:
            shutil.rmtree(hex_path.parent.parent, ignore_errors=True)
        except Exception:
            pass


# ||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||
def _banner(title: str) -> None:
    bar = "=" * 65
    print(f"\n{bar}\n  {title}\n{bar}\n")


def _print_result(passed: bool) -> None:
    _banner("Result")
    if passed:
        print("  [PASS]  INTEGRATION TEST PASSED")
        print()
        print("  Pi  -> Arduino : HELLO_FROM_PI")
        print("  Arduino -> Pi  : ACK_FROM_ARDUINO")
        print("  Pi confirmed   : TEST_PASSED")
    else:
        print("  [FAIL]  INTEGRATION TEST FAILED")
        print()
        print("  Hints:")
        print("  - Check that qemu-system-aarch64, node, arduino-cli are in PATH")
        print("  - Verify init=/bin/sh gives a '#' prompt on Pi OS")
        print("  - Ensure sd_overlay.qcow2 is not locked by another QEMU process")
    print("=" * 65 + "\n")


def main() -> None:
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    passed = asyncio.run(run_test())
    _print_result(passed)
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
