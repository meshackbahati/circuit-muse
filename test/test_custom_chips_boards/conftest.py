"""Shared fixtures for the multi-board custom-chip validation suite.

The backend must be reachable at $VELXIO_BACKEND_URL (default
http://127.0.0.1:8765). All tests here are integration tests — they hit a
real running uvicorn instance, the same way the frontend would.
"""
from __future__ import annotations

import os
from pathlib import Path

import httpx
import pytest
import pytest_asyncio


BACKEND_URL = os.environ.get("VELXIO_BACKEND_URL", "http://127.0.0.1:8765")
WS_URL = BACKEND_URL.replace("http://", "ws://").replace("https://", "wss://")

REPO_ROOT = Path(__file__).resolve().parents[2]
CHIP_EXAMPLES_DIR = REPO_ROOT / "test" / "test_custom_chips" / "sdk" / "examples"


@pytest.fixture(scope="session")
def backend_url() -> str:
    return BACKEND_URL


@pytest.fixture(scope="session")
def ws_url() -> str:
    return WS_URL


@pytest_asyncio.fixture
async def http():
    """Async httpx client pointed at the backend."""
    async with httpx.AsyncClient(base_url=BACKEND_URL, timeout=60.0) as client:
        yield client


def chip_source(name: str) -> str:
    """Return the C source for one of the 11 sandbox example chips."""
    path = CHIP_EXAMPLES_DIR / f"{name}.c"
    if not path.is_file():
        raise FileNotFoundError(f"Missing example chip source: {path}")
    return path.read_text(encoding="utf-8")


def chip_json(name: str) -> str:
    """Return the chip.json sidecar for an example chip."""
    path = CHIP_EXAMPLES_DIR / f"{name}.chip.json"
    if not path.is_file():
        raise FileNotFoundError(f"Missing example chip.json: {path}")
    return path.read_text(encoding="utf-8")


# Static parameter list reused across the suite.
EXAMPLE_CHIPS = [
    "inverter",
    "xor",
    "cd4094",
    "eeprom-24c01",
    "eeprom-24lc256",
    "uart-rot13",
    "sn74hc595",
    "mcp3008",
    "pcf8574",
    "ds3231",
    "pulse-counter",
]
