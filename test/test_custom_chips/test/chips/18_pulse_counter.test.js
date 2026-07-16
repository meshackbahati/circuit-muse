/**
 * TIER 1 — Pulse counter chip with attribute "threshold".
 * Tests pin_watch (rising), pin_write, attr_read, and reset behavior.
 */
import { describe, it, expect } from 'vitest';
import { ChipInstance } from '../../src/ChipRuntime.js';
import { PinManager } from '../../src/PinManager.js';
import { loadChipWasm, chipWasmExists } from '../helpers.js';

const skip = !chipWasmExists('pulse-counter');

const PINS = { PULSE: 600, OVF: 601, RST: 602 };

async function setup(threshold) {
  const pm = new PinManager();
  pm.triggerPinChange(PINS.RST, true); // RST HIGH = not asserted
  const attrs = new Map();
  if (threshold !== undefined) attrs.set('threshold', threshold);
  const chip = await ChipInstance.create({
    wasm: loadChipWasm('pulse-counter'), pinManager: pm, attrs,
    wires: new Map(Object.entries(PINS)),
  });
  chip.start();
  return { pm, chip };
}

function pulse(pm) {
  pm.triggerPinChange(PINS.PULSE, true);
  pm.triggerPinChange(PINS.PULSE, false);
}

describe('TIER 1 — pulse-counter chip', () => {
  it.skipIf(skip)('toggles OVF every 4 pulses (default threshold)', async () => {
    const { pm, chip } = await setup();
    pulse(pm); pulse(pm); pulse(pm);
    expect(pm.getPinState(PINS.OVF)).toBe(false);
    pulse(pm);
    expect(pm.getPinState(PINS.OVF)).toBe(true);
    pulse(pm); pulse(pm); pulse(pm); pulse(pm);
    expect(pm.getPinState(PINS.OVF)).toBe(false);
    chip.dispose();
  });

  it.skipIf(skip)('threshold attribute changes the divisor', async () => {
    const { pm, chip } = await setup(2);
    pulse(pm);
    expect(pm.getPinState(PINS.OVF)).toBe(false);
    pulse(pm);
    expect(pm.getPinState(PINS.OVF)).toBe(true);
    pulse(pm); pulse(pm);
    expect(pm.getPinState(PINS.OVF)).toBe(false);
    chip.dispose();
  });

  it.skipIf(skip)('RST falling edge clears counter and OVF', async () => {
    const { pm, chip } = await setup();
    pulse(pm); pulse(pm); pulse(pm); pulse(pm);
    expect(pm.getPinState(PINS.OVF)).toBe(true);
    // Pulse RST low — should reset both counter and OVF state.
    pm.triggerPinChange(PINS.RST, false);
    pm.triggerPinChange(PINS.RST, true);
    expect(pm.getPinState(PINS.OVF)).toBe(false);
    // After reset, counter starts at 0 again.
    pulse(pm); pulse(pm); pulse(pm); pulse(pm);
    expect(pm.getPinState(PINS.OVF)).toBe(true);
    chip.dispose();
  });
});
