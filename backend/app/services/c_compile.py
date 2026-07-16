"""C-to-retro-CPU compile service via SDCC.

Backs the `format=c` branch of `POST /api/compile-rom`. Compiles a C source
file with SDCC targeting the chip's emulated ISA (Z80 or 8080), then
extracts the program bytes from the resulting Intel HEX so the chip can
load them via vx_rom_read.

SDCC install:

  Linux/macOS (Docker prod image):
      apt-get install -y sdcc

  Windows dev:
      Download from https://sdcc.sourceforge.net/snap.php and run the
      installer; or `winget install --id=SDCC.sdcc`. Add the install
      `bin/` directory to PATH.

The service auto-discovers `sdcc` on PATH; if not present, the endpoint
returns a clear "SDCC not installed" message rather than an opaque crash.

Memory layout the chip expects (matches i8080-cpu / z80-cpu):
  ROM at 0x0000..0x7FFF   (--code-loc 0)
  RAM at 0x8000..0xBFFF   (--data-loc 0x8000)
  Stack grows down from 0xBFFF

SDCC's `--code-loc 0` puts the entry stub at 0; if the user writes a
`void main(void)` it gets wrapped in the standard crt0 + jumped to.
"""
from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Literal


def _find_sdcc() -> str | None:
    """Locate the sdcc binary. Honours SDCC env var first, then PATH."""
    env = os.environ.get("SDCC")
    if env and Path(env).is_file():
        return env
    for name in ("sdcc", "sdcc.exe"):
        path = shutil.which(name)
        if path:
            return path
    # Common Windows install spots not always added to PATH.
    candidates = [
        Path("C:/Program Files/SDCC/bin/sdcc.exe"),
        Path("C:/Program Files (x86)/SDCC/bin/sdcc.exe"),
        Path("C:/sdcc/bin/sdcc.exe"),
    ]
    for c in candidates:
        if c.is_file():
            return str(c)
    return None


CTarget = Literal["z80", "8080"]


def parse_intel_hex(text: str) -> bytes:
    """Parse Intel HEX records into a flat byte buffer.

    Mirrors rom_compile.parse_intel_hex but lives here so c_compile is
    self-contained.
    """
    out = bytearray()
    for raw in text.splitlines():
        line = raw.strip()
        if not line.startswith(":"):
            continue
        try:
            length = int(line[1:3], 16)
            addr   = int(line[3:7], 16)
            rtype  = int(line[7:9], 16)
        except ValueError:
            continue
        if rtype == 0x01:
            break
        if rtype != 0x00:
            continue
        data_hex = line[9 : 9 + length * 2]
        try:
            data = bytes.fromhex(data_hex)
        except ValueError:
            continue
        end = addr + len(data)
        if end > len(out):
            out.extend(b"\x00" * (end - len(out)))
        out[addr:end] = data
    return bytes(out)


async def compile_c(source: str, target: CTarget) -> dict:
    """Compile C source to ROM bytes using SDCC.

    Returns:
        { success, rom_base64 | None, byte_size, stderr, error }
        Caller is expected to base64 the returned bytes; this fn returns
        raw bytes via the dict's 'rom_bytes' key (rom_compile.py wraps).
    """
    sdcc = _find_sdcc()
    if not sdcc:
        return {
            "success": False,
            "rom_bytes": b"",
            "stderr": "",
            "error": (
                "SDCC not installed. Install with `apt-get install sdcc` on "
                "Linux/Docker, or `winget install SDCC.sdcc` on Windows. "
                "Then set the SDCC env var or add sdcc to PATH."
            ),
        }

    tgt = target.lower()
    if tgt == "z80":
        flag = "-mz80"
    elif tgt == "8080":
        # SDCC's 8080 target name is `mgbz80` (Game Boy variant) or
        # `mz80` — pure 8080 lacks a dedicated SDCC backend; closest is
        # mz80 with the user avoiding Z80-only ops. Report a friendly
        # error since pure 8080 C isn't widely useful today.
        return {
            "success": False,
            "rom_bytes": b"",
            "stderr": "",
            "error": (
                "Pure Intel 8080 has no SDCC backend. Use target=z80 "
                "(Z80 is binary-compatible with 8080 — your code runs on "
                "the i8080-cpu chip too if you avoid Z80-only instructions)."
            ),
        }
    else:
        return {
            "success": False,
            "rom_bytes": b"",
            "stderr": "",
            "error": f"SDCC target {target!r} is not supported.",
        }

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp = Path(tmp_dir)
        c_path = tmp / "program.c"
        c_path.write_text(source, encoding="utf-8")

        # Do NOT pass --code-loc. SDCC's z80 crt0 hard-codes the reset vector
        # at 0x0000 (`jp init`) and its init stub at `.org 0x100` (sets SP,
        # calls _main). Forcing `--code-loc 0x100` placed the relocatable
        # _CODE segment ON TOP of that absolute init stub, so reset jumped
        # straight into __clock/_exit (rst 0x08 → ret with a garbage stack)
        # and every Z80 C program derailed before reaching main — the LEDs
        # never moved. Letting SDCC place _CODE after the crt0 header keeps
        # the init stub intact. --data-loc 0x8000 matches the z80-cpu chip's
        # RAM window (which spans 0x8000-0xFFFF so the crt0's SP=0 stack works).
        cmd = [
            sdcc, flag,
            "--data-loc", "0x8000",
            "-o", str(tmp / "program.ihx"),
            str(c_path),
        ]

        def _run() -> subprocess.CompletedProcess:
            return subprocess.run(cmd, capture_output=True, text=True,
                                  cwd=str(tmp), timeout=60)

        try:
            result = await asyncio.to_thread(_run)
        except subprocess.TimeoutExpired:
            return {
                "success": False, "rom_bytes": b"",
                "stderr": "", "error": "SDCC timed out after 60s.",
            }

        ihx_path = tmp / "program.ihx"
        if result.returncode != 0 or not ihx_path.is_file():
            return {
                "success": False,
                "rom_bytes": b"",
                "stderr": (result.stdout or "") + (result.stderr or ""),
                "error": "sdcc exited with a non-zero status",
            }

        rom = parse_intel_hex(ihx_path.read_text(encoding="utf-8"))
        return {
            "success": True,
            "rom_bytes": rom,
            "stderr": result.stderr,
            "error": None,
        }
