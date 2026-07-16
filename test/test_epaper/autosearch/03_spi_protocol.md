# 03 — ePaper SPI protocol details (what we have to decode)

## Wiring (the 8-wire interface every Velxio panel will share)

Even across families (SSD1681 / UC8159 / Spectra 6) the **physical
interface is the same six signals** plus power:

| Pin name | Direction (host → panel) | Purpose |
|---|---|---|
| **VCC** | power | 3.3 V |
| **GND** | power | ground |
| **CLK** (SCK) | host → panel | SPI clock, mode 0, 4–20 MHz |
| **DIN** (MOSI) | host → panel | SPI data |
| **CS** | host → panel | active low chip select |
| **DC** (D/C, RS) | host → panel | **LOW = command byte, HIGH = data byte** |
| **RST** | host → panel | active-low hardware reset (>200 µs) |
| **BUSY** | panel → host | **HIGH while controller is working** (poll before next op) |

Some panels (the Solomon family with red ink) also expose a MISO line, but
neither GxEPD2 nor Adafruit_EPD reads back from it in practice.

## Frame in vs. command in

The DC pin distinguishes:

```
  ┌── CS asserted ──────────────────────────────────────────────────┐
  │                                                                  │
  │  DC = LOW    1 byte  → command opcode                            │
  │  DC = HIGH   N bytes → command parameters / pixel data           │
  │                                                                  │
  │  CS may stay asserted across the cmd→data transition; many       │
  │  drivers lower CS once per (cmd, data...) pair instead.          │
  └──────────────────────────────────────────────────────────────────┘
```

The state machine the emulator needs:

```
state ∈ { IDLE, WAIT_CMD, COLLECT_DATA(cmd) }

on CS falling edge:    state ← WAIT_CMD
on DC sample at SCK:   if DC=LOW  → state ← WAIT_CMD
                       if DC=HIGH → state ← COLLECT_DATA(cmd)
on byte received:
  if state == WAIT_CMD: cmd ← byte; state ← COLLECT_DATA(cmd)
  if state == COLLECT_DATA(cmd): apply parameter or pixel data
on CS rising edge: state ← IDLE
```

Note the GxEPD2 / Adafruit_EPD libraries actually re-toggle DC for every
write — they don't keep CS asserted for long bursts — so a per-byte DC
sample is sufficient.

## BUSY pin semantics

After almost every command that triggers physical movement of pigment,
the controller pulls BUSY **high**. The libraries poll BUSY in a tight
loop (with a 10 ms `delay()` between samples). The emulator must:

1. After accepting `0x20` ACTIVE_DISPLAY_UPDATE: drive BUSY high.
2. After a configurable refresh duration (1 s mono, 12 s Spectra 6),
   drive BUSY low.
3. During HW reset (RST low) the controller re-asserts BUSY high until it
   finishes its internal init (~10 ms).

For the emulator, "configurable refresh duration" doesn't have to be real
seconds — we can shrink it to ~50 ms for snappy testing as long as it's
**non-zero** so the firmware's busy-wait loop sees a transition.

## Two independent RAM planes (B/W/R panels)

Tri-colour SSD1675/1680 panels have **two** RAM planes:

- `0x24` WRITE_BLACK_VRAM — black/white plane (1 = white, 0 = black)
- `0x26` WRITE_RED_VRAM — red plane (1 = red, 0 = transparent / underlying B/W)

Compositing rule used by every SSD168x driver: **red wins over black**.
On flush, for each pixel:

```
if red_plane[x,y] == 1:  pixel = RED
elif bw_plane[x,y] == 1: pixel = WHITE
else:                    pixel = BLACK
```

UC8159c (5.65" 7-colour ACeP) is different: **single plane, 4 bits/pixel
packed 2 px/byte**, mapped to a 7-colour palette. Spectra 6 uses 3
bits/pixel packed 2 px/byte (with a 6-colour palette).

## RAM addressing model (Solomon family)

Pixels live in a rectangular window selected by:

- `0x44 SET_RAMX_RANGE` — start_col, end_col (bytes; 1 byte = 8 horizontal pixels)
- `0x45 SET_RAMY_RANGE` — start_row, end_row (in scanlines; 16 bits each)
- `0x4E SET_RAMX_COUNTER` — current X (bytes)
- `0x4F SET_RAMY_COUNTER` — current Y (scanlines)
- `0x11 DATA_ENTRY_MODE` — bit 0: Y direction (0 = decrement, 1 = increment)
                          bit 1: X direction (0 = decrement, 1 = increment)
                          bit 2: address counter update direction (0 = X first, 1 = Y first)

Most drivers use `0x03` (X+, Y+, X-first) which means the RAM auto-increments
column-by-column, then jumps to the next row. So a 200×200 panel needs
200/8 = 25 bytes/row × 200 rows = 5000 bytes per `0x24` WRITE.

## Sources

- SSD1681 datasheet (commands 0x00–0x4F): see `02_controllers.md`
- ESPHome `waveshare_epaper.cpp` (canonical reference for many panels):
  <https://api-docs.esphome.io/waveshare__epaper_8cpp_source>
- GxEPD2 source: <https://github.com/ZinggJM/GxEPD2/tree/master/src>
- Solomon Systech SSD1681 product page:
  <https://www.solomon-systech.com/product/ssd1681/>
