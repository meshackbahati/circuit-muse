#!/usr/bin/env python3
"""
Phase 2.5 end-to-end: BME280 attach over I2C
============================================

Boots the Pi 3 (-M virt) the exact same way ``qemu_manager.py`` does
(pipe chardev for the protocol channel) and then runs a small
host-side loop that mirrors what ``QemuManager._handle_gpio_line``
does for I2C frames: it forwards the frame to the
``pi_protocol_dispatcher`` in the pro overlay, then writes the reply
back over the proto pipe.

We pre-attach a BME280 to the per-client ``PiSlaveRegistry`` via
``pi_slave_handler.handle('attach', ...)`` before booting, then run
guest Python:

    import smbus2
    bus = smbus2.SMBus(1)
    chip = bus.read_byte_data(0x76, 0xD0)
    print(f'CHIP=0x{chip:02x}')

Assertion: console reads back ``CHIP=0x60`` (the real BME280's chip ID).

What this catches (above and beyond test_pi3_protocols.py):
  - dispatcher → registry → model lookup chain
  - shim I2C wire format (RR with hex register / length tokens)
  - reply line emitted as ``I2C_DATA <bus> <addr> <hex>``
  - shim correctly parsing the reply hex back into an int

Run inside the velxio-app container:

    docker exec velxio-app python3 /tmp/test_pi3_bme280_attach.py
"""
from __future__ import annotations

import asyncio
import base64
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

# Make `app.*` resolvable. Inside the prod container the backend
# package lives at /app/app/ — the pro overlay is COPYed beside it
# at build time as /app/app/pro/.
sys.path.insert(0, '/app')

BOOT_IMAGES = Path('/var/cache/velxio/boot-images/raspberry-pi-3-virt')
KERNEL    = BOOT_IMAGES / 'velxio-kernel-arm64'
INITRAMFS = BOOT_IMAGES / 'velxio-initramfs-arm64.cpio.gz'
ROOTFS    = BOOT_IMAGES / 'velxio-pi-rootfs-arm64.ext4'

CLIENT_ID = 'phase2.5-bme280-test'
BOOT_TIMEOUT_S = 90


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def _make_overlay() -> str:
    overlay = tempfile.NamedTemporaryFile(suffix='.qcow2', delete=False)
    overlay.close()
    subprocess.run(
        ['qemu-img', 'create', '-f', 'qcow2',
         '-b', str(ROOTFS), '-F', 'raw', overlay.name],
        check=True, capture_output=True,
    )
    return overlay.name


def _mk_proto_pipe() -> str:
    base = tempfile.mktemp(prefix='velxio-pi-bme280-test-')
    for suffix in ('.in', '.out'):
        os.mkfifo(base + suffix, 0o600)
    return base


def _qemu_argv(overlay: str, cons_port: int, proto_base: str) -> list[str]:
    return [
        'qemu-system-aarch64',
        '-M', 'virt', '-cpu', 'cortex-a53', '-smp', '4', '-m', '1G',
        '-kernel', str(KERNEL), '-initrd', str(INITRAMFS),
        '-drive', f'if=none,file={overlay},format=qcow2,id=rootfs',
        '-device', 'virtio-blk-pci,drive=rootfs',
        '-nic', 'none', '-display', 'none', '-monitor', 'none', '-serial', 'none',
        '-chardev',
        f'socket,id=cons,host=127.0.0.1,port={cons_port},server=on,wait=off',
        '-device', 'virtio-serial-pci,id=virtio-serial0',
        '-device', 'virtconsole,chardev=cons',
        '-chardev', f'pipe,id=proto,path={proto_base}',
        '-device', 'virtserialport,chardev=proto,name=velxio-protocol',
        '-append', 'console=hvc0 root=/dev/vda rw panic=10',
    ]


def _proto_router_thread(proto_in: int, proto_out: int, stop: threading.Event) -> None:
    """Mirror QemuManager's _handle_gpio_line loop on the host side.

    We poll ``proto_out`` (guest → host) for newline-terminated frames,
    feed each one to the pro overlay's protocol dispatcher, and write
    the reply (if any) back to ``proto_in`` (host → guest).
    """
    from app.pro.services.pi_protocol_dispatcher import dispatch

    buf = bytearray()
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    while not stop.is_set():
        try:
            data = os.read(proto_out, 4096)
        except BlockingIOError:
            time.sleep(0.02)
            continue
        except OSError:
            return
        if not data:
            time.sleep(0.02)
            continue
        buf.extend(data)
        while b'\n' in buf:
            line, _, rest = buf.partition(b'\n')
            buf = bytearray(rest)
            tokens = line.decode('ascii', 'replace').strip().split()
            if not tokens or tokens[0] not in ('I2C', 'SPI', 'UART'):
                continue
            print(f'[proto] >>> {tokens}')
            reply = loop.run_until_complete(dispatch(CLIENT_ID, tokens))
            if reply:
                print(f'[proto] <<< {reply}')
                os.write(proto_in, (reply + '\n').encode('ascii'))


def run() -> int:
    for p in (KERNEL, INITRAMFS, ROOTFS):
        if not p.exists():
            print(f'FAIL: missing boot image: {p}', file=sys.stderr)
            return 2

    # Pre-register the dispatcher + slave handler the same way
    # register_pro() does, then attach a BME280 to the registry.
    from app.pro.services import pi_slave_handler

    asyncio.run(pi_slave_handler.handle(CLIENT_ID, 'attach', {
        'bus_kind': 'i2c',
        'bus_num': 1,
        'address': 0x76,
        'model_id': 'bme280',
        'config': {'temperature_c': 22.0, 'humidity_pct': 47.0,
                   'pressure_pa': 101000.0},
    }))

    overlay = _make_overlay()
    proto_base = _mk_proto_pipe()
    cons_port = _find_free_port()
    argv = _qemu_argv(overlay, cons_port, proto_base)
    print('[test] launching:', ' '.join(argv))

    proto_in  = os.open(proto_base + '.in',  os.O_RDWR | os.O_NONBLOCK)
    proto_out = os.open(proto_base + '.out', os.O_RDWR | os.O_NONBLOCK)

    stop = threading.Event()
    router = threading.Thread(
        target=_proto_router_thread,
        args=(proto_in, proto_out, stop),
        daemon=True,
    )
    router.start()

    qemu = subprocess.Popen(
        argv, stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE, stdin=subprocess.DEVNULL,
    )
    try:
        sock: socket.socket | None = None
        deadline = time.monotonic() + BOOT_TIMEOUT_S
        while time.monotonic() < deadline:
            try:
                sock = socket.create_connection(('127.0.0.1', cons_port),
                                                timeout=5)
                break
            except (ConnectionRefusedError, OSError):
                time.sleep(0.3)
        if not sock:
            print('FAIL: console TCP connection refused', file=sys.stderr)
            return 1
        sock.settimeout(2)

        buf = bytearray()
        saw_prompt = False
        sent_test = False

        while time.monotonic() < deadline:
            try:
                chunk = sock.recv(4096)
            except socket.timeout:
                continue
            if not chunk:
                break
            buf.extend(chunk)

            if not saw_prompt and b':~#' in buf:
                saw_prompt = True
                print('[test] bash prompt reached, sending Python BME280 read')
                time.sleep(3)
                try:
                    while True:
                        more = sock.recv(4096)
                        if not more:
                            break
                        buf.extend(more)
                except socket.timeout:
                    pass
                py = (
                    'import smbus2\n'
                    'bus = smbus2.SMBus(1)\n'
                    'chip = bus.read_byte_data(0x76, 0xD0)\n'
                    "print(f'CHIP=0x{chip:02x}')\n"
                    'data = bus.read_i2c_block_data(0x76, 0xF7, 8)\n'
                    "print('BLOCK=' + ''.join(f'{b:02x}' for b in data))\n"
                )
                b64 = base64.b64encode(py.encode()).decode()
                cmd = (
                    f'echo {b64} | base64 -d > /tmp/bme280_test.py && '
                    f'python3 /tmp/bme280_test.py\n'
                ).encode()
                sock.sendall(cmd)
                sent_test = True

            if sent_test and b'CHIP=0x60' in buf and b'BLOCK=' in buf:
                print('[test] OK — guest read chip ID = 0x60')
                # Also check that BLOCK= came back as 16 hex chars (8 bytes)
                txt = buf.decode('utf-8', 'replace')
                for ln in txt.splitlines():
                    if ln.startswith('BLOCK='):
                        # Allow trailing CR / ANSI from the shell echo
                        value = ln[len('BLOCK='):].strip().split()[0]
                        if len(value) == 16:
                            print(f'[test] OK — block read {ln}')
                            return 0
                        print(f'FAIL: block length wrong ({len(value)}): {ln}',
                              file=sys.stderr)
                        return 1
                # Fall through: BLOCK= present but no parseable line yet,
                # keep draining
                continue

            if sent_test and (b'Traceback' in buf or b'ModuleNotFoundError' in buf):
                print('FAIL: guest python raised:', file=sys.stderr)
                print(buf[-1500:].decode('utf-8', 'replace'))
                return 1

        print(f'FAIL: timeout. saw_prompt={saw_prompt} '
              f'sent_test={sent_test} buf_len={len(buf)}',
              file=sys.stderr)
        print(buf[-1500:].decode('utf-8', 'replace'), file=sys.stderr)
        return 1
    finally:
        stop.set()
        try:
            qemu.terminate()
            qemu.wait(timeout=5)
        except subprocess.TimeoutExpired:
            qemu.kill()
        for fd in (proto_in, proto_out):
            try: os.close(fd)
            except OSError: pass
        for suffix in ('.in', '.out'):
            try: os.unlink(proto_base + suffix)
            except OSError: pass
        try: os.unlink(overlay)
        except OSError: pass
        asyncio.run(pi_slave_handler.handle(CLIENT_ID, 'shutdown', {}))


if __name__ == '__main__':
    sys.exit(run())
