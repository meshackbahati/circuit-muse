/**
 * TIER 4 — AVR pin 13 → XOR.A; XOR.B held LOW manually.
 * When B = LOW, OUT must mirror A (since A xor 0 = A).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { AVRHarness } from '../../src/AVRHarness.js';
import { ChipInstance } from '../../src/ChipRuntime.js';
import { fixture, loadChipWasm, chipWasmExists } from '../helpers.js';

const skip = !chipWasmExists('xor');

describe('TIER 4 — AVR drives XOR.A while XOR.B = 0 → XOR.OUT mirrors A', () => {
  it.skipIf(skip)('pin 13 toggles propagate through XOR with B held LOW', async () => {
    const hex = readFileSync(fixture('blink.hex'), 'utf8');
    const avr = new AVRHarness();
    avr.load(hex);

    const chip = await ChipInstance.create({
      wasm: loadChipWasm('xor'),
      pinManager: avr.pinManager,
      wires: new Map([['A', 13], ['B', 50], ['OUT', 100]]),
    });
    chip.start();

    avr.pinManager.triggerPinChange(50, false); // B = LOW

    const transitions = [];
    avr.pinManager.onPinChange(13, (_p, s) => {
      transitions.push({ a: s, out: avr.pinManager.getPinState(100) });
    });

    avr.runCycles(16_000_000 * 2);

    expect(transitions.length).toBeGreaterThan(2);
    for (const { a, out } of transitions) {
      expect(out).toBe(a);
    }
    chip.dispose();
  });
});
