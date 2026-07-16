# 05 — How Velxio currently wires SPI/I2C displays (the pattern to follow)

We already have two display emulators that Phase 1 ePaper should mirror.

## SSD1306 — I2C OLED

- **Web Component**: `wokwi-ssd1306` (third-party, comes from `@wokwi/elements`)
- **Simulation hook**: `frontend/src/simulation/parts/ProtocolParts.ts:312`
  registers as `ssd1306` and listens on the simulator's I2C bus.
- **Render path**: maintains a 1-bit GDDRAM buffer in JS, pushes it to the
  Web Component via `setPixels(uint8Array, width, height)`.

## ILI9341 — SPI TFT (the closest precedent for ePaper)

- **Web Component**: `wokwi-ili9341` (built-in canvas)
- **Simulation hook**: `frontend/src/simulation/parts/ComplexParts.ts:795`
  registers as `ili9341`. Plumbing:

```ts
const pinManager = (avrSimulator as any).pinManager;
const spi        = (avrSimulator as any).spi;
const pinDC      = getArduinoPinHelper('D/C');

pinManager.onPinChange(pinDC, (_, state) => { dcState = state; });

spi.onByte = (value) => {
  if (!dcState) processCommand(value);   // DC=LOW  → command opcode
  else          processData(value);      // DC=HIGH → parameter / pixel
  spi.completeTransfer(0xff);              // unblock the CPU immediately
};
```

The simulation maintains:

- `colStart, colEnd, rowStart, rowEnd, curX, curY` — RAM window state
- `currentCmd, dataBytes[]` — collecting parameters for the active command
- A single `ImageData` buffer batched to `requestAnimationFrame` so we don't
  thrash the canvas on every WRITE_RAM byte.
- A `getArduinoPinHelper('D/C')` lookup — pulls the DC pin number from the
  user's wiring in the diagram.

This is **exactly** what we need for ePaper, with these additions:

| Concern | ILI9341 today | ePaper additions |
|---|---|---|
| DC pin | yes | yes (same) |
| RST pin | optional, ignored | **mandatory** (clear framebuffer) |
| BUSY pin | n/a | **emulator drives it back to firmware** |
| Frame model | streaming pixel writes (visible immediately) | **latched** — held off-screen until 0x20 ACTIVATION |
| Refresh latency | none | configurable (default 1 s) — drive BUSY high during |
| Framebuffer planes | one (16-bit RGB) | one or two (B/W, +R) or seven (Spectra/ACeP) |
| Wire-up | Adafruit_GFX `tft.begin()` | GxEPD2/Adafruit_EPD `display.init()` |

## What "drive BUSY back to the firmware" means in code

ESP32 boards: `Esp32Bridge.sendPinEvent(busyGpio, state)` exists today
(used for DHT22/HC-SR04). For browser-side simulators (AVR, RP2040) the
PinManager already supports `triggerPinChange(gpio, state)` and the
simulator's GPIO peripheral picks it up as an INPUT read.

ePaper emulator pseudocode:

```ts
function flushFrameAndPulseBusy() {
  // 1. Compose the latched RAM planes into the canvas
  ctx.putImageData(composeBwAndRedPlanes(), 0, 0);
  // 2. Drive BUSY HIGH so the firmware's GxEPD2 _PowerOn() blocks
  pinManager.triggerPinChange(busyGpio, true);
  // 3. After REFRESH_MS, drive BUSY LOW
  setTimeout(() => pinManager.triggerPinChange(busyGpio, false), REFRESH_MS);
}
```

`REFRESH_MS` is 50 ms by default (snappy emulation) but settable per-panel
attribute for users who want to feel the real ~12 s Spectra 6 latency.

## Where the new files will live

```
frontend/src/components/velxio-components/EPaperElement.ts   ← Web Component (per CLAUDE.md §6a)
frontend/src/components/velxio-components/EPaper.tsx          ← React wrapper
frontend/src/components/simulator/BoardOnCanvas.tsx           ← (no changes — components flow through ComponentRegistry)
frontend/src/services/ComponentRegistry.ts                    ← register the metadataId(s)
frontend/src/simulation/parts/ComplexParts.ts                 ← OR a new EPaperPart.ts in parts/
```

Per CLAUDE.md §6a (added 2026-04), the visual component **must** be a Web
Component with a `pinInfo` getter so wires snap to pin tips, not the
corner. We'll author one Web Component (`<velxio-epaper>`) parameterised by
a `panel-kind` attribute (`epaper-1in54-bw`, `epaper-2in13-bwr`, etc.) so
all sizes share the same code.
