"""Chip compilation service — turns user-supplied C source into a WASM binary
using clang from the WASI-SDK toolchain. Mirrors the patterns used by
`arduino_cli.py` (subprocess in a thread, tempdir, structured result dict).

Toolchain layout:
  - WASI-SDK installed in the Docker image at /opt/wasi-sdk (Apache-2.0).
  - velxio-chip.h shipped at /app/sdk/velxio-chip.h (or backend/sdk/ in dev).

The compile command mirrors the sandbox script verbatim:
  clang --target=wasm32-unknown-wasip1 -O2 -nostartfiles
        -Wl,--import-memory -Wl,--export-table -Wl,--no-entry
        -Wl,--export=chip_setup -Wl,--allow-undefined
        -I <sdk> chip.c -o chip.wasm
"""
from __future__ import annotations

import asyncio
import base64
import os
import subprocess
import tempfile
from pathlib import Path


def _resolve_wasi_sdk() -> Path | None:
    """Find a wasi-sdk installation. Honours WASI_SDK env var first."""
    candidates: list[Path] = []
    env = os.environ.get("WASI_SDK")
    if env:
        candidates.append(Path(env))
    # Linux/macOS conventional installs (Docker image lands here)
    candidates.extend([
        Path("/opt/wasi-sdk"),
        Path("/usr/local/wasi-sdk"),
        Path.home() / "wasi-sdk",
    ])
    # Windows dev convenience (not used in production Docker)
    candidates.extend([Path("C:/wasi-sdk"), Path("C:/Program Files/wasi-sdk")])

    for c in candidates:
        clang = c / "bin" / ("clang.exe" if os.name == "nt" else "clang")
        if clang.is_file():
            return c
    return None


def _resolve_sdk_include() -> Path | None:
    """Locate the directory containing velxio-chip.h."""
    here = Path(__file__).resolve()
    # Production: backend/sdk/
    backend_sdk = here.parents[2] / "sdk"
    if (backend_sdk / "velxio-chip.h").is_file():
        return backend_sdk
    # In Docker the WORKDIR is /app, so /app/sdk:
    docker_sdk = Path("/app/sdk")
    if (docker_sdk / "velxio-chip.h").is_file():
        return docker_sdk
    # Dev fallback: the sandbox copy
    sandbox_sdk = here.parents[3] / "test" / "test_custom_chips" / "sdk" / "include"
    if (sandbox_sdk / "velxio-chip.h").is_file():
        return sandbox_sdk
    return None


class ChipCompileService:
    """Compiles a single Velxio custom-chip C source file to a WASM blob."""

    def __init__(self) -> None:
        self.wasi_sdk = _resolve_wasi_sdk()
        self.sdk_include = _resolve_sdk_include()
        self.available = self.wasi_sdk is not None and self.sdk_include is not None

    def status(self) -> dict:
        return {
            "available": self.available,
            "wasi_sdk": str(self.wasi_sdk) if self.wasi_sdk else None,
            "sdk_include": str(self.sdk_include) if self.sdk_include else None,
        }

    async def compile(self, source: str) -> dict:
        """Compile a single .c source into a .wasm. Returns:
            { success, wasm_base64, stdout, stderr, error, byte_size }
        """
        if not self.available or self.wasi_sdk is None or self.sdk_include is None:
            return {
                "success": False,
                "wasm_base64": None,
                "stdout": "",
                "stderr": "",
                "error": (
                    "wasi-sdk not installed on this host. The backend Docker image "
                    "needs WASI-SDK 22+ at /opt/wasi-sdk."
                ),
                "byte_size": 0,
            }

        with tempfile.TemporaryDirectory() as temp_dir:
            tmp = Path(temp_dir)
            (tmp / "chip.c").write_text(source, encoding="utf-8")
            wasm_path = tmp / "chip.wasm"

            clang = self.wasi_sdk / "bin" / ("clang.exe" if os.name == "nt" else "clang")
            cmd = [
                str(clang),
                "--target=wasm32-unknown-wasip1",
                "-O2",
                "-nostartfiles",
                "-Wl,--import-memory",
                "-Wl,--export-table",
                "-Wl,--no-entry",
                "-Wl,--export=chip_setup",
                "-Wl,--allow-undefined",
                "-I",
                str(self.sdk_include),
                str(tmp / "chip.c"),
                "-o",
                str(wasm_path),
            ]

            def _run() -> subprocess.CompletedProcess:
                return subprocess.run(cmd, capture_output=True, text=True, cwd=str(tmp))

            result = await asyncio.to_thread(_run)

            if result.returncode != 0 or not wasm_path.is_file():
                return {
                    "success": False,
                    "wasm_base64": None,
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                    "error": "clang exited with a non-zero status",
                    "byte_size": 0,
                }

            wasm_bytes = wasm_path.read_bytes()
            return {
                "success": True,
                "wasm_base64": base64.b64encode(wasm_bytes).decode("ascii"),
                "stdout": result.stdout,
                "stderr": result.stderr,
                "error": None,
                "byte_size": len(wasm_bytes),
            }


chip_compile_service = ChipCompileService()
