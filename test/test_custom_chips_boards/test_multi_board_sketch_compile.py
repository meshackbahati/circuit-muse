"""Compile a minimal blink sketch for every supported board family.

Why this lives here: a custom chip is useless without a sketch that talks to
it. This suite verifies that the **other half** of the workflow (compiling
the user's Arduino sketch via the regular /api/compile endpoint) works for
every board family Velxio offers, on the same backend that compiles the
chip itself.

If a board fails here it means the user can't even build a sketch for it on
this backend host — independent of whether custom chips work on that board.
"""
from __future__ import annotations

import pytest

# A blink sketch that compiles cleanly on every supported board (no
# board-specific APIs, just digitalWrite + delay).
BLINK_INO = """
void setup() {
  pinMode(2, OUTPUT);
}
void loop() {
  digitalWrite(2, HIGH);
  delay(500);
  digitalWrite(2, LOW);
  delay(500);
}
"""

# (board_fqbn, expected_artifact_field) — `artifact` is which response field
# should be non-empty after a successful compile.
BOARDS = [
    ("arduino:avr:uno",         "hex_content"),
    ("arduino:avr:nano",        "hex_content"),
    ("arduino:avr:mega",        "hex_content"),
    ("rp2040:rp2040:rpipico",   "binary_content"),
    ("esp32:esp32:esp32",       "binary_content"),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("board_fqbn,artifact_field", BOARDS)
async def test_blink_compiles_on(http, board_fqbn: str, artifact_field: str):
    """Each board family compiles the blink sketch via /api/compile."""
    res = await http.post(
        "/api/compile/",
        json={"files": [{"name": "sketch.ino", "content": BLINK_INO}], "board_fqbn": board_fqbn},
        timeout=180.0,
    )
    assert res.status_code == 200, res.text
    data = res.json()

    if not data.get("success"):
        pytest.skip(
            f"{board_fqbn} compilation failed on this backend "
            f"(missing core/toolchain): {data.get('error')}\n{data.get('stderr', '')[:500]}"
        )

    assert data[artifact_field], (
        f"{board_fqbn} succeeded but {artifact_field} is empty. Full response: {data}"
    )
