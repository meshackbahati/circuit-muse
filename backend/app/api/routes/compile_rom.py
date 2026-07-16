"""POST /api/compile-rom — assemble or convert a chip-program source to ROM bytes.

Used by Velxio's "Compile" button when the active file is a chip-program file
(`.s` / `.asm` / `.hex` / `.bin`). The compiled ROM is base64 bytes that the
frontend stashes in the chip's `romBytes` property; the chip reads them on
chip_setup via the new `vx_rom_size` / `vx_rom_read` SDK calls.

Request body:
  source: str          chip-program source (asm text, hex text, or bin-as-hex)
  target: str          "8080" | "z80" | "8086" | "4004"
  format: str          "asm" | "hex" | "bin"

Response (mirrors compile_chip.py shape):
  success: bool
  rom_base64: str | null
  byte_size: int
  stderr: str
  error: str | null
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.rom_compile import compile_rom

logger = logging.getLogger(__name__)
router = APIRouter()


class RomCompileRequest(BaseModel):
    source: str
    target: str = "8080"
    format: str = "asm"


class RomCompileResponse(BaseModel):
    success: bool
    rom_base64: str | None = None
    byte_size: int = 0
    stderr: str = ""
    error: str | None = None


@router.post("/", response_model=RomCompileResponse)
async def compile_rom_endpoint(request: RomCompileRequest):
    if not request.source.strip() and request.format != "bin":
        raise HTTPException(status_code=422, detail="`source` cannot be empty.")
    try:
        result = await compile_rom(request.source, request.target, request.format)  # type: ignore[arg-type]
    except Exception as e:  # noqa: BLE001
        logger.exception("ROM compile failed")
        raise HTTPException(status_code=500, detail=str(e))
    return RomCompileResponse(**result)
