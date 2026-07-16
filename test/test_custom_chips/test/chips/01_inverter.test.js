/**
 * TIER 1 — Single chip: Inverter.
 * 3 tests covering boot state, edge response, and rapid toggling.
 */
import { describe, it, expect } from 'vitest';
import { ChipInstance } from '../../src/ChipRuntime.js';
import { PinManager } from '../../src/PinManager.js';
import { loadChipWasm, chipWasmExists } from '../helpers.js';

const skip = !chipWasmExists('inverter');

describe('TIER 1 — Inverter chip', () => {
  it.skipIf(skip)('OUT initializes to HIGH when IN is LOW at setup', async () => {
    const pm = new PinManager();
    const wires = new Map([['IN', 2], ['OUT', 3]]);
    const chip = await ChipInstance.create({ wasm: loadChipWasm('inverter'), pinManager: pm, wires });
    chip.start();
    expect(pm.getPinState(3)).toBe(true);
    chip.dispose();
  });

  it.skipIf(skip)('OUT inverts immediately on every IN edge', async () => {
    const pm = new PinManager();
    const chip = await ChipInstance.create({
      wasm: loadChipWasm('inverter'),
      pinManager: pm,
      wires: new Map([['IN', 2], ['OUT', 3]]),
    });
    chip.start();

    pm.triggerPinChange(2, true);  expect(pm.getPinState(3)).toBe(false);
    pm.triggerPinChange(2, false); expect(pm.getPinState(3)).toBe(true);
    pm.triggerPinChange(2, true);  expect(pm.getPinState(3)).toBe(false);
    chip.dispose();
  });

  it.skipIf(skip)('handles 100 rapid toggles without losing edges', async () => {
    const pm = new PinManager();
    const chip = await ChipInstance.create({
      wasm: loadChipWasm('inverter'),
      pinManager: pm,
      wires: new Map([['IN', 2], ['OUT', 3]]),
    });
    chip.start();
    for (let i = 0; i < 100; i++) {
      const high = i % 2 === 1;
      pm.triggerPinChange(2, high);
      expect(pm.getPinState(3)).toBe(!high);
    }
    chip.dispose();
  });
});
