"""POST /api/compile-chip — compile a Velxio custom-chip C source to WASM.

The request body carries the C source. Optionally a chip.json string can be
passed for future validation; today it's stored client-side.

Response shape mirrors `compile.py`'s CompileResponse:
  { success, wasm_base64, stdout, stderr, error, byte_size }
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.chip_compile import chip_compile_service

logger = logging.getLogger(__name__)
router = APIRouter()


class ChipCompileRequest(BaseModel):
    source: str
    chip_json: str | None = None


class ChipCompileResponse(BaseModel):
    success: bool
    wasm_base64: str | None = None
    stdout: str = ""
    stderr: str = ""
    error: str | None = None
    byte_size: int = 0


@router.post("/", response_model=ChipCompileResponse)
async def compile_chip(
    request: ChipCompileRequest,
):
    if not request.source or not request.source.strip():
        raise HTTPException(status_code=422, detail="`source` cannot be empty.")

    try:
        result = await chip_compile_service.compile(request.source)
    except Exception as e:  # noqa: BLE001 — surface infra errors to the client
        logger.exception("chip compile failed")
        raise HTTPException(status_code=500, detail=str(e))

    return ChipCompileResponse(**result)


@router.get("/status")
async def compile_chip_status():
    """Health endpoint — reports whether wasi-sdk + headers are available."""
    return chip_compile_service.status()
