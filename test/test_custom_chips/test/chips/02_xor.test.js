/**
 * TIER 1 — Single chip: 2-input XOR gate.
 * 3 tests covering full truth table, both-input edges, and 16-step pattern.
 */
import { describe, it, expect } from 'vitest';
import { ChipInstance } from '../../src/ChipRuntime.js';
import { PinManager } from '../../src/PinManager.js';
import { loadChipWasm, chipWasmExists } from '../helpers.js';

const skip = !chipWasmExists('xor');

async function newXor() {
  const pm = new PinManager();
  const chip = await ChipInstance.create({
    wasm: loadChipWasm('xor'),
    pinManager: pm,
    wires: new Map([['A', 2], ['B', 3], ['OUT', 4]]),
  });
  chip.start();
  return { pm, chip };
}

describe('TIER 1 — XOR gate', () => {
  it.skipIf(skip)('truth table: 0^0=0, 0^1=1, 1^0=1, 1^1=0', async () => {
    const { pm, chip } = await newXor();
    pm.triggerPinChange(2, false); pm.triggerPinChange(3, false);
    expect(pm.getPinState(4)).toBe(false);
    pm.triggerPinChange(2, false); pm.triggerPinChange(3, true);
    expect(pm.getPinState(4)).toBe(true);
    pm.triggerPinChange(2, true);  pm.triggerPinChange(3, false);
    expect(pm.getPinState(4)).toBe(true);
    pm.triggerPinChange(2, true);  pm.triggerPinChange(3, true);
    expect(pm.getPinState(4)).toBe(false);
    chip.dispose();
  });

  it.skipIf(skip)('reacts to edges on either input', async () => {
    const { pm, chip } = await newXor();
    pm.triggerPinChange(2, true);  // A high, B low → OUT high
    expect(pm.getPinState(4)).toBe(true);
    pm.triggerPinChange(3, true);  // both high → OUT low
    expect(pm.getPinState(4)).toBe(false);
    pm.triggerPinChange(2, false); // A low, B high → OUT high
    expect(pm.getPinState(4)).toBe(true);
    chip.dispose();
  });

  it.skipIf(skip)('produces correct OUT for 16 random patterns', async () => {
    const { pm, chip } = await newXor();
    const patterns = [];
    for (let i = 0; i < 16; i++) {
      patterns.push([(i & 1) !== 0, (i & 2) !== 0]);
    }
    for (const [a, b] of patterns) {
      pm.triggerPinChange(2, a);
      pm.triggerPinChange(3, b);
      expect(pm.getPinState(4)).toBe(a !== b);
    }
    chip.dispose();
  });
});
