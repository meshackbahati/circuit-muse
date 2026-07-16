# Example Projects

Velxio ships with **380+ built-in example projects** across 7 collections. Open the editor, click **Examples** in the nav, filter by board / category / difficulty, and click **Load**.

The examples are defined under `frontend/src/data/`:

| Collection | File | Count |
|------------|------|------:|
| Core gallery (basics, sensors, displays, comms, games, robotics, circuits) | `examples.ts` | ~40 |
| Analog & mixed-signal circuits | `examples-circuits.ts` | ~190 |
| 100 Days of Code series | `examples-100-days.ts` | ~57 |
| Waveshare e-paper panels | `examples-displays-epaper.ts` | ~70 |
| Retro Intel/Zilog CPUs | `examples-retro-intel.ts` | ~43 |
| Pure-analog labelled | `examples-analog.ts` | ~15 |
| Pure-digital labelled | `examples-digital.ts` | ~7 |
| Pico W WiFi | `examples-picow-wifi.ts` | ~4 |

> Totals are approximate — the lists grow regularly. The numbers above are the values at the last documentation refresh.

---

## Highlights

### Core basics (Arduino Uno)

| ID | Title | Category | Difficulty |
|----|-------|----------|------------|
| `blink-led` | Blink LED | basics | beginner |
| `traffic-light` | Traffic Light | basics | beginner |
| `button-led` | Button Control | basics | beginner |
| `fade-led` | Fade LED (PWM) | basics | beginner |
| `rgb-led` | RGB LED Colors | basics | intermediate |
| `serial-hello` | Serial Hello World | communication | beginner |
| `simon-says` | Simon Says Game | games | advanced |
| `lcd-hello` | LCD 20x4 Display | displays | intermediate |

### Multi-board

Mix Pi 3 + Arduino over UART, ESP32 + Arduino over I2C, ESP32 driving an Arduino as a NeoPixel slave. The `boards: [...]` field in each example shells out per-board file groups.

### Analog circuits

Voltage dividers, RC filters, op-amp inverting/non-inverting amps, Schmitt triggers, transistor amplifiers, full-wave rectifiers. Wire-up loads instantly; flip the **electrical-sim** toggle to see steady-state voltages on every probe.

### Mixed-signal

Potentiometer -> op-amp follower -> ATmega ADC. NeoPixel ring driven by an ESP32 with the real RMT decoder. ILI9341 TFT graphics demo via SPI.

### Retro CPUs (custom chips)

Intel 4001/4002/4004/4040 (4-bit), 8080/8086 (8/16-bit), Z80 — wired to RAM/ROM, 7-segments, and shift registers. Each example loads a custom-chip implementation plus a working sketch.

### E-paper

Waveshare 1.54", 2.13", 2.9", 4.2", 7.5" panels with sample bitmap and text rendering.

### Pico W WiFi

HTTP server, HTTP client, NTP sync, BLE advertising — all running against the simulated CYW43439 + SLIRP NAT bridge.

---

## Adding a new example

1. Pick the file under `frontend/src/data/` that matches your category (or create one and import from `examples.ts`).
2. Add an `ExampleProject` entry:

```typescript
{
  id: 'my-example',
  title: 'My Example',
  description: 'One-line description shown in the gallery card',
  category: 'basics',         // 'basics' | 'sensors' | 'displays' | 'communication' | 'games' | 'robotics' | 'circuits'
  difficulty: 'beginner',     // 'beginner' | 'intermediate' | 'advanced'
  boardType: 'arduino-uno',   // omit for multi-board (use boards[])
  tags: ['led', 'pwm'],
  code: '/* full Arduino sketch */',
  components: [
    { type: 'wokwi-led',  id: 'led1', x: 200, y: 100, properties: { color: 'red' } },
    // …
  ],
  wires: [
    { id: 'w1', start: { componentId: 'led1', pinName: 'A' }, end: { componentId: 'arduino-uno', pinName: '13' }, color: 'green' },
    // …
  ],
}
```

3. (Optional) Save a screenshot as `docs/examples/{id}.png` for the gallery card.
4. The example appears automatically in the gallery on next reload.

### Multi-board examples

For multi-board: set the `boards: [...]` field. Board instance IDs are deterministic — the first board of a kind uses `boardKind` as its ID:

```typescript
boards: [
  { boardKind: 'arduino-uno',  x: 100, y: 100, code: '/* … */' },
  { boardKind: 'raspberry-pi-3', x: 500, y: 100, vfsFiles: { 'main.py': '# …' } },
],
```

Reference wires by these IDs directly — for example `componentId: 'arduino-uno'` or `componentId: 'raspberry-pi-3'`.

### MicroPython examples

Add `languageMode: 'micropython'` to the example. For multi-file payloads, use the `files: [{ name, content }, …]` field instead of `code`. The loader switches the active board into MicroPython mode before populating the file group.

---

## Screenshots

Screenshots are optional but help the gallery. Save them in this folder with the example's `id` as the filename:

- **Width**: 800px
- **Height**: 500px
- **Format**: PNG
- **Background**: dark `#1e1e1e`

Capture from the editor at `/examples` — load the example, zoom to fit, take a tool screenshot of just the canvas area.

While no image is available the gallery shows a placeholder with the category icon, the component count, and the wire count.
