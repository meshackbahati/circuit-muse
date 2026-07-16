"""ESP32 SPI slave state machines — runs inside the worker subprocess
synchronously, alongside the existing I2C slaves in
``esp32_i2c_slaves.py``.

Currently houses two ePaper decoders:

* :class:`Ssd168xEpaperSlave` — Solomon Systech SSD168x family
  (mono + B/W/Red panels, 1.54"–7.5"). Latches on opcode 0x20.
* :class:`Uc8159cEpaperSlave` — UltraChip UC8159c (ACeP 7-colour 5.65"
  GoodDisplay GDEP0565D90 / Waveshare). Latches on opcode 0x12.

Both classes have the same surface (``feed(byte, dc_high)``, ``reset()``,
``on_flush`` callback) so the worker dispatch in
``esp32_worker.py::_on_spi_event`` can route bytes by ``cs_low`` without
caring which controller is mounted.
"""
from __future__ import annotations

import base64
from dataclasses import dataclass, field
from typing import Callable, List, Optional


# ── Command opcodes (SSD1681; SSD1675/1680/1683 share these) ─────────────────

CMD_DRIVER_OUTPUT_CTRL = 0x01
CMD_GATE_DRIVING_VOLTAGE = 0x03
CMD_SOURCE_DRIVING_VOLT = 0x04
CMD_DEEP_SLEEP = 0x10
CMD_DATA_ENTRY_MODE = 0x11
CMD_SW_RESET = 0x12
CMD_TEMP_SENSOR = 0x18
CMD_MASTER_ACTIVATION = 0x20
CMD_DISP_UPDATE_CTRL_1 = 0x21
CMD_DISP_UPDATE_CTRL_2 = 0x22
CMD_WRITE_BLACK_VRAM = 0x24
CMD_WRITE_RED_VRAM = 0x26
CMD_WRITE_VCOM_REG = 0x2C
CMD_WRITE_LUT = 0x32
CMD_BORDER_WAVEFORM = 0x3C
CMD_END_OPTION = 0x3F
CMD_SET_RAMX_RANGE = 0x44
CMD_SET_RAMY_RANGE = 0x45
CMD_SET_RAMX_COUNTER = 0x4E
CMD_SET_RAMY_COUNTER = 0x4F


@dataclass
class Frame:
    """Composed B/W (and optionally red) frame ready to ship to the frontend."""
    width: int
    height: int
    pixels: bytes  # length == width * height; values 0=black, 1=white, 2=red


@dataclass
class Ssd168xEpaperSlave:
    """Stateful SSD168x SPI peripheral. Algorithm verbatim with the Python
    reference in ``test/test_epaper/ssd168x_decoder.py``."""

    component_id: str
    width: int
    height: int
    on_flush: Optional[Callable[[Frame], None]] = None
    # True for tri-colour B/W/Red panels (0x26 = additive red plane). False for
    # plain B/W panels, where some controllers (e.g. GDEY029T94) put the image
    # into 0x26 as a second mono plane.
    is_bwr: bool = False

    bw_ram: bytearray = field(init=False)
    red_ram: bytearray = field(init=False)
    # RAM geometry — sized to the LONGER side both ways so a rotated native
    # layout (a 296x128 landscape panel whose controller RAM is 128x296) is
    # captured without dropping rows. compose_frame() reads back the active
    # window and rotates to the display orientation.
    _ram_bpr: int = field(init=False, default=0)
    _ram_rows: int = field(init=False, default=0)
    _current_cmd: int = -1
    _params: List[int] = field(default_factory=list)
    _ram_target: str = "bw"
    _x_byte: int = 0
    _y: int = 0
    _xrange: tuple = (0, 0)
    _yrange: tuple = (0, 0)
    # UNION of every RAM window set since the last flush — paged drivers set one
    # partial window per page, so compose must use the union (full native area),
    # not just the last page's strip.
    _win_x0: int = 0
    _win_x1: int = 0
    _win_y0: int = 0
    _win_y1: int = 0
    _win_x_set: bool = False
    _win_y_set: bool = False
    _entry_mode: int = 0x03
    refreshed_count: int = 0
    unknown_cmds: List[int] = field(default_factory=list)
    in_deep_sleep: bool = False

    def __post_init__(self) -> None:
        long_side = max(self.width, self.height)
        self._ram_bpr = (long_side + 7) // 8
        self._ram_rows = long_side
        n = self._ram_bpr * self._ram_rows
        self.bw_ram = bytearray([0xFF] * n)
        # B/W panel: 0x26 is a second mono plane → init white. B/W/R panel:
        # 0x26 is the additive red plane → init "no red" (0x00).
        self.red_ram = bytearray([0x00 if self.is_bwr else 0xFF] * n)
        # Default active window = DISPLAY geometry (the firmware overrides via
        # 0x44/0x45 before writing). RAM is sized larger; until a window is set
        # the panel is treated as un-rotated display-sized.
        self._xrange = (0, (self.width + 7) // 8 - 1)
        self._yrange = (0, self.height - 1)

    # ── Public API ─────────────────────────────────────────────────────

    def feed(self, byte: int, dc_high: bool) -> None:
        """Process one SPI byte. ``dc_high`` mirrors the DC pin (False = command)."""
        if not dc_high:
            self._begin_command(byte & 0xFF)
        else:
            self._handle_data(byte & 0xFF)

    def reset(self) -> None:
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
        # Compose in the controller's NATIVE geometry — the active RAM window
        # the firmware actually wrote (0x44/0x45) — then rotate to the display
        # orientation. Handles panels driven with setRotation() whose native
        # RAM (e.g. 128x296) is the transpose of the display (296x128); the old
        # code assumed display==native and dropped half the rows.
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
        native = bytearray(nw * nh)
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
                        # Tri-colour: red wins, else the B/W plane decides.
                        native[out_row + x] = 2 if (r_byte & mask) else (1 if bw_white else 0)
                    else:
                        # B/W: the image may live in either plane (0x24 or 0x26),
                        # so a pixel is white only if BOTH planes say white.
                        native[out_row + x] = 1 if (bw_white and (r_byte & mask)) else 0

        # Map native -> display. `nw` is byte-padded (nw_bytes*8) so it can
        # exceed the real native width when that isn't a multiple of 8 (e.g.
        # the 2.13" panel is 122 px wide -> nw=128). Detect orientation by BYTE
        # width and crop the padding using the true native width.
        W, H = self.width, self.height
        Wb = (W + 7) // 8
        Hb = (H + 7) // 8
        if nh == H and nw_bytes == Wb:
            # Non-transposed (rotation 0): native actual width = W.
            if nw == W:
                pixels = native
            else:
                pixels = bytearray([1]) * (W * H)
                for ny in range(H):
                    s = ny * nw
                    d = ny * W
                    for x in range(W):
                        pixels[d + x] = native[s + x]
        elif nh == W and nw_bytes == Hb and nh:
            # Transposed (rotation 1): native actual width = H. Inverse of
            # Adafruit_GFX rotation 1: native(x_raw,y_raw) -> display(xd=y_raw,
            # yd=Wn-1-x_raw), Wn = true native width = H.
            pixels = bytearray([1]) * (W * H)
            wn = H
            for ny in range(nh):       # ny = y_raw  (0..W-1)
                if ny >= W:
                    break
                src = ny * nw
                for x in range(wn):    # x = x_raw  (0..H-1, true native width)
                    pixels[(wn - 1 - x) * W + ny] = native[src + x]
        else:
            # Unexpected geometry — best-effort top-left copy onto white.
            pixels = bytearray([1]) * (W * H)
            for ny in range(min(nh, H)):
                s = ny * nw
                d = ny * W
                for x in range(min(nw, W)):
                    pixels[d + x] = native[s + x]
        return Frame(W, H, bytes(pixels))

    def compose_frame_b64(self) -> str:
        """Convenience for the worker — same as compose_frame() but base64-encoded."""
        return base64.b64encode(self.compose_frame().pixels).decode("ascii")

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
                try:
                    self.on_flush(frame)
                except Exception:
                    # Never let the frontend hook raise back into QEMU thread.
                    pass
            return
        if cmd == CMD_WRITE_BLACK_VRAM:
            self._ram_target = "bw"
            return
        if cmd == CMD_WRITE_RED_VRAM:
            self._ram_target = "red"
            return
        if cmd in (
            CMD_DRIVER_OUTPUT_CTRL, CMD_GATE_DRIVING_VOLTAGE,
            CMD_SOURCE_DRIVING_VOLT, CMD_DEEP_SLEEP, CMD_DATA_ENTRY_MODE,
            CMD_TEMP_SENSOR, CMD_DISP_UPDATE_CTRL_1, CMD_DISP_UPDATE_CTRL_2,
            CMD_WRITE_VCOM_REG, CMD_WRITE_LUT, CMD_BORDER_WAVEFORM,
            CMD_END_OPTION, CMD_SET_RAMX_RANGE, CMD_SET_RAMY_RANGE,
            CMD_SET_RAMX_COUNTER, CMD_SET_RAMY_COUNTER,
        ):
            return
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

    def _write_ram_byte(self, plane: bytearray, byte: int) -> None:
        if 0 <= self._x_byte < self._ram_bpr and 0 <= self._y < self._ram_rows:
            plane[self._y * self._ram_bpr + self._x_byte] = byte
        x_inc = (self._entry_mode & 0x01) == 0x01
        y_inc = (self._entry_mode & 0x02) == 0x02
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
            # the 0x26 plane without re-seeking the counter, relying on this
            # wrap so the second plane lands in the window.
            if y_inc:
                self._y = self._yrange[0] if self._y >= self._yrange[1] else self._y + 1
            else:
                self._y = self._yrange[1] if self._y <= self._yrange[0] else self._y - 1


# ── UC8159c (ACeP 7-colour 5.65" GoodDisplay GDEP0565D90) ───────────────────
#
# Different command set from SSD168x. Pixel packing: 2 px per byte, upper
# nibble = first pixel, each nibble's lower 3 bits = palette index 0..6.

UC_CMD_PANEL_SETTING = 0x00
UC_CMD_POWER_SETTING = 0x01
UC_CMD_POWER_OFF = 0x02
UC_CMD_POWER_OFF_SEQ = 0x03
UC_CMD_POWER_ON = 0x04
UC_CMD_BOOSTER_SOFT_START = 0x06
UC_CMD_DEEP_SLEEP = 0x07
UC_CMD_DTM1 = 0x10
UC_CMD_DISPLAY_REFRESH = 0x12
UC_CMD_PLL_CONTROL = 0x30
UC_CMD_TSE = 0x41
UC_CMD_VCOM_DATA_INTERVAL = 0x50
UC_CMD_TCON_SETTING = 0x60
UC_CMD_RESOLUTION_SETTING = 0x61
UC_CMD_PWS = 0xE3


@dataclass
class Uc8159cEpaperSlave:
    """ACeP 7-colour decoder. Latches on 0x12 DRF and emits a Frame whose
    `pixels` are 1 byte/pixel palette indices (0=black .. 6=orange). The
    worker maps those indices to RGB on the frontend side."""

    component_id: str
    width: int
    height: int
    on_flush: Optional[Callable[[Frame], None]] = None

    ram: bytearray = field(init=False)
    _write_idx: int = 0
    _current_cmd: int = -1
    _params: List[int] = field(default_factory=list)
    refreshed_count: int = 0
    unknown_cmds: List[int] = field(default_factory=list)
    in_deep_sleep: bool = False
    powered_on: bool = False

    def __post_init__(self) -> None:
        # Default to all-white (index 1) so a freshly-mounted panel doesn't
        # render as transparent.
        self.ram = bytearray([1] * (self.width * self.height))

    # ── Public API ─────────────────────────────────────────────────────

    def feed(self, byte: int, dc_high: bool) -> None:
        if not dc_high:
            self._begin_command(byte & 0xFF)
        else:
            self._handle_data(byte & 0xFF)

    def reset(self) -> None:
        self.ram = bytearray([1] * (self.width * self.height))
        self._write_idx = 0
        self._current_cmd = -1
        self._params = []
        self.refreshed_count = 0
        self.powered_on = False
        self.in_deep_sleep = False

    def compose_frame(self) -> Frame:
        return Frame(self.width, self.height, bytes(self.ram))

    def compose_frame_b64(self) -> str:
        return base64.b64encode(bytes(self.ram)).decode("ascii")

    # ── Internal: command / data dispatch ──────────────────────────────

    def _begin_command(self, cmd: int) -> None:
        self._current_cmd = cmd
        self._params = []

        if cmd == UC_CMD_POWER_ON:
            self.powered_on = True
            return
        if cmd == UC_CMD_POWER_OFF:
            self.powered_on = False
            return
        if cmd == UC_CMD_DTM1:
            self._write_idx = 0
            return
        if cmd == UC_CMD_DISPLAY_REFRESH:
            self.refreshed_count += 1
            frame = self.compose_frame()
            if self.on_flush:
                try:
                    self.on_flush(frame)
                except Exception:
                    pass
            return
        if cmd == UC_CMD_DEEP_SLEEP:
            return
        if cmd in (
            UC_CMD_PANEL_SETTING, UC_CMD_POWER_SETTING, UC_CMD_POWER_OFF_SEQ,
            UC_CMD_BOOSTER_SOFT_START, UC_CMD_PLL_CONTROL, UC_CMD_TSE,
            UC_CMD_VCOM_DATA_INTERVAL, UC_CMD_TCON_SETTING,
            UC_CMD_RESOLUTION_SETTING, UC_CMD_PWS,
        ):
            return
        self.unknown_cmds.append(cmd)

    def _handle_data(self, byte: int) -> None:
        cmd = self._current_cmd
        self._params.append(byte)

        if cmd == UC_CMD_DEEP_SLEEP:
            if byte == 0xA5:
                self.in_deep_sleep = True
            return

        if cmd == UC_CMD_DTM1:
            total = self.width * self.height
            if self._write_idx < total:
                self.ram[self._write_idx] = (byte >> 4) & 0x07
                self._write_idx += 1
            if self._write_idx < total:
                self.ram[self._write_idx] = byte & 0x07
                self._write_idx += 1


# ── UC8179 / GD7965 (mono B/W 7.5" 800x480 Waveshare/GoodDisplay) ────────────
#
# UltraChip UC8179 — same command FAMILY as the UC8159c (0x10/0x13 DTM, 0x12
# refresh) but MONO (1 bit/px, 8 px/byte) with a partial window (0x90).
# GxEPD2_750_T7 writes the VISIBLE image to 0x13 (DTM2 "current"); 0x10 is the
# "previous" buffer (ignored). Each image write is framed 0x91 (partial in) /
# 0x90 (window x0/x1/y0/y1 in pixels, MSB-first, byte-aligned x) / 0x13 +
# row-major 1bpp data / 0x92 (partial out). Latches on 0x12. The composed Frame
# uses the SSD168x palette (0=black, 1=white) — `0xFF is white` per the driver —
# so the existing frontend paintFrame renders it. Data lands at ABSOLUTE pixel
# coords inside the window, so compose is just the RAM (no rotation/no union).

UC8179_CMD_POWER_OFF        = 0x02
UC8179_CMD_POWER_ON         = 0x04
UC8179_CMD_DEEP_SLEEP       = 0x07
UC8179_CMD_DTM1             = 0x10   # previous/old buffer (ignored)
UC8179_CMD_DISPLAY_REFRESH  = 0x12
UC8179_CMD_DTM2             = 0x13   # current/new image (the visible one)
UC8179_CMD_PARTIAL_WINDOW   = 0x90


@dataclass
class Uc8179EpaperSlave:
    """Mono UC8179/GD7965 decoder (7.5" 800x480). Latches on 0x12 DRF and emits
    a Frame with 1 byte/pixel (0=black, 1=white)."""

    component_id: str
    width: int
    height: int
    on_flush: Optional[Callable[[Frame], None]] = None

    ram: bytearray = field(init=False)
    _current_cmd: int = -1
    _params: List[int] = field(default_factory=list)
    _active_visible: bool = False       # True while streaming 0x13 (DTM2)
    _win_x0: int = 0
    _win_x1: int = 0
    _win_y0: int = 0
    _win_y1: int = 0
    _cx: int = 0
    _cy: int = 0
    refreshed_count: int = 0
    unknown_cmds: List[int] = field(default_factory=list)
    in_deep_sleep: bool = False

    def __post_init__(self) -> None:
        self.ram = bytearray([1] * (self.width * self.height))  # white
        self._win_x1 = self.width - 1
        self._win_y1 = self.height - 1

    def feed(self, byte: int, dc_high: bool) -> None:
        if not dc_high:
            self._begin_command(byte & 0xFF)
        else:
            self._handle_data(byte & 0xFF)

    def reset(self) -> None:
        self.ram = bytearray([1] * (self.width * self.height))
        self._current_cmd = -1
        self._params = []
        self._active_visible = False
        self._win_x0 = 0
        self._win_x1 = self.width - 1
        self._win_y0 = 0
        self._win_y1 = self.height - 1
        self._cx = 0
        self._cy = 0
        self.in_deep_sleep = False

    def compose_frame(self) -> Frame:
        return Frame(self.width, self.height, bytes(self.ram))

    def compose_frame_b64(self) -> str:
        return base64.b64encode(bytes(self.ram)).decode("ascii")

    def _begin_command(self, cmd: int) -> None:
        self._current_cmd = cmd
        self._params = []
        if cmd == UC8179_CMD_DTM2:
            self._active_visible = True
            self._cx, self._cy = self._win_x0, self._win_y0
            return
        if cmd == UC8179_CMD_DTM1:
            self._active_visible = False    # old buffer — ignore its data
            return
        if cmd == UC8179_CMD_DISPLAY_REFRESH:
            self.refreshed_count += 1
            frame = self.compose_frame()
            if self.on_flush:
                try:
                    self.on_flush(frame)
                except Exception:
                    pass
            return
        # 0x90 + init commands consume their data in _handle_data; others no-op.

    def _handle_data(self, byte: int) -> None:
        cmd = self._current_cmd
        self._params.append(byte)
        if cmd == UC8179_CMD_DEEP_SLEEP:
            if byte == 0xA5:
                self.in_deep_sleep = True
            return
        if cmd == UC8179_CMD_PARTIAL_WINDOW and len(self._params) == 9:
            p = self._params
            self._win_x0 = (p[0] << 8) | p[1]
            self._win_x1 = (p[2] << 8) | p[3]
            self._win_y0 = (p[4] << 8) | p[5]
            self._win_y1 = (p[6] << 8) | p[7]
            return
        if cmd == UC8179_CMD_DTM2 and self._active_visible:
            self._write_image_byte(byte)

    def _write_image_byte(self, byte: int) -> None:
        # 8 px, MSB = leftmost. bit=1 -> white(1), bit=0 -> black(0).
        w, h = self.width, self.height
        cy = self._cy
        if 0 <= cy < h:
            base = cy * w
            for k in range(8):
                x = self._cx + k
                if self._win_x0 <= x <= self._win_x1 and 0 <= x < w:
                    self.ram[base + x] = 1 if (byte & (0x80 >> k)) else 0
        self._cx += 8
        if self._cx > self._win_x1:
            self._cx = self._win_x0
            self._cy += 1
