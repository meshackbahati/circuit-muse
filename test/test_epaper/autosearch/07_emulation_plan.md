# 07 — Phased emulation plan

## North-star architecture

**One Web Component**, **one simulation hook**, **one state machine** —
parameterised by panel kind. The state machine internally branches per
controller family (SSD168x, UC81xx, Spectra6) but exposes a single
`metadataId = 'epaper-<panel-kind>'` for ComponentRegistry.

```
┌─────────────────── frontend/src/components/velxio-components ──────────────┐
│                                                                             │
│   EPaperElement.ts          (Web Component <velxio-epaper panel-kind=…>)    │
│   EPaper.tsx                (React wrapper — thin)                          │
│                                                                             │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ pinInfo + canvas
                                   ▼
┌────────────────── frontend/src/simulation/parts/EPaperPart.ts ─────────────┐
│                                                                             │
│   const familyDecoders = {                                                  │
│     'ssd168x': new SSD168xDecoder(panel),                                   │
│     'uc81xx':  new UC81xxDecoder(panel),                                    │
│     'spectra6': new Spectra6Decoder(panel),                                 │
│   }                                                                         │
│                                                                             │
│   spi.onByte = (b) => decoder.feed(b, dcState)                              │
│   onActivate() → composeAndFlush() → pulseBusy(REFRESH_MS)                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Phase 1 — SSD168x mono (1.54", 2.13", 2.9", 4.2", 7.5")

Smallest scope that ships something useful. Five metadata IDs, one
decoder, one Web Component.

**Deliverables:**
1. `EPaperElement.ts` — Web Component supporting `panel-kind` ∈
   `epaper-1in54-bw | epaper-2in13-bw | epaper-2in9-bw | epaper-4in2-bw |
    epaper-7in5-bw`. SVG body + active area canvas + FPC pins.
2. `EPaper.tsx` — React wrapper, forwards canvas readiness via
   `canvas-ready` custom event (mirrors ILI9341).
3. `EPaperPart.ts` — registers all 5 metadata IDs with the same
   `ssd168x` decoder + a per-panel resolution + bezel config.
4. `ComponentRegistry.ts` — wire the IDs.
5. Library auto-install: ensure GxEPD2 + Adafruit_GFX trigger via the
   sketch's `#include`.
6. Pixel-buffer fingerprint test (one per panel size).

**Decoder scope:** the 17 SSD168x commands listed in `02_controllers.md` ×
two RAM planes × the 0x20 ACTIVATION trigger. Anything else (LUT writes
0x32, gate driving voltage 0x03, etc.) is **silently consumed** so the
init sequence completes without warnings.

**Acceptance test:**
- Compile `GxEPD2_HelloWorld.ino` for the 1.54" panel against ESP32, Pi
  Pico, and Arduino Uno. Compile success on all three.
- Run on ESP32 + Pi Pico in the simulator. After ~50 ms BUSY pulse the
  canvas shows "Hello World" with a sharp 200×200 buffer.

## Phase 2 — Tri-colour SSD168x (B/W/Red 2.13" + 2.9")

Reuses 90% of Phase 1. Adds:

- Two-plane composition (`0x24` black + `0x26` red).
- Two new metadata IDs: `epaper-2in13-bwr`, `epaper-2in9-bwr`.
- Web Component palette change.

## Phase 3 — UC81xx (4.2" UC8176, 7.5" UC8179, 5.65" 7-colour ACeP UC8159c)

New decoder. Different command set (0x10 DTM1, 0x12 DRF, etc.) but
**same wiring + same Web Component**. Scope:

- `UC81xxDecoder.ts` for mono 4.2" / 7.5".
- `ACePDecoder.ts` for 7-colour 5.65" (4 px / byte palette).

## Phase 4 — Spectra 6 (the user's 13.3" 1200×1600)

New decoder; different command set again. Slowest refresh (12 s real,
emulator default 200 ms). Massive framebuffer (1.2 MB raw at 6 colours;
~470 KB packed) — make sure the canvas downscales properly for gallery
preview thumbnails.

## Phase 5 — IT8951 (Carta 6"–10.3" greyscale)

Different beast. Command-packet protocol over SPI. Deferred until a
concrete user asks.

## Out-of-scope forever (probably)

- LUT-driven custom waveforms — accept silently, never validate.
- Real-time partial-window updates — Phase 1 just full-frames.
- Capacitive touch overlay — different component (EPD has no touch panel
  built in; touch is an upper layer in some bundles like Waveshare's CFAF).

## Risk register

| Risk | Mitigation |
|---|---|
| GxEPD2 + Adafruit_GFX too big for AVR (Uno) at 4.2"+ | Ship the small panels (1.54", 2.13") for AVR; the rest get an "AVR not supported" hint in the Library Manager modal. |
| Spectra 6 reverse-engineering may be incomplete | Ship Phase 1–3 first; Spectra 6 can land after we capture real SPI traces from a Seeed EE02 via Saleae and adjust. |
| BUSY emulation timing too short → firmware loops never see HIGH | Default to 50 ms refresh. Add a `refresh-ms` attribute on the Web Component. |
| Controller silently differs across panel revisions | Fingerprint commands: log to `chip_log` events whenever an unknown opcode is seen so users can report panel quirks. |

## What can ship today

Just the dossier (this folder), a couple of pure-state-machine Python
unit tests (next file), and one canonical sketch in `sketches/`. Real
emulator code is a separate PR — explicitly **deferred** until the user
greenlights phase 1.
