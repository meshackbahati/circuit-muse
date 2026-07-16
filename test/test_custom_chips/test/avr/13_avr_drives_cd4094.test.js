/**
 * TIER 4 — AVR pin 13 used as CD4094 CLK.
 *
 * We hold DATA = HIGH and STROBE the chip after blink toggles a few times.
 * This simulates a software-bitbanged clock pin from the Arduino driving a
 * shift register. We don't claim the exact bit count is right (depends on
 * how many edges blink produces in our window), but we verify that:
 *   - the chip is powered and registered
 *   - at least one strobe latches a non-zero pattern when we drive DATA high
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { AVRHarness } from '../../src/AVRHarness.js';
import { ChipInstance } from '../../src/ChipRuntime.js';
import { fixture, loadChipWasm, chipWasmExists } from '../helpers.js';

const skip = !chipWasmExists('cd4094');

describe('TIER 4 — AVR pin 13 → CD4094.CLK (bitbang shift)', () => {
  it.skipIf(skip)('rising edges from blink shift HIGH bits in; strobe latches non-zero Q', async () => {
    const hex = readFileSync(fixture('blink.hex'), 'utf8');
    const avr = new AVRHarness();
    avr.load(hex);

    const wires = new Map([
      ['VDD', 200], ['VSS', 201], ['CLK', 13], ['DATA', 202], ['STR', 203], ['OE', 204],
      ['QS', 205], ['QSN', 206],
      ['Q1', 210], ['Q2', 211], ['Q3', 212], ['Q4', 213],
      ['Q5', 214], ['Q6', 215], ['Q7', 216], ['Q8', 217],
    ]);
    const chip = await ChipInstance.create({
      wasm: loadChipWasm('cd4094'), pinManager: avr.pinManager, wires,
    });
    chip.start();

    avr.pinManager.triggerPinChange(200, true);   // VDD on
    avr.pinManager.triggerPinChange(201, false);  // VSS gnd
    avr.pinManager.triggerPinChange(202, true);   // DATA high — every clock shifts in '1'

    // Run long enough for several blink toggles (i.e. several clock edges).
    avr.runCycles(16_000_000 * 4);

    // Pulse strobe to latch the register to outputs.
    avr.pinManager.triggerPinChange(203, true);
    avr.pinManager.triggerPinChange(203, false);

    const qBits = [210,211,212,213,214,215,216,217]
      .map((p) => avr.pinManager.getPinState(p) ? 1 : 0);
    const sum = qBits.reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(0);

    chip.dispose();
  });
});
