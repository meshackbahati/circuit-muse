# 06 — SVG layout dimensions for the ePaper Web Component

Each panel needs:

- **active area** (W × H in canvas pixels — 1 px = 1 device pixel for accurate emulation; we don't scale up)
- **bezel** around the active area (mm → px @ 96 dpi)
- **FPC connector strip** along one short edge (where the wires attach)
- **pin tips** in `pinInfo` so wires snap correctly (per CLAUDE.md §6a)

The panel's physical size, not its resolution, drives the bezel
dimensions. We render at 1:1 device-pixel scale for the active area so
text/QR codes look right.

## Phase 1 panels (B/W mono)

| metadata id | Active area (px) | Panel total (px, body+FPC) | Notes |
|---|---|---|---|
| `epaper-1in54-bw` | 200 × 200 | 240 × 280 | square panel, 4 mm bezel + 28 mm FPC tail |
| `epaper-2in13-bw` | 250 × 122 | 290 × 170 | landscape FPC on bottom |
| `epaper-2in9-bw`  | 296 × 128 | 340 × 180 | similar to 2.13 |
| `epaper-4in2-bw`  | 400 × 300 | 440 × 360 | bigger bezel |
| `epaper-7in5-bw`  | 800 × 480 | 860 × 540 | will visually dominate the canvas — fine |

## Phase 2 panels (colour)

| metadata id | Active area | Panel total | Palette |
|---|---|---|---|
| `epaper-2in13-bwr`     | 250 × 122 | 290 × 170 | white / black / **red** |
| `epaper-5in65-7c`      | 600 × 448 | 660 × 520 | ACeP 7-colour |
| `epaper-13in3-spectra6`| 1200 × 1600 | 1260 × 1700 | Spectra 6: black/white/yellow/red/green/blue (massive — cap visual zoom at 0.4×) |

## Pin layout (right-edge FPC ribbon — same on every panel)

Every panel uses the same 8-pin standard FPC pinout. The Web Component
exposes them on the FPC tail so they all line up vertically:

```
+---------------------+
|                     |
|   Active            |
|   area              |
|   (W × H)           |
|                     |
+----+--+--+--+--+--+--+--+--+
     |  |  |  |  |  |  |  |  |
    GND VCC SCK SDI CS DC RST BUSY
```

In `pinInfo`:

```ts
get pinInfo() {
  // FPC tail starts at x = (panelW - 8*pinSpacing)/2, y = panelH
  const baseX = (this.config.totalW - 8 * 14) / 2;
  const y     = this.config.totalH;
  return [
    { name: 'GND',  x: baseX +  0, y, signals: ['GND'] },
    { name: 'VCC',  x: baseX + 14, y, signals: ['VCC'] },
    { name: 'SCK',  x: baseX + 28, y, signals: ['SCK','SCL'] },   // SPI clock
    { name: 'SDI',  x: baseX + 42, y, signals: ['MOSI','DIN'] },
    { name: 'CS',   x: baseX + 56, y },
    { name: 'DC',   x: baseX + 70, y },
    { name: 'RST',  x: baseX + 84, y },
    { name: 'BUSY', x: baseX + 98, y },
  ];
}
```

Pin names match what GxEPD2's constructor expects (`CS`, `DC`, `RST`,
`BUSY`) and what Adafruit_EPD prints in its examples — no renaming
gymnastics.

## SVG body

For Phase 1 we render a simple rounded rectangle:

- Body: `rx=4, fill=#f0f0e8` (off-white, like real e-paper)
- Bezel: 8 px inset stroke `#d0c8b8`
- FPC strip: rectangle `#d0a060` (orange flex PCB colour), 14 mm long
- "Active area" sub-`<g>` whose children are `<image>` elements bound to
  the canvas; we draw via `ctx.putImageData()` exactly like ILI9341.

For Phase 2 colour panels the body colour stays the same; only the canvas
content differs.

## Relationship to `BoardOnCanvas` / `BOARD_SIZE`

ePaper panels are **components**, not boards, so they go through
`ComponentRegistry.ts`, not `BoardOnCanvas.tsx`. No `BOARD_SIZE` entry
needed; the Web Component just declares its own width/height.

## Open questions for design review

- Do we want a "monochrome with red border" pseudo-state to indicate the
  user wired the panel reversed? (Probably no — too cute.)
- Should the SVG show the current refresh in progress (subtle white-flash
  animation while BUSY is high)? Realistic and useful as a debugging
  signal. **Yes — Phase 1.**
