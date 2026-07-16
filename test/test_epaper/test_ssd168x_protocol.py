"""Pure-Python tests for the SSD168x SPI decoder.

These tests are the **specification** for the future Velxio frontend
emulator. They walk the decoder through the exact byte sequences GxEPD2
and Adafruit_EPD emit and assert the resulting framebuffer is what a
real panel would have shown.

No QEMU, no DOM, no backend — just bytes in and pixels out.
"""
from __future__ import annotations

from pathlib import Path
import sys

import pytest

_HERE = Path(__file__).parent
sys.path.insert(0, str(_HERE))

from ssd168x_decoder import (   # noqa: E402  (sys.path tweak above)
    SSD168xDecoder,
    Frame,
    CMD_SW_RESET,
    CMD_DRIVER_OUTPUT_CTRL,
    CMD_DATA_ENTRY_MODE,
    CMD_SET_RAMX_RANGE,
    CMD_SET_RAMY_RANGE,
    CMD_BORDER_WAVEFORM,
    CMD_DISP_UPDATE_CTRL_1,
    CMD_TEMP_SENSOR,
    CMD_SET_RAMX_COUNTER,
    CMD_SET_RAMY_COUNTER,
    CMD_WRITE_BLACK_VRAM,
    CMD_WRITE_RED_VRAM,
    CMD_DISP_UPDATE_CTRL_2,
    CMD_MASTER_ACTIVATION,
    CMD_DEEP_SLEEP,
)


# ── Helpers ───────────────────────────────────────────────────────────────────


def cmd(c):
    """Return one (byte, dc=False) tuple — DC LOW means command."""
    return [(c, False)]


def data(*bs):
    """Return n (byte, dc=True) tuples — DC HIGH means data."""
    return [(b, True) for b in bs]


def feed_all(d, *streams):
    """Feed a flat sequence of (byte, dc) tuples into the decoder."""
    for stream in streams:
        for byte, dc_high in stream:
            d.feed(byte, dc_high)


def gxepd2_init_154(d):
    """The init sequence GxEPD2 emits for the GxEPD2_154_D67 (200×200, SSD1681).

    Lifted from GxEPD2's src/epd/GxEPD2_154_D67.cpp _InitDisplay() and
    cross-checked against esp-bsp's esp_lcd_ssd1681_commands.h init.
    """
    feed_all(
        d,
        cmd(CMD_SW_RESET),
        cmd(CMD_DRIVER_OUTPUT_CTRL), data(0xC7, 0x00, 0x00),
        cmd(CMD_DATA_ENTRY_MODE),    data(0x03),
        cmd(CMD_SET_RAMX_RANGE),     data(0x00, 0x18),
        cmd(CMD_SET_RAMY_RANGE),     data(0x00, 0x00, 0xC7, 0x00),
        cmd(CMD_BORDER_WAVEFORM),    data(0x05),
        cmd(CMD_DISP_UPDATE_CTRL_1), data(0x00, 0x80),
        cmd(CMD_TEMP_SENSOR),        data(0x80),
        cmd(CMD_SET_RAMX_COUNTER),   data(0x00),
        cmd(CMD_SET_RAMY_COUNTER),   data(0x00, 0x00),
    )


# ── Tests ─────────────────────────────────────────────────────────────────────


class TestInitSequence:
    """The decoder must accept GxEPD2's init without complaint."""

    def test_clean_init_for_154_panel(self):
        d = SSD168xDecoder(width=200, height=200)
        gxepd2_init_154(d)
        assert d.unknown_cmds == [], (
            f"GxEPD2 init emitted unknown cmds: {d.unknown_cmds!r}"
        )
        assert d.refreshed_count == 0, "Init alone must NOT trigger a refresh"
        assert not d.in_deep_sleep

    def test_sw_reset_clears_state(self):
        d = SSD168xDecoder(width=200, height=200)
        # Pollute the BW plane.
        feed_all(d, cmd(CMD_WRITE_BLACK_VRAM), data(0x00, 0x00, 0x00))
        assert any(b != 0xFF for b in d.bw_ram[:25])
        # Reset.
        feed_all(d, cmd(CMD_SW_RESET))
        assert all(b == 0xFF for b in d.bw_ram[:25]), "SW reset must clear BW RAM"


class TestRamWindowing:
    """The X/Y range + entry-mode commands must steer pixel writes correctly."""

    def test_ramx_ramy_range_sets_window(self):
        d = SSD168xDecoder(width=200, height=200)
        feed_all(
            d,
            cmd(CMD_SET_RAMX_RANGE), data(0x00, 0x18),                # full width (0..24)
            cmd(CMD_SET_RAMY_RANGE), data(0x00, 0x00, 0xC7, 0x00),    # full height (0..199)
        )
        assert d._xrange == (0x00, 0x18)
        assert d._yrange == (0x0000, 0x00C7)

    def test_set_counters_seek_position(self):
        d = SSD168xDecoder(width=200, height=200)
        feed_all(
            d,
            cmd(CMD_SET_RAMX_COUNTER), data(0x05),
            cmd(CMD_SET_RAMY_COUNTER), data(0x10, 0x00),
        )
        assert d._x_byte == 0x05
        assert d._y == 0x0010


class TestPixelWriting:
    """Writing to the BW VRAM must land bytes in the right framebuffer position."""

    def test_write_black_vram_increments_x(self):
        d = SSD168xDecoder(width=200, height=200)
        gxepd2_init_154(d)
        feed_all(d, cmd(CMD_WRITE_BLACK_VRAM), data(0x00, 0xFF, 0xAA))
        assert d.bw_ram[0] == 0x00
        assert d.bw_ram[1] == 0xFF
        assert d.bw_ram[2] == 0xAA
        assert d._x_byte == 3
        assert d._y == 0

    def test_write_wraps_to_next_row(self):
        # Tiny window so we can hit the wrap fast (x range 0..1 = 2 bytes wide)
        d = SSD168xDecoder(width=200, height=200)
        feed_all(
            d,
            cmd(CMD_DATA_ENTRY_MODE),   data(0x03),
            cmd(CMD_SET_RAMX_RANGE),    data(0x00, 0x01),
            cmd(CMD_SET_RAMX_COUNTER),  data(0x00),
            cmd(CMD_SET_RAMY_COUNTER),  data(0x00, 0x00),
        )
        feed_all(d, cmd(CMD_WRITE_BLACK_VRAM), data(0xAA, 0xBB, 0xCC, 0xDD))
        # First two bytes go to row 0; next two to row 1.
        assert d.bw_ram[0] == 0xAA
        assert d.bw_ram[1] == 0xBB
        bpr = 25
        assert d.bw_ram[bpr + 0] == 0xCC
        assert d.bw_ram[bpr + 1] == 0xDD


class TestFrameLatchAndCompose:
    """0x20 ACTIVATE must trigger flush; red plane must win over black."""

    def test_activate_calls_on_flush(self):
        seen = []
        d = SSD168xDecoder(width=200, height=200, on_flush=lambda f: seen.append(f))
        gxepd2_init_154(d)
        # White everywhere → all bits are already 0xFF (white).
        feed_all(
            d,
            cmd(CMD_DISP_UPDATE_CTRL_2), data(0xF7),
            cmd(CMD_MASTER_ACTIVATION),
        )
        assert len(seen) == 1
        assert d.refreshed_count == 1
        frame: Frame = seen[0]
        assert frame.width == 200 and frame.height == 200
        assert all(p == 1 for p in frame.pixels), (
            "Default RAM is 0xFF (all bits=1) → all pixels must be white"
        )

    def test_red_plane_wins_over_black(self):
        # Tri-colour panel: 0x26 is the additive red plane (red wins on compose).
        d = SSD168xDecoder(width=8, height=2, is_bwr=True)   # tiny 1-byte-wide panel
        # Black plane: row 0 all-black (0x00), row 1 all-white (0xFF)
        feed_all(d, cmd(CMD_WRITE_BLACK_VRAM), data(0x00, 0xFF))
        # Red plane: row 0 first 4 px red (0xF0), row 1 nothing (0x00)
        feed_all(d, cmd(CMD_SET_RAMX_COUNTER), data(0x00))
        feed_all(d, cmd(CMD_SET_RAMY_COUNTER), data(0x00, 0x00))
        feed_all(d, cmd(CMD_WRITE_RED_VRAM), data(0xF0, 0x00))
        frame = d.compose_frame()
        # Row 0 cols 0..3: red (2). Cols 4..7: still black (0). Row 1 all white (1).
        assert frame.pixels[0:4] == [2, 2, 2, 2]
        assert frame.pixels[4:8] == [0, 0, 0, 0]
        assert frame.pixels[8:16] == [1, 1, 1, 1, 1, 1, 1, 1]


class TestDeepSleepAndUnknownCmds:
    """Deep sleep + tolerance for vendor-specific quirks."""

    def test_deep_sleep_flag_is_set(self):
        d = SSD168xDecoder(width=200, height=200)
        feed_all(d, cmd(CMD_DEEP_SLEEP), data(0x01))
        assert d.in_deep_sleep is True

    def test_unknown_cmd_is_logged_not_raised(self):
        """Real panel firmware sometimes emits vendor-specific bytes;
        the decoder logs them so we can audit later, but never raises."""
        d = SSD168xDecoder(width=200, height=200)
        feed_all(d, cmd(0xAB), data(0x01, 0x02))      # 0xAB is undefined
        assert 0xAB in d.unknown_cmds


class TestEndToEndHelloWorld:
    """A canonical 'init → write white frame with one black pixel → activate'
    flow reaches the on_flush callback with exactly one black pixel."""

    def test_single_black_pixel_at_origin(self):
        captured = []
        d = SSD168xDecoder(width=200, height=200, on_flush=lambda f: captured.append(f))
        gxepd2_init_154(d)
        # Write the BW plane: byte 0 = 0x7F (top-left pixel = 0/black, others = 1/white)
        feed_all(d, cmd(CMD_SET_RAMX_COUNTER), data(0x00))
        feed_all(d, cmd(CMD_SET_RAMY_COUNTER), data(0x00, 0x00))
        feed_all(d, cmd(CMD_WRITE_BLACK_VRAM), data(0x7F))
        feed_all(
            d,
            cmd(CMD_DISP_UPDATE_CTRL_2), data(0xF7),
            cmd(CMD_MASTER_ACTIVATION),
        )
        assert len(captured) == 1
        frame = captured[0]
        # Top-left pixel should be black (0); pixel (1, 0) should be white (1).
        assert frame.pixels[0] == 0, "top-left expected black"
        assert frame.pixels[1] == 1, "pixel (1,0) expected white"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
