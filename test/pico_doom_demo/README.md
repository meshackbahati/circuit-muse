# Pico Doom — pre-flight compile test

A column-wise raycaster that produces a Wolfenstein / early-Doom-style
3D corridor on the Pi Pico + ILI9341 TFT. Lives here as the canonical
source of the sketch + a one-shot compile check the operator can run
before exposing the example in the gallery.

## What the sketch does

- Reads four pushbuttons (forward, back, turn left, turn right) on
  GP10-13 with INPUT_PULLUP.
- Draws a title splash on the ILI9341, waits for FWD.
- Casts 160 rays per frame (every other column, 2-px stripe) through
  a 16×16 tile map using DDA, paints walls straight onto the TFT with
  `drawFastVLine` — no framebuffer.
- Renders a fixed 40-px HUD bar at the bottom (HP / armour / ammo).
- Caps the frame rate at ~10 fps so the SPI bus has room to breathe.

## Why this is a "demo" and not the real id Software Doom

The canonical Pico port — Graham Sanderson's [rp2040-doom][rp2040doom]
— ships the shareware DOOM1.WAD inside the flash with custom
compression and pushes pixels out via PIO-driven VGA / DVI. None of
that survives the rp2040js emulator (no PIO accuracy, no flash
mapping for the WAD blob), so what you'd see in the simulator is a
boot loop.

A Wolf3D-style raycaster reproduces the *visual experience* — first-
person 3D corridor with textured walls, free rotation, smooth
forward/strafe movement — using the same tools that fit on a 264 KB
chip. That's what this sketch does, and it survives emulation fine.

[rp2040doom]: https://github.com/kilograham/rp2040-doom

## How to run the pre-flight check

The sketch must compile against the Pico FQBN with only the libraries
the Velxio compile pipeline already auto-installs (Adafruit_GFX,
Adafruit_ILI9341). Run:

```bash
cd test/pico_doom_demo
./compile_check.sh
```

The script:

1. Checks `arduino-cli` is in `$PATH`.
2. Verifies `rp2040:rp2040` core is installed (installs it if not).
3. Confirms `Adafruit_GFX` and `Adafruit_ILI9341` are installed (lib
   install if missing).
4. Runs `arduino-cli compile --fqbn rp2040:rp2040:rpipico .` and
   asserts a non-empty `.uf2` output.

A successful run prints the binary size and exits 0. Sketch size
should sit comfortably under 80 KB — well below the Pico's 2 MB
flash ceiling — so this isn't a "will it fit" test but a
"compiles cleanly with the gallery's lib set" test.

## How the example wires up the gallery

`frontend/src/data/examples.ts` registers an entry with:

- `id: 'pico-doom-raycaster'`
- `boardType: 'raspberry-pi-pico'`
- `category: 'games'`
- `difficulty: 'advanced'`
- `libraries: ['Adafruit GFX Library', 'Adafruit ILI9341']`
- Components: 1 ILI9341 + 4 pushbuttons + the Pico board
- Wires: SPI bus (SCK/MOSI/CS/DC/RST/LED) + 4 button pulls to GP10-13

The unit test `frontend/src/__tests__/examples-pico-doom.test.ts`
validates that the registered example has those fields and that
every wire endpoint references a component id that actually exists.

## Pin map (printed here so it's obvious during hardware bring-up too)

| Function | Pico GPIO | Note |
|---|---|---|
| SPI0 SCK | GP18 | Adafruit_ILI9341 uses SPI0 by default. |
| SPI0 MOSI | GP19 | |
| TFT CS | GP17 | |
| TFT D/C | GP20 | |
| TFT RST | GP21 | |
| TFT LED | GP22 | Backlight, always HIGH. |
| Button FWD | GP10 | INPUT_PULLUP, active LOW. |
| Button BACK | GP11 | |
| Button LEFT | GP12 | Turn anticlockwise. |
| Button RIGHT | GP13 | Turn clockwise. |
