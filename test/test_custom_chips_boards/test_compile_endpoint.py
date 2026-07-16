"""POST /api/compile-chip — compile every example chip and assert the WASM is valid.

Each successful response should:
  - have success=true
  - return wasm_base64 that decodes to bytes starting with the WASM magic \\x00asm
  - be non-trivial in size (chips with libc/printf are ~60 KB; the threshold of
    1 KB is a sanity guard against the backend returning an empty stub)
"""
from __future__ import annotations

import base64

import pytest

from .conftest import EXAMPLE_CHIPS, chip_source, chip_json


WASM_MAGIC = b"\x00asm\x01\x00\x00\x00"


@pytest.mark.asyncio
async def test_status_endpoint_reports_wasi_sdk_available(http):
    """Sanity: backend confirms it can compile chips at all."""
    res = await http.get("/api/compile-chip/status")
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["available"] is True, f"chip-compile not available: {data}"
    assert data["wasi_sdk"], "wasi_sdk path missing"
    assert data["sdk_include"], "sdk include path missing"


@pytest.mark.asyncio
@pytest.mark.parametrize("chip_name", EXAMPLE_CHIPS)
async def test_chip_compiles_to_valid_wasm(http, chip_name: str):
    """Every example chip in the sandbox compiles cleanly via the API."""
    src = chip_source(chip_name)
    cj = chip_json(chip_name)

    res = await http.post(
        "/api/compile-chip/",
        json={"source": src, "chip_json": cj},
    )
    assert res.status_code == 200, res.text
    data = res.json()

    assert data["success"], (
        f"{chip_name} failed to compile.\n"
        f"stderr:\n{data.get('stderr', '')}\n"
        f"error: {data.get('error')}"
    )
    assert data["wasm_base64"], "wasm_base64 missing on successful compile"
    assert data["byte_size"] > 1024, f"{chip_name} suspiciously small: {data['byte_size']} bytes"

    blob = base64.b64decode(data["wasm_base64"])
    assert blob[:8] == WASM_MAGIC, f"{chip_name} not a valid WASM module"


@pytest.mark.asyncio
async def test_empty_source_returns_422(http):
    """The endpoint validates that source is non-empty."""
    res = await http.post("/api/compile-chip/", json={"source": "   "})
    assert res.status_code == 422, res.text


@pytest.mark.asyncio
async def test_broken_syntax_returns_success_false_with_stderr(http):
    """Compile errors are reported as success=false (not HTTP 500)."""
    res = await http.post(
        "/api/compile-chip/",
        json={"source": "this is not valid C code @#$%"},
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["success"] is False
    assert data["error"] is not None or data["stderr"], "expected diagnostic output"
