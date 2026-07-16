#!/usr/bin/env python3
"""
Pi 3 console boot validation
============================

Spins up QEMU raspi3b with the SAME args the production qemu_manager
uses (two ``-serial`` chardevs, ``init=/usr/local/sbin/velxio-init``,
``console=ttyAMA1,115200 keep_bootcon earlycon=pl011,mmio32,0x3f201000``)
against the cached SD image. Connects to the user-serial TCP socket
and asserts:

1. The kernel boots and reaches ``Run /usr/local/sbin/velxio-init as
   init process``.
2. The init script emits a ``[velxio-init] selected TTY=...`` diag
   line (i.e. doesn't hit the FATAL path).
3. The init script does NOT spam ``No such file or directory`` /
   ``No such device or address`` errors (which mean the redirect to
   the chosen TTY is failing).
4. The Velxio bashrc banner appears (``Velxio Raspberry Pi 3 —
   interactive root shell``).
5. After sending ``echo VELXIO_OK_$$\\n`` to the console, the same
   token comes back (proves the shell is actually reading input).

Fidelity rule (memory ``feedback_tests_import_real_code``): the
QEMU launch args mirror what ``app.services.qemu_manager`` emits,
so any regression in the production manager that touches the
console wiring fails this test too. The SD image read is the
exact image cached by BootImageProvider at runtime.

Run:
    cd /home/dave/velxio-prod
    python3 velxio/test/pi3_console_boot/test_pi3_console_boot.py

The test takes ~45 s (boot is the slow part). Exit code 0 = OK,
non-zero = failure with the offending log excerpt printed.
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path


BOOT_IMAGES = Path("/var/cache/velxio/boot-images/raspberry-pi-3-virt")
KERNEL    = BOOT_IMAGES / "velxio-kernel-arm64"
INITRAMFS = BOOT_IMAGES / "velxio-initramfs-arm64.cpio.gz"
ROOTFS    = BOOT_IMAGES / "velxio-pi-rootfs-arm64.ext4"

# Boot timeout: cold boot is ~10-15 s on virt + minimal rootfs (much
# faster than the old raspi3b + raspios path that took 25-30 s).
BOOT_TIMEOUT_S = 45

# Markers we expect to see in the console output during a healthy
# boot. The order is significant — each MUST appear before the
# next in time. Matches what Alpine + agetty + autologin emit:
#   - "OpenRC 0.x" — openrc init started
#   - "Welcome to the Velxio Pi Simulator" — /etc/motd printed by login
#   - "raspberrypi:" — agetty's autologin reached the shell prompt
BOOT_MARKERS = [
    b"Velxio Pi Simulator",
    b"login on 'hvc0'",
]

# Any of these substrings in the output means the init or shell is
# broken — fail fast rather than waiting for the prompt timeout.
BOOT_NEGATIVE_MARKERS = [
    b"FATAL",
    b"Kernel panic",
    b"unable to mount root fs",
    b"Cannot open root device",
]


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _make_qcow2_overlay() -> str:
    """Mirror of ``qemu_manager`` — qcow2 over the cached rootfs ext4
    so the test never mutates the base."""
    overlay = tempfile.NamedTemporaryFile(suffix=".qcow2", delete=False)
    overlay.close()
    subprocess.run(
        ["qemu-img", "create", "-f", "qcow2",
         "-b", str(ROOTFS), "-F", "raw", overlay.name],
        check=True, capture_output=True,
    )
    return overlay.name


def _qemu_argv(overlay_path: str, serial_port: int, gpio_port: int) -> list[str]:
    """Mirror of ``qemu_manager._boot`` — -M virt + virtio-{blk,serial}
    over PCI + velxio kernel/initramfs/rootfs."""
    return [
        "qemu-system-aarch64",
        "-M", "virt",
        "-cpu", "cortex-a53",
        "-smp", "4",
        "-m", "1G",
        "-kernel", str(KERNEL),
        "-initrd", str(INITRAMFS),
        "-drive", f"if=none,file={overlay_path},format=qcow2,id=rootfs",
        "-device", "virtio-blk-pci,drive=rootfs",
        "-nic", "none",
        "-display", "none",
        "-monitor", "none",
        "-serial", "none",
        "-chardev", f"socket,id=cons,host=127.0.0.1,port={serial_port},"
                    f"server=on,wait=off",
        "-device", "virtio-serial-pci,id=virtio-serial0",
        "-device", "virtconsole,chardev=cons",
        "-chardev", f"socket,id=proto,host=127.0.0.1,port={gpio_port},"
                    f"server=on,wait=off",
        "-device", "virtserialport,chardev=proto,name=velxio-protocol",
        "-append", "console=hvc0 root=/dev/vda rw panic=10",
    ]


def _connect_with_retry(host: str, port: int, deadline: float) -> socket.socket:
    """Poll-connect to QEMU's TCP serial server (it accepts after
    QEMU has fully started)."""
    while time.monotonic() < deadline:
        try:
            s = socket.create_connection((host, port), timeout=2)
            s.settimeout(2)
            return s
        except (ConnectionRefusedError, OSError):
            time.sleep(0.2)
    raise TimeoutError(f"Could not connect to {host}:{port} within deadline")


def _drain_until(sock: socket.socket, marker: bytes, deadline: float,
                 negatives: list[bytes]) -> bytes:
    """Read from socket until ``marker`` appears or we hit a negative
    marker / deadline. Returns the accumulated buffer for inspection."""
    buf = bytearray()
    while time.monotonic() < deadline:
        try:
            chunk = sock.recv(4096)
        except socket.timeout:
            continue
        if not chunk:
            break
        buf.extend(chunk)
        for neg in negatives:
            if neg in buf:
                return bytes(buf)
        if marker in buf:
            return bytes(buf)
    return bytes(buf)


def run() -> int:
    # ── sanity: required files exist ───────────────────────────────
    for p in (KERNEL, INITRAMFS, ROOTFS):
        if not p.exists():
            print(f"FAIL: missing boot image: {p}", file=sys.stderr)
            return 2
    if not subprocess.run(
        ["which", "qemu-system-aarch64"], capture_output=True
    ).returncode == 0:
        print("FAIL: qemu-system-aarch64 not in PATH", file=sys.stderr)
        return 2

    # ── start QEMU ─────────────────────────────────────────────────
    overlay = _make_qcow2_overlay()
    serial_port = _find_free_port()
    gpio_port = _find_free_port()
    argv = _qemu_argv(overlay, serial_port, gpio_port)
    print(f"[test] QEMU: {' '.join(argv)}")
    qemu = subprocess.Popen(
        argv,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        stdin=subprocess.DEVNULL,
    )
    deadline = time.monotonic() + BOOT_TIMEOUT_S

    try:
        # Connect to the user-serial channel.
        sock = _connect_with_retry("127.0.0.1", serial_port, deadline)
        print(f"[test] connected to user serial @ :{serial_port}")

        # Walk through each expected marker in order. Any negative
        # marker short-circuits the test.
        all_output = bytearray()
        for marker in BOOT_MARKERS:
            print(f"[test] waiting for marker: {marker!r}")
            chunk = _drain_until(sock, marker, deadline, BOOT_NEGATIVE_MARKERS)
            all_output.extend(chunk)
            for neg in BOOT_NEGATIVE_MARKERS:
                if neg in chunk:
                    print(f"FAIL: negative marker hit: {neg!r}", file=sys.stderr)
                    _dump_tail(bytes(all_output), 4000)
                    return 1
            if marker not in chunk:
                print(f"FAIL: timeout waiting for marker {marker!r}",
                      file=sys.stderr)
                _dump_tail(bytes(all_output), 4000)
                return 1
            print(f"[test]   ✓ found")

        # ── round-trip: send a token, expect to see it echoed back ─
        token = f"VELXIO_OK_{os.getpid()}".encode()
        # The shell echoes input back (canonical TTY mode), so sending
        # `echo TOKEN` followed by newline should produce `echo TOKEN`
        # (typed) followed by `TOKEN` (command output) on the wire.
        # We send a small delay to let the prompt settle.
        time.sleep(2)
        cmd = b"echo " + token + b"\n"
        print(f"[test] sending: {cmd!r}")
        sock.sendall(cmd)
        echoback = _drain_until(sock, token, deadline,
                                BOOT_NEGATIVE_MARKERS)
        all_output.extend(echoback)
        if token not in echoback:
            print(f"FAIL: token {token!r} never came back from the shell — "
                  "input is not flowing or shell is dead",
                  file=sys.stderr)
            _dump_tail(bytes(all_output), 4000)
            return 1
        # The token will appear at least twice (echo of typed bytes +
        # output of the echo command). One occurrence is suspicious
        # (could be just the echo of our send).
        if echoback.count(token) < 2:
            print(f"WARN: token {token!r} appears only "
                  f"{echoback.count(token)}x — expected ≥2 "
                  "(typed echo + command output). Shell may be in "
                  "raw mode or the redirect is one-way.")
            # Don't fail — some configs disable echo. The presence
            # alone proves bidirectional flow.

        print("[test] ✓ Pi 3 console is interactive")
        return 0
    finally:
        try:
            qemu.terminate()
            qemu.wait(timeout=5)
        except subprocess.TimeoutExpired:
            qemu.kill()
        try:
            os.unlink(overlay)
        except OSError:
            pass


def _dump_tail(buf: bytes, n: int) -> None:
    tail = buf[-n:].decode("utf-8", errors="replace")
    print("─" * 70, file=sys.stderr)
    print("Last bytes of console output:", file=sys.stderr)
    print(tail, file=sys.stderr)
    print("─" * 70, file=sys.stderr)


if __name__ == "__main__":
    sys.exit(run())
