"""Reference SSD168x SPI decoder — pure Python, no QEMU, no DOM.

This is the **specification** the Velxio frontend emulator must match.
It exists alongside the actual TS implementation so we can:

  1. Validate the SPI command set against published datasheets without
     spinning up Vite / Vitest / a browser.
  2. Drive the same byte streams through this decoder and the future TS
     decoder and assert the resulting framebuffers are identical.
  3. Catch SSD1681 / SSD1675 / SSD1680 / SSD1683 quirks early — every
     panel that uses a SSD168x part funnels through this one decoder.

The decoder is intentionally minimal: it consumes the bytes the
GxEPD2 / Adafruit_EPD libraries emit, builds a 1-bit-per-pixel
framebuffer, and exposes ``flush()`` to capture the latched image when
the firmware sends 0x20 ACTIVATE.

References:
  - SSD1681 datasheet (Adafruit mirror):
    https://cdn-learn.adafruit.com/assets/assets/000/099/573/original/SSD1681.pdf
  - ESP-BSP command header:
    https://github.com/espressif/esp-bsp/blob/master/components/lcd/esp_lcd_ssd1681/esp_lcd_ssd1681_commands.h
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, List, Optional


# ── Command opcodes (SSD1681; SSD1675/1680/1683 share these) ─────────────────

CMD_DRIVER_OUTPUT_CTRL    = 0x01
CMD_GATE_DRIVING_VOLTAGE  = 0x03
CMD_SOURCE_DRIVING_VOLT   = 0x04
CMD_DEEP_SLEEP            = 0x10
CMD_DATA_ENTRY_MODE       = 0x11
CMD_SW_RESET              = 0x12
CMD_TEMP_SENSOR           = 0x18
CMD_MASTER_ACTIVATION     = 0x20
CMD_DISP_UPDATE_CTRL_1    = 0x21
CMD_DISP_UPDATE_CTRL_2    = 0x22
CMD_WRITE_BLACK_VRAM      = 0x24
CMD_WRITE_RED_VRAM        = 0x26
CMD_WRITE_VCOM_REG        = 0x2C
CMD_WRITE_LUT             = 0x32
CMD_BORDER_WAVEFORM       = 0x3C
CMD_END_OPTION            = 0x3F
CMD_SET_RAMX_RANGE        = 0x44
CMD_SET_RAMY_RANGE        = 0x45
CMD_SET_RAMX_COUNTER      = 0x4E
CMD_SET_RAMY_COUNTER      = 0x4F


# ── Framebuffer model ────────────────────────────────────────────────────────

@dataclass
class Frame:
    """Composed B/W (and optionally red) frame, ready to render.

    ``pixels`` is a list of ints, one per pixel, in the panel-native
    palette: 0 = black, 1 = white, 2 = red (only when red plane was
    written). Length is always ``width * height``.
    """
    width: int
    height: int
    pixels: List[int]


# ── Decoder ──────────────────────────────────────────────────────────────────

@dataclass
class SSD168xDecoder:
    """SPI-byte stream → latched framebuffer.

    Usage:
        d = SSD168xDecoder(width=200, height=200)
        for byte, dc in spi_trace:        # dc=False (LOW) for cmd, True for data
            d.feed(byte, dc)
        # When the firmware sends 0x20 ACTIVATE, on_flush is invoked.
    """
    width: int
    height: int
    on_flush: Optional[Callable[[Frame], None]] = None
    # True for tri-colour B/W/Red panels (0x26 = additive red plane). False for
    # plain B/W panels, where some controllers (e.g. GDEY029T94) put the image
    # into 0x26 as a second mono plane.
    is_bwr: bool = False

    # Internal state
    bw_ram: bytearray = field(init=False)
    red_ram: bytearray = field(init=False)
    # RAM sized to the LONGER side both ways so a rotated native layout (a
    # 296x128 landscape panel whose controller RAM is 128x296) is captured
    # without dropping rows. compose_frame() reads back the active window and
    # rotates to the display orientation.
    _ram_bpr: int = field(init=False, default=0)
    _ram_rows: int = field(init=False, default=0)
    _current_cmd: int = -1
    _params: List[int] = field(default_factory=list)
    _ram_target: str = "bw"           # 'bw' or 'red' — which plane we're writing
    _x_byte: int = 0                   # current X position (in bytes — 8 px/byte)
    _y: int = 0                        # current Y position (scanline)
    _xrange: tuple = (0, 0)            # (start_byte, end_byte) — last window set
    _yrange: tuple = (0, 0)            # (start_y, end_y) — last window set
    # UNION of every RAM window set since the last flush — paged drivers set one
    # partial window per page, so compose uses the union (full native area).
    _win_x0: int = 0
    _win_x1: int = 0
    _win_y0: int = 0
    _win_y1: int = 0
    _win_x_set: bool = False
    _win_y_set: bool = False
    _entry_mode: int = 0x03            # x+ y+ x-first (default for most drivers)
    refreshed_count: int = 0           # how many MASTER_ACTIVATIONs we've seen
    unknown_cmds: List[int] = field(default_factory=list)
    in_deep_sleep: bool = False

    def __post_init__(self) -> None:
        long_side = max(self.width, self.height)
        self._ram_bpr = (long_side + 7) // 8
        self._ram_rows = long_side
        n = self._ram_bpr * self._ram_rows
        self.bw_ram = bytearray([0xFF] * n)
        # B/W panel: 0x26 is a second mono plane -> init white. B/W/R panel:
        # 0x26 is the additive red plane -> init "no red" (0x00).
        self.red_ram = bytearray([0x00 if self.is_bwr else 0xFF] * n)
        # Default active window = DISPLAY geometry (firmware overrides via
        # 0x44/0x45 before writing).
        self._xrange = (0, (self.width + 7) // 8 - 1)
        self._yrange = (0, self.height - 1)

    # ── Public API ─────────────────────────────────────────────────────

    def feed(self, byte: int, dc_high: bool) -> None:
        """Process one SPI byte. ``dc_high`` mirrors the DC pin (False = command)."""
        if not dc_high:
            self._begin_command(byte)
        else:
            self._handle_data(byte)

    def reset(self) -> None:
        """Clear all state — equivalent to a hardware RST low pulse."""
        n = self._ram_bpr * self._ram_rows
        self.bw_ram = bytearray([0xFF] * n)
        self.red_ram = bytearray([0x00 if self.is_bwr else 0xFF] * n)
        self._current_cmd = -1
        self._params = []
        self._ram_target = "bw"
        self._x_byte = 0
        self._y = 0
        self._entry_mode = 0x03
        self._xrange = (0, (self.width + 7) // 8 - 1)
        self._yrange = (0, self.height - 1)
        self._win_x_set = False
        self._win_y_set = False
        self.in_deep_sleep = False

    def compose_frame(self) -> Frame:
        """Build a Frame from the latched RAM planes.

        Compose in the controller's NATIVE geometry — the active RAM window the
        firmware wrote (0x44/0x45) — then rotate to the display orientation, so
        panels driven with setRotation() (native RAM = transpose of the display)
        render upright. Tri-colour: red wins. B/W: white only if BOTH planes say
        white (the image may live in 0x24 or 0x26).
        """
        # Use the UNION of windows set this frame (paged drivers set one partial
        # window per page); fall back to the display geometry if none was set.
        if self._win_x_set:
            x0, x1 = self._win_x0, self._win_x1
        else:
            x0, x1 = 0, (self.width + 7) // 8 - 1
        if self._win_y_set:
            y0, y1 = self._win_y0, self._win_y1
        else:
            y0, y1 = 0, self.height - 1
        nw_bytes = max(0, x1 - x0 + 1)
        nw = nw_bytes * 8            # native width (px)
        nh = max(0, y1 - y0 + 1)     # native height (rows)
        native = [0] * (nw * nh)
        for ny in range(nh):
            row = (y0 + ny) * self._ram_bpr + x0
            out_row = ny * nw
            for xb in range(nw_bytes):
                b_byte = self.bw_ram[row + xb]
                r_byte = self.red_ram[row + xb]
                base = xb << 3
                for bit in range(8):
                    x = base + bit
                    if x >= nw:
                        break
                    mask = 0x80 >> bit
                    bw_white = bool(b_byte & mask)
                    if self.is_bwr:
                        native[out_row + x] = 2 if (r_byte & mask) else (1 if bw_white else 0)
                    else:
                        native[out_row + x] = 1 if (bw_white and (r_byte & mask)) else 0

        # Map native -> display (nw is byte-padded; detect orientation by byte
        # width and crop padding with the true native width).
        W, H = self.width, self.height
        Wb = (W + 7) // 8
        Hb = (H + 7) // 8
        if nh == H and nw_bytes == Wb:
            if nw == W:
                pixels = native
            else:
                pixels = [1] * (W * H)
                for ny in range(H):
                    s = ny * nw
                    d = ny * W
                    for x in range(W):
                        pixels[d + x] = native[s + x]
        elif nh == W and nw_bytes == Hb and nh:
            # Transposed (rotation 1): native actual width = H. Inverse of
            # Adafruit_GFX rotation 1: native(x_raw,y_raw)->display(xd=y_raw,
            # yd=Wn-1-x_raw), Wn = true native width = H.
            pixels = [1] * (W * H)
            wn = H
            for ny in range(nh):
                if ny >= W:
                    break
                src = ny * nw
                for x in range(wn):
                    pixels[(wn - 1 - x) * W + ny] = native[src + x]
        else:
            pixels = [1] * (W * H)
            for ny in range(min(nh, H)):
                s = ny * nw
                d = ny * W
                for x in range(min(nw, W)):
                    pixels[d + x] = native[s + x]
        return Frame(W, H, pixels)

    # ── Internal: command / data dispatch ──────────────────────────────

    def _begin_command(self, cmd: int) -> None:
        self._current_cmd = cmd
        self._params = []

        if cmd == CMD_SW_RESET:
            self.reset()
            return
        if cmd == CMD_MASTER_ACTIVATION:
            self.refreshed_count += 1
            frame = self.compose_frame()
            # Start a fresh window union for the next frame's pages.
            self._win_x_set = False
            self._win_y_set = False
            if self.on_flush:
                self.on_flush(frame)
            return
        if cmd == CMD_WRITE_BLACK_VRAM:
            self._ram_target = "bw"
            return
        if cmd == CMD_WRITE_RED_VRAM:
            self._ram_target = "red"
            return
        if cmd in (
            # Known commands that consume data — handled in _handle_data.
            CMD_DRIVER_OUTPUT_CTRL, CMD_GATE_DRIVING_VOLTAGE,
            CMD_SOURCE_DRIVING_VOLT, CMD_DEEP_SLEEP, CMD_DATA_ENTRY_MODE,
            CMD_TEMP_SENSOR, CMD_DISP_UPDATE_CTRL_1, CMD_DISP_UPDATE_CTRL_2,
            CMD_WRITE_VCOM_REG, CMD_WRITE_LUT, CMD_BORDER_WAVEFORM,
            CMD_END_OPTION, CMD_SET_RAMX_RANGE, CMD_SET_RAMY_RANGE,
            CMD_SET_RAMX_COUNTER, CMD_SET_RAMY_COUNTER,
        ):
            return
        # Anything else: log and silently consume so init flows complete.
        self.unknown_cmds.append(cmd)

    def _handle_data(self, byte: int) -> None:
        cmd = self._current_cmd
        params = self._params
        params.append(byte)

        if cmd == CMD_DEEP_SLEEP and len(params) == 1:
            self.in_deep_sleep = byte != 0
        elif cmd == CMD_DATA_ENTRY_MODE and len(params) == 1:
            self._entry_mode = byte
        elif cmd == CMD_SET_RAMX_RANGE and len(params) == 2:
            self._xrange = (params[0], params[1])
            self._x_byte = params[0]
            if not self._win_x_set:
                self._win_x0, self._win_x1 = params[0], params[1]
                self._win_x_set = True
            else:
                self._win_x0 = min(self._win_x0, params[0])
                self._win_x1 = max(self._win_x1, params[1])
        elif cmd == CMD_SET_RAMY_RANGE and len(params) == 4:
            self._yrange = (params[0] | (params[1] << 8),
                            params[2] | (params[3] << 8))
            self._y = self._yrange[0]
            if not self._win_y_set:
                self._win_y0, self._win_y1 = self._yrange
                self._win_y_set = True
            else:
                self._win_y0 = min(self._win_y0, self._yrange[0])
                self._win_y1 = max(self._win_y1, self._yrange[1])
        elif cmd == CMD_SET_RAMX_COUNTER and len(params) == 1:
            self._x_byte = byte
        elif cmd == CMD_SET_RAMY_COUNTER and len(params) == 2:
            self._y = params[0] | (params[1] << 8)
        elif cmd == CMD_WRITE_BLACK_VRAM:
            self._write_ram_byte(self.bw_ram, byte)
        elif cmd == CMD_WRITE_RED_VRAM:
            self._write_ram_byte(self.red_ram, byte)
        # Other commands silently buffer their parameters.

    def _write_ram_byte(self, plane: bytearray, byte: int) -> None:
        if 0 <= self._x_byte < self._ram_bpr and 0 <= self._y < self._ram_rows:
            plane[self._y * self._ram_bpr + self._x_byte] = byte
        # Auto-increment per data_entry_mode (default x+, then y+ at end of row).
        x_inc = (self._entry_mode & 0x01) == 0x01    # bit0: 1 = X+
        y_inc = (self._entry_mode & 0x02) == 0x02    # bit1: 1 = Y+
        end_of_row = False
        if x_inc:
            if self._x_byte < self._xrange[1]:
                self._x_byte += 1
            else:
                self._x_byte = self._xrange[0]
                end_of_row = True
        else:
            if self._x_byte > self._xrange[0]:
                self._x_byte -= 1
            else:
                self._x_byte = self._xrange[1]
                end_of_row = True
        if end_of_row:
            # Advance Y, WRAPPING at the window boundary like the SSD168x RAM
            # address counter. Some drivers (e.g. GxEPD2_3C) write the 0x24 then
            # the 0x26 plane without re-seeking the counter, relying on this wrap
            # so the second plane lands in the window.
            if y_inc:
                self._y = self._yrange[0] if self._y >= self._yrange[1] else self._y + 1
            else:
                self._y = self._yrange[1] if self._y <= self._yrange[0] else self._y - 1
