# 00 — ePaper / e-Ink overview (why emulation is non-trivial)

## What an ePaper panel is

Electrophoretic display panels use charged pigment particles in microcapsules
that move in response to an electric field. Unlike OLED or TFT-LCD:

| Property | TFT/OLED (ILI9341, SSD1306) | ePaper (SSD1681, UC8159, …) |
|---|---|---|
| Refresh model | Continuous (per-frame) | One-shot per update |
| Latency | µs per pixel | **0.5 – 30 s per frame** |
| Power when idle | Backlight on | **Zero** (image is bistable) |
| Framebuffer | Driver IC RAM (volatile) | Driver IC RAM (also volatile, but only flushed on update command) |
| Per-pixel data | 16/24-bit colour | 1-bit (B/W), 2-bit (red/yellow), 3-bit (Spectra 6 / 7-colour ACeP) |
| Update granularity | Pixel-level | Whole-frame (most chips) or coarse partial-window (SSD1681 etc.) |
| BUSY pin | None | **Required** — host MUST poll it before/after each refresh |

## Implication for Velxio's emulator

A correct ePaper component needs four things our existing display
emulation (`ili9341`, `ssd1306`) doesn't have:

1. **Latched framebuffer.** Pixels written via the `WRITE_RAM` command (0x24
   for SSD1681) only become visible when the host issues
   `MASTER_ACTIVATION` (0x20) after `DISPLAY_UPDATE_CONTROL_2` (0x22). We
   must hold the writes off-screen and only flush on the activation pulse.
2. **Driveable BUSY pin.** A real panel pulls BUSY high during refresh; the
   driver libraries (GxEPD2, Adafruit_EPD) busy-wait on it. The emulator
   must drive BUSY high for a configurable duration (~1 s mono, ~12 s
   Spectra 6) so polling firmware sees realistic timing.
3. **DC + RST + CS + BUSY** — four extra pins beyond the standard SPI trio.
   Our `pin_map` must surface them so the user can wire them via their
   chosen GPIOs.
4. **Multi-RAM colour planes.** SSD1675/SSD1681 black/red have two separate
   RAM commands (`0x24` black, `0x26` red); UC8159c packs four pixels per
   byte into a single plane. The emulator must maintain N independent
   planes and combine them at flush time.

## Out of scope (initially)

- **Greyscale / waveform tables (LUT 0x32).** Real panels accept a 70+ byte
  LUT that defines voltage levels per timing slot. We'll accept the bytes
  silently and snap to nearest displayable colour.
- **Partial refresh.** Our first cut renders the whole frame on every
  `MASTER_ACTIVATION`; partial-window mode (SSD1681 LUT_RED) is a Phase 2
  refinement.
- **IT8951 large-panel parallel mode.** That's a 4/8/16-bit parallel
  interface, not SPI — out of scope until someone asks for it.

## Goal of this folder

Pin down the data we need (datasheets, command lists, library quirks) so a
single `epaper-element.ts` Web Component + `EPaperPart` simulation hook can
support every Seeed XIAO ePaper kit and the standard GxEPD2 panel zoo with
one unified controller-aware decoder.
