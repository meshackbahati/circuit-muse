/**
 * TIER 4 — AVR + custom chip integration.
 *
 * Boots the real Arduino blink sketch on avr8js. Pin 13 is wired to the
 * Inverter chip's IN pin, and the chip's OUT lands on pin 100 in our PinManager.
 * Asserts that every blink toggle of pin 13 inverts pin 100.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { AVRHarness } from '../../src/AVRHarness.js';
import { ChipInstance } from '../../src/ChipRuntime.js';
import { fixture, loadChipWasm, chipWasmExists } from '../helpers.js';

const skip = !chipWasmExists('inverter');

describe('TIER 4 — AVR blink → Inverter chip → wired output', () => {
  it.skipIf(skip)('OUT(pin 100) is the inverse of pin 13 across multiple blink cycles', async () => {
    const hex = readFileSync(fixture('blink.hex'), 'utf8');
    const avr = new AVRHarness();
    avr.load(hex);

    const chip = await ChipInstance.create({
      wasm: loadChipWasm('inverter'),
      pinManager: avr.pinManager,
      wires: new Map([['IN', 13], ['OUT', 100]]),
    });
    chip.start();

    const samples = [];
    avr.pinManager.onPinChange(13, (_p, s) => {
      samples.push({ in: s, out: avr.pinManager.getPinState(100) });
    });

    avr.runCycles(16_000_000 * 2); // 2 seconds

    expect(samples.length).toBeGreaterThan(2);
    for (const { in: inS, out } of samples) {
      expect(out).toBe(!inS);
    }
    chip.dispose();
  });
});
