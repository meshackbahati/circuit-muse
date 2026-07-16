import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ChipInstance } from '../../src/ChipRuntime.js';
import { PinManager } from '../../src/PinManager.js';

const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = resolve(here, '../../fixtures/inverter.wasm');
const wasmAvailable = existsSync(wasmPath);

const skip = !wasmAvailable;
const note = skip ? '  (skipped — run scripts/compile-all.sh to build inverter.wasm)' : '';

describe(`Inverter chip — full WASM E2E${note}`, () => {
  it.skipIf(skip)('OUT mirrors the inverse of IN on every edge', async () => {
    const wasm = readFileSync(wasmPath);
    const pm = new PinManager();

    // Wire the chip's logical pins to "Arduino" pin numbers in our PinManager.
    // We reuse Arduino-style numbering arbitrarily — what matters is that
    // pin_read on chip's "IN" maps to one PinManager slot, and pin_write
    // on "OUT" maps to another.
    const wires = new Map([
      ['IN',  2],   // chip's IN  ↔ pin 2 in the PinManager
      ['OUT', 3],   // chip's OUT ↔ pin 3
      ['GND', 0],
      ['VCC', 1],
    ]);

    const chip = await ChipInstance.create({ wasm, pinManager: pm, wires });
    chip.start();

    // After setup, OUT should reflect the inverse of IN's initial (low) state.
    expect(pm.getPinState(3)).toBe(true); // !LOW = HIGH

    // Drive IN high → OUT must go low.
    pm.triggerPinChange(2, true);
    expect(pm.getPinState(3)).toBe(false);

    // Drive IN low → OUT must go high.
    pm.triggerPinChange(2, false);
    expect(pm.getPinState(3)).toBe(true);

    chip.dispose();
  });
});
