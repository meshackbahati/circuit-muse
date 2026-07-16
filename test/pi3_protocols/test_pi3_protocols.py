#!/usr/bin/env python3
"""
Pi 3 Phase 2 protocol validation
================================

End-to-end test that mirrors the production qemu_manager.py setup
EXACTLY: -M virt, pipe chardev for the protocol channel, FIFOs on
disk. Boots the Pi, runs Python in the guest shell, asserts that
``import RPi.GPIO; GPIO.setup(17, OUT); GPIO.output(17, HIGH)``
produces the expected text frames on the host side of the proto
pipe.

What this catches:
- Shim site-packages overlay not active in the rootfs
- /sys/class/virtio-ports/*/name auto-discovery wrong
- pipe chardev fail (regressions vs QEMU 10 socket bug fix)
- qemu_manager's protocol mux not matching the shim wire format

Run:
    docker cp this file into velxio-app:/tmp/
    docker exec velxio-app python3 /tmp/test_pi3_protocols.py

Or, as part of a deploy gate, from the host via docker exec.
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

BOOT_TIMEOUT_S = 60


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _make_overlay() -> str:
    overlay = tempfile.NamedTemporaryFile(suffix=".qcow2", delete=False)
    overlay.close()
    subprocess.run(
        ["qemu-img", "create", "-f", "qcow2",
         "-b", str(ROOTFS), "-F", "raw", overlay.name],
        check=True, capture_output=True,
    )
    return overlay.name


def _mk_proto_pipe() -> str:
    base = tempfile.mktemp(prefix="velxio-pi-proto-test-")
    for suffix in (".in", ".out"):
        os.mkfifo(base + suffix, 0o600)
    return base


def _qemu_argv(overlay: str, cons_port: int, proto_base: str) -> list[str]:
    return [
        "qemu-system-aarch64",
        "-M", "virt", "-cpu", "cortex-a53", "-smp", "4", "-m", "1G",
        "-kernel", str(KERNEL), "-initrd", str(INITRAMFS),
        "-drive", f"if=none,file={overlay},format=qcow2,id=rootfs",
        "-device", "virtio-blk-pci,drive=rootfs",
        "-nic", "none", "-display", "none", "-monitor", "none", "-serial", "none",
        "-chardev",
        f"socket,id=cons,host=127.0.0.1,port={cons_port},server=on,wait=off",
        "-device", "virtio-serial-pci,id=virtio-serial0",
        "-device", "virtconsole,chardev=cons",
        "-chardev", f"pipe,id=proto,path={proto_base}",
        "-device", "virtserialport,chardev=proto,name=velxio-protocol",
        "-append", "console=hvc0 root=/dev/vda rw panic=10",
    ]


def run() -> int:
    for p in (KERNEL, INITRAMFS, ROOTFS):
        if not p.exists():
            print(f"FAIL: missing boot image: {p}", file=sys.stderr)
            return 2

    overlay = _make_overlay()
    proto_base = _mk_proto_pipe()
    cons_port = _find_free_port()
    argv = _qemu_argv(overlay, cons_port, proto_base)
    print("[test] launching:", " ".join(argv))

    # Open both ends of each FIFO O_RDWR so we never hit EOF when the
    # guest reopens its side. This mirrors qemu_manager._connect_gpio.
    proto_in  = os.open(proto_base + ".in",  os.O_RDWR | os.O_NONBLOCK)
    proto_out = os.open(proto_base + ".out", os.O_RDWR | os.O_NONBLOCK)

    qemu = subprocess.Popen(
        argv, stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE, stdin=subprocess.DEVNULL,
    )
    try:
        # Connect to user console socket.
        sock = None
        deadline = time.monotonic() + BOOT_TIMEOUT_S
        while time.monotonic() < deadline:
            try:
                sock = socket.create_connection(("127.0.0.1", cons_port), timeout=5)
                break
            except (ConnectionRefusedError, OSError):
                time.sleep(0.3)
        if not sock:
            print("FAIL: console TCP connection refused", file=sys.stderr)
            return 1
        sock.settimeout(2)

        # Drain proto.out in a background-style poll.
        proto_buf = bytearray()

        def pull_proto() -> None:
            try:
                while True:
                    data = os.read(proto_out, 4096)
                    if not data:
                        break
                    proto_buf.extend(data)
            except BlockingIOError:
                return
            except OSError:
                return

        # Walk through markers + send Python.
        buf = bytearray()
        saw_prompt = False
        sent_test = False

        while time.monotonic() < deadline:
            pull_proto()
            try:
                chunk = sock.recv(4096)
            except socket.timeout:
                continue
            if not chunk:
                break
            buf.extend(chunk)
            # Wait for the actual bash prompt (`:~#`) — `login on` alone
            # fires from the login message line BEFORE bash is fully
            # ready to read input. The :~# marker only appears once
            # bash has printed PS1.
            if not saw_prompt and b":~#" in buf:
                saw_prompt = True
                print("[test] bash prompt reached, sending Python GPIO call")
                time.sleep(3)
                try:
                    while True:
                        more = sock.recv(4096)
                        if not more:
                            break
                        buf.extend(more)
                except socket.timeout:
                    pass
                # Send the Python test as a base64-encoded file —
                # avoids all the bash/python -c quote-nesting hell
                # (which silently corrupts the script and makes
                # nothing happen, see the Phase 2 debug logs).
                import base64
                py = (
                    "import RPi.GPIO as G\n"
                    "G.setmode(G.BCM)\n"
                    "G.setup(17, G.OUT)\n"
                    "G.output(17, 1)\n"
                    "import time; time.sleep(0.5)\n"
                    "print('SHIM_OK')\n"
                )
                b64 = base64.b64encode(py.encode()).decode()
                cmd = (
                    f"echo {b64} | base64 -d > /tmp/shim_test.py && "
                    f"python3 /tmp/shim_test.py\n"
                ).encode()
                sock.sendall(cmd)
                sent_test = True
            if sent_test and b"SHIM_OK" in buf:
                # Give the proto pipe a moment to flush after Python exits
                for _ in range(20):
                    pull_proto()
                    time.sleep(0.1)
                print(f"[test] proto received {len(proto_buf)} bytes:")
                txt = proto_buf.decode("ascii", "replace")
                for ln in txt.strip().splitlines():
                    print(f"    {ln}")
                # Asserts
                if "GPIO_SETUP 17 out" not in txt:
                    print("FAIL: GPIO_SETUP 17 out missing in proto frames",
                          file=sys.stderr)
                    return 1
                if "GPIO 17 1" not in txt:
                    print("FAIL: GPIO 17 1 missing in proto frames",
                          file=sys.stderr)
                    return 1
                print("[test] ✓ shim → proto pipeline works")
                return 0
            if sent_test and (b"Traceback" in buf or b"ModuleNotFoundError" in buf):
                print("FAIL: guest python raised:", file=sys.stderr)
                print(buf[-1500:].decode("utf-8", "replace"))
                return 1

        print(f"FAIL: timeout. saw_prompt={saw_prompt} sent_test={sent_test} "
              f"buf_len={len(buf)}", file=sys.stderr)
        print(buf[-1500:].decode("utf-8", "replace"), file=sys.stderr)
        return 1
    finally:
        try:
            qemu.terminate()
            qemu.wait(timeout=5)
        except subprocess.TimeoutExpired:
            qemu.kill()
        for fd in (proto_in, proto_out):
            try: os.close(fd)
            except OSError: pass
        for suffix in (".in", ".out"):
            try: os.unlink(proto_base + suffix)
            except OSError: pass
        try: os.unlink(overlay)
        except OSError: pass


if __name__ == "__main__":
    sys.exit(run())
