/**
 * Pico Doom example — data integrity test.
 *
 * The runtime smoke test (does the sketch actually compile and run on
 * the rp2040js emulator?) lives at `test/pico_doom_demo/compile_check.sh`
 * — it needs arduino-cli + the rp2040 core, which our vitest CI image
 * doesn't ship. This file just guarantees the example we surface in the
 * /examples gallery is structurally valid: declared once, target board
 * correct, libraries listed, every wire endpoint refers to a component
 * that exists.
 *
 * If you change pin assignments in the sketch (e.g. move CS off GP17),
 * update the WIRE_EXPECTATIONS map below in the same commit.
 */
import { describe, it, expect } from 'vitest';
import { exampleProjects } from '../data/examples';

const EXAMPLE_ID = 'pico-doom-raycaster';

function findExample() {
  return exampleProjects.find((e) => e.id === EXAMPLE_ID);
}

describe('pico-doom-raycaster example', () => {
  it('is registered exactly once in the exampleProjects list', () => {
    const matches = exampleProjects.filter((e) => e.id === EXAMPLE_ID);
    expect(matches.length).toBe(1);
  });

  it('targets the Raspberry Pi Pico in the games category at advanced difficulty', () => {
    const e = findExample()!;
    expect(e.boardType).toBe('raspberry-pi-pico');
    expect(e.category).toBe('games');
    expect(e.difficulty).toBe('advanced');
  });

  it('declares the two Adafruit libraries the sketch needs', () => {
    const e = findExample()!;
    expect(e.libraries).toEqual(
      expect.arrayContaining(['Adafruit GFX Library', 'Adafruit ILI9341']),
    );
  });

  it('lists one ILI9341 plus exactly four pushbuttons', () => {
    const e = findExample()!;
    const tftCount = e.components.filter((c) => c.type === 'wokwi-ili9341').length;
    const btnCount = e.components.filter((c) => c.type === 'wokwi-pushbutton').length;
    expect(tftCount).toBe(1);
    expect(btnCount).toBe(4);
  });

  it('exposes button ids fwd / back / left / right', () => {
    const e = findExample()!;
    const ids = e.components.map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining(['btn-fwd', 'btn-back', 'btn-left', 'btn-right']),
    );
  });

  it('every wire endpoint references a real component (board id is implicit)', () => {
    const e = findExample()!;
    const knownIds = new Set<string>([
      'raspberry-pi-pico', // implicit board instance id
      ...e.components.map((c) => c.id),
    ]);
    const offenders: string[] = [];
    for (const w of e.wires) {
      if (!knownIds.has(w.start.componentId)) offenders.push(`${w.id}:start=${w.start.componentId}`);
      if (!knownIds.has(w.end.componentId)) offenders.push(`${w.id}:end=${w.end.componentId}`);
    }
    expect(offenders).toEqual([]);
  });

  it('SPI + control + power wires connect Pico → ILI9341 with the pinout the sketch + hardware expect', () => {
    const e = findExample()!;
    // (pico-pin, ili9341-pin) pairs. Everything except GP16↔MISO comes
    // from the sketch's #define block. GP16↔MISO is hardware SPI0's
    // MISO line — the 3-arg Adafruit_ILI9341(CS, DC, RST) constructor
    // selects hardware SPI0, so this pin is fixed even though the
    // driver never reads back. If any pair gets re-routed in the
    // example, the sketch + this list have to move together — fail
    // loud here so the mismatch can't slip into prod.
    const expected: Array<[string, string]> = [
      ['3V3',   'VCC'],
      ['GND.5', 'GND'],
      ['GP18',  'SCK'],
      ['GP19',  'MOSI'],
      ['GP16',  'MISO'],
      ['GP17',  'CS'],
      ['GP20',  'D/C'],
      ['GP21',  'RST'],
      ['GP22',  'LED'],
    ];
    for (const [picoPin, tftPin] of expected) {
      const match = e.wires.find(
        (w) =>
          w.start.componentId === 'raspberry-pi-pico' &&
          w.start.pinName === picoPin &&
          w.end.componentId === 'tft1' &&
          w.end.pinName === tftPin,
      );
      expect(match, `missing wire ${picoPin} → tft1.${tftPin}`).toBeTruthy();
    }
  });

  it('each button signal goes to the GP10-13 pin its sketch label expects', () => {
    const e = findExample()!;
    const expected: Record<string, string> = {
      'btn-fwd': 'GP10',
      'btn-back': 'GP11',
      'btn-left': 'GP12',
      'btn-right': 'GP13',
    };
    for (const [btnId, picoPin] of Object.entries(expected)) {
      const match = e.wires.find(
        (w) =>
          w.start.componentId === 'raspberry-pi-pico' &&
          w.start.pinName === picoPin &&
          w.end.componentId === btnId &&
          w.end.pinName === '1.l',
      );
      expect(match, `missing signal wire ${picoPin} → ${btnId}.1.l`).toBeTruthy();
    }
  });

  it('every button has the second terminal tied to a Pico GND pin', () => {
    const e = findExample()!;
    for (const btn of ['btn-fwd', 'btn-back', 'btn-left', 'btn-right']) {
      const gnd = e.wires.find(
        (w) =>
          w.start.componentId === btn &&
          w.start.pinName === '2.l' &&
          w.end.componentId === 'raspberry-pi-pico' &&
          /^GND/.test(w.end.pinName),
      );
      expect(gnd, `missing GND wire for ${btn}`).toBeTruthy();
    }
  });

  it('embedded sketch keeps the SPI pin defines aligned with the wiring above', () => {
    const e = findExample()!;
    // Source-of-truth grep — if the constants drift in the sketch, this
    // catches it before the example loads broken on real users.
    expect(e.code).toMatch(/#define\s+TFT_CS\s+17\b/);
    expect(e.code).toMatch(/#define\s+TFT_DC\s+20\b/);
    expect(e.code).toMatch(/#define\s+TFT_RST\s+21\b/);
    expect(e.code).toMatch(/#define\s+TFT_LED\s+22\b/);
    expect(e.code).toMatch(/#define\s+BTN_FWD\s+10\b/);
    expect(e.code).toMatch(/#define\s+BTN_BACK\s+11\b/);
    expect(e.code).toMatch(/#define\s+BTN_LEFT\s+12\b/);
    expect(e.code).toMatch(/#define\s+BTN_RIGHT\s+13\b/);
    // Sanity: the sketch must keep the renderFrame DDA loop (the visual
    // payoff of the example). If a future "minify" removes it the example
    // becomes a black screen.
    expect(e.code).toMatch(/renderFrame\s*\(\s*\)/);
    expect(e.code).toMatch(/drawFastVLine/);
  });
});
