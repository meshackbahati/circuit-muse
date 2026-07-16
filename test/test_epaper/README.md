# test_epaper — ePaper / e-Ink display emulation

Workspace for adding ePaper (electrophoretic) display support to Velxio.
Built off the ILI9341 / SSD1306 patterns already living in
[`frontend/src/simulation/parts/ComplexParts.ts`](../../frontend/src/simulation/parts/ComplexParts.ts)
and [`frontend/src/simulation/parts/ProtocolParts.ts`](../../frontend/src/simulation/parts/ProtocolParts.ts).

## Layout

```
test_epaper/
├── README.md                    ← this file
├── autosearch/                  ← research dossier (markdown only)
│   ├── 00_overview.md           ← what ePaper is + why emulation differs
│   ├── 01_seeed_models.md       ← target panels from seeedstudio.com
│   ├── 02_controllers.md        ← SSD1675 / SSD1681 / UC8159 / IT8951 …
│   ├── 03_spi_protocol.md       ← command/data framing, BUSY pin, refresh sequence
│   ├── 04_arduino_libraries.md  ← GxEPD2, Adafruit_EPD, Pervasive matrix
│   ├── 05_velxio_existing.md    ← how SSD1306 + ILI9341 are wired today
│   ├── 06_svg_layouts.md        ← physical dimensions for the SVG components
│   └── 07_emulation_plan.md     ← phased implementation plan
├── datasheets/                  ← controller PDFs (gitignored — fetched on demand)
├── sketches/                    ← Arduino sketches used by the E2E tests
└── test_*.py / test_*.ts        ← actual tests (TBD)
```

## Status

- **Research phase**: read `autosearch/` to see what's been investigated.
- **Tests phase**: pytest tests verify SPI protocol decoding without QEMU; sketch tests verify cross-board compilation; E2E pixel-buffer tests come last (blocked on emulator scaffold).

## How to run (when tests exist)

```bash
# Pure Python protocol decoder tests (no backend, no QEMU)
pytest test/test_epaper/ -v

# Cross-board sketch compile (requires backend on :8765)
VELXIO_BACKEND_URL=http://127.0.0.1:8765 pytest test/test_epaper/test_compile_*.py -v
```
