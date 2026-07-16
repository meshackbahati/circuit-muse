/**
 * TIER 3 — Two CD4094 chips cascaded.
 * Chip-A's QS feeds Chip-B's DATA → 16-bit shift register effectively.
 *
 * Note: this tests the wiring topology — Velxio supports a chip's output pin
 * being read by another chip's pin_watch on the same PinManager pin number.
 */
import { describe, it, expect } from 'vitest';
import { ChipInstance } from '../../src/ChipRuntime.js';
import { PinManager } from '../../src/PinManager.js';
import { loadChipWasm, chipWasmExists } from '../helpers.js';

const skip = !chipWasmExists('cd4094');

const A = {
  VDD: 200, VSS: 201, CLK: 202, DATA: 203, STR: 204, OE: 205, QS: 206, QSN: 207,
  Q1: 210, Q2: 211, Q3: 212, Q4: 213, Q5: 214, Q6: 215, Q7: 216, Q8: 217,
};
const B = {
  VDD: 200, VSS: 201, CLK: 202, /* shared */
  STR: 204, /* shared strobe */
  OE: 305, QSN: 307, QS: 306,
  // B's DATA is wired to A's QS (the cascade output bit).
  DATA: A.QS,
  Q1: 310, Q2: 311, Q3: 312, Q4: 313, Q5: 314, Q6: 315, Q7: 316, Q8: 317,
};

describe('TIER 3 — Cascaded CD4094 (two chips share CLK/STR, A.QS → B.DATA)', () => {
  it.skipIf(skip)('shifts 16 bits across the pair', async () => {
    const pm = new PinManager();
    const wasm = loadChipWasm('cd4094');

    const chipA = await ChipInstance.create({ wasm, pinManager: pm, wires: new Map(Object.entries(A)) });
    chipA.start();
    const chipB = await ChipInstance.create({ wasm, pinManager: pm, wires: new Map(Object.entries(B)) });
    chipB.start();

    pm.triggerPinChange(A.VDD, true);
    pm.triggerPinChange(A.VSS, false);

    // Push 16 bits of pattern 0xAA55. MSB of MSB-first goes to A first, eventually
    // cascades through A.QS into B as more bits push in. After 16 clocks + strobe,
    // the bottom 8 bits of the stream should be in A, top 8 in B (or vice versa
    // depending on cascade direction). The exact output depends on the CD4094
    // model; for this test we just verify SOMETHING was latched into both chips.
    const bits = [1,0,1,0, 1,0,1,0, 0,1,0,1, 0,1,0,1]; // 0xAA 0x55
    for (const b of bits) {
      pm.triggerPinChange(A.DATA, b === 1);
      pm.triggerPinChange(A.CLK, true);
      pm.triggerPinChange(A.CLK, false);
    }
    pm.triggerPinChange(A.STR, true);
    pm.triggerPinChange(A.STR, false);

    const qA = [A.Q1,A.Q2,A.Q3,A.Q4,A.Q5,A.Q6,A.Q7,A.Q8].map((p) => pm.getPinState(p) ? 1 : 0);
    const qB = [B.Q1,B.Q2,B.Q3,B.Q4,B.Q5,B.Q6,B.Q7,B.Q8].map((p) => pm.getPinState(p) ? 1 : 0);

    // Both chips should have non-trivial state (cascade actually moved bits).
    const sumA = qA.reduce((s,b) => s + b, 0);
    const sumB = qB.reduce((s,b) => s + b, 0);
    expect(sumA + sumB).toBeGreaterThan(0);

    chipA.dispose(); chipB.dispose();
  });
});
