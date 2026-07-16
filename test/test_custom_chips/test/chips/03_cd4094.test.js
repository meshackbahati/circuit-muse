/**
 * TIER 1 — Single chip: CD4094 8-stage shift register.
 * 4 tests covering shift, strobe, power gate, and bit ordering.
 */
import { describe, it, expect } from 'vitest';
import { ChipInstance } from '../../src/ChipRuntime.js';
import { PinManager } from '../../src/PinManager.js';
import { loadChipWasm, chipWasmExists } from '../helpers.js';

const skip = !chipWasmExists('cd4094');

const PINS = {
  VDD: 100, VSS: 101, CLK: 102, DATA: 103, STR: 104, OE: 105, QS: 106, QSN: 107,
  Q1: 110, Q2: 111, Q3: 112, Q4: 113, Q5: 114, Q6: 115, Q7: 116, Q8: 117,
};

async function newCd4094() {
  const pm = new PinManager();
  const wires = new Map(Object.entries(PINS));
  const chip = await ChipInstance.create({
    wasm: loadChipWasm('cd4094'),
    pinManager: pm,
    wires,
  });
  chip.start();
  // Power on.
  pm.triggerPinChange(PINS.VDD, true);
  pm.triggerPinChange(PINS.VSS, false);
  return { pm, chip };
}

/** Shift one bit MSB-first by toggling DATA then pulsing CLK high then low. */
function shiftBit(pm, bit) {
  pm.triggerPinChange(PINS.DATA, bit);
  pm.triggerPinChange(PINS.CLK,  true);
  pm.triggerPinChange(PINS.CLK,  false);
}

function strobe(pm) {
  pm.triggerPinChange(PINS.STR, true);
  pm.triggerPinChange(PINS.STR, false);
}

function readQ(pm) {
  return [
    pm.getPinState(PINS.Q1) ? 1 : 0,
    pm.getPinState(PINS.Q2) ? 1 : 0,
    pm.getPinState(PINS.Q3) ? 1 : 0,
    pm.getPinState(PINS.Q4) ? 1 : 0,
    pm.getPinState(PINS.Q5) ? 1 : 0,
    pm.getPinState(PINS.Q6) ? 1 : 0,
    pm.getPinState(PINS.Q7) ? 1 : 0,
    pm.getPinState(PINS.Q8) ? 1 : 0,
  ];
}

describe('TIER 1 — CD4094 shift register', () => {
  it.skipIf(skip)('shifts 8 bits MSB-first then strobes them to Q1..Q8', async () => {
    const { pm, chip } = await newCd4094();

    // Shift in 0b10110001 — high bit first reaches Q8 last (in MSB-first → Q1).
    // The Wokwi/CD4094 convention used in cd4094.c writes bit position s->bit
    // starting at 7 and going down; output Q[i] = (reg>>i)&1, so Q1 = bit 0.
    // The first byte shifted in lands as bit 7 (Q8), so the order pushed is
    // Q8, Q7, Q6, Q5, Q4, Q3, Q2, Q1.
    const desiredQ = [1, 0, 0, 0, 1, 1, 0, 1]; // Q1..Q8 final state
    // To get Q8=1, Q7=0, ..., Q1=1, push bits in order Q8..Q1 = [1,0,1,1,0,0,0,1]
    const shiftOrder = [...desiredQ].reverse();
    for (const b of shiftOrder) shiftBit(pm, b);
    strobe(pm);

    expect(readQ(pm)).toEqual(desiredQ);
    chip.dispose();
  });

  it.skipIf(skip)('without VDD all outputs forced to LOW on next clock', async () => {
    const { pm, chip } = await newCd4094();

    // Shift in some pattern and strobe.
    for (const b of [1, 1, 1, 1, 1, 1, 1, 1]) shiftBit(pm, b);
    strobe(pm);
    expect(readQ(pm).every((q) => q === 1)).toBe(true);

    // Cut power and pulse CLK; chip forces outputs LOW.
    pm.triggerPinChange(PINS.VDD, false);
    pm.triggerPinChange(PINS.CLK, true);
    expect(readQ(pm).every((q) => q === 0)).toBe(true);
    chip.dispose();
  });

  it.skipIf(skip)('pre-strobe outputs stay LOW; only strobe latches them', async () => {
    const { pm, chip } = await newCd4094();

    for (const b of [1, 1, 1, 1, 1, 1, 1, 1]) shiftBit(pm, b);
    expect(readQ(pm).every((q) => q === 0)).toBe(true);
    strobe(pm);
    expect(readQ(pm).every((q) => q === 1)).toBe(true);
    chip.dispose();
  });

  it.skipIf(skip)('a second strobe latches the new shift register contents', async () => {
    const { pm, chip } = await newCd4094();

    for (const b of [1, 1, 1, 1, 1, 1, 1, 1]) shiftBit(pm, b);
    strobe(pm);
    expect(readQ(pm)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);

    for (const b of [0, 0, 0, 0, 0, 0, 0, 0]) shiftBit(pm, b);
    strobe(pm);
    expect(readQ(pm)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    chip.dispose();
  });
});
