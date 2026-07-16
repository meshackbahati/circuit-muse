import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ChipInstance } from '../../src/ChipRuntime.js';
import { I2CBus } from '../../src/I2CBus.js';
import { AVRHarness } from '../../src/AVRHarness.js';

/**
 * TIER 4 (final) — Full-stack E2E: real Arduino sketch (.hex) compiled with
 * arduino-cli drives the AVR's TWI hardware (avr8js AVRTWI peripheral) which
 * routes through our I2CBus to the 24C01 chip running as WASM.
 *
 * The sketch (sketches/i2c_eeprom_demo/i2c_eeprom_demo.ino) writes 4 bytes
 * to the EEPROM at addresses 0..3, resets the pointer, reads them back, and
 * echoes them on Serial. The test asserts all 4 bytes appear in the AVR's
 * USART output stream — proving the entire chain is functioning:
 *
 *   Arduino sketch → AVR USART (printout) +
 *                    AVR TWI → I2CBus → ChipInstance → WASM I2C callbacks
 *
 * No mocks. Every byte goes through the real hardware emulation.
 */

const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = resolve(here, '../../fixtures/eeprom-24c01.wasm');
const hexPath  = resolve(here, '../../fixtures/i2c_eeprom_demo.hex');
const ready = existsSync(wasmPath) && existsSync(hexPath);

const note = ready ? '' : '  (skipped — needs eeprom-24c01.wasm AND i2c_eeprom_demo.hex)';

describe(`TIER 4 final — Arduino I2C master + 24C01 chip${note}`, () => {
  it.skipIf(!ready)('AVR sketch writes 0xAA,0xBB,0xCC,0xDD to EEPROM and reads them back via Serial', async () => {
    const wasm = readFileSync(wasmPath);
    const hex  = readFileSync(hexPath, 'utf8');

    const avr = new AVRHarness();
    avr.load(hex);
    const bus = new I2CBus(avr.twi);

    const wires = new Map([
      ['A0', 100], ['A1', 101], ['A2', 102],
      ['SDA', 18 /* A4 */], ['SCL', 19 /* A5 */],
      ['VCC', 1], ['GND', 0], ['WP', 15],
    ]);

    const chip = await ChipInstance.create({ wasm, pinManager: avr.pinManager, i2cBus: bus, wires });
    chip.start();

    // Run the sketch for 2 seconds (Wire.h transactions at 100kHz finish in tens of ms).
    avr.runCycles(16_000_000 * 2);

    const out = avr.getSerialOutput();
    const bytes = [...out].map((c) => c.charCodeAt(0));

    // Sketch must have echoed exactly 0xAA, 0xBB, 0xCC, 0xDD in order.
    expect(bytes).toContain(0xAA);
    expect(bytes).toContain(0xBB);
    expect(bytes).toContain(0xCC);
    expect(bytes).toContain(0xDD);

    // And in the right order (no shuffling from the sketch's read loop).
    const idxAA = bytes.indexOf(0xAA);
    const idxBB = bytes.indexOf(0xBB);
    const idxCC = bytes.indexOf(0xCC);
    const idxDD = bytes.indexOf(0xDD);
    expect(idxAA).toBeLessThan(idxBB);
    expect(idxBB).toBeLessThan(idxCC);
    expect(idxCC).toBeLessThan(idxDD);

    chip.dispose();
  });
});
