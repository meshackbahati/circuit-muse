/**
 * TIER 3 — Chained logic chips: XOR → Inverter.
 *
 * Wires:  A, B → XOR.A, XOR.B
 *         XOR.OUT → INVERTER.IN
 *         INVERTER.OUT → final output
 * Final output should equal !(A xor B) = XNOR.
 */
import { describe, it, expect } from 'vitest';
import { ChipInstance } from '../../src/ChipRuntime.js';
import { PinManager } from '../../src/PinManager.js';
import { loadChipWasm, chipWasmExists } from '../helpers.js';

const skip = !chipWasmExists('xor') || !chipWasmExists('inverter');

describe('TIER 3 — Chained chips: XOR → Inverter == XNOR', () => {
  it.skipIf(skip)('truth table of XNOR via two cascaded chips', async () => {
    const pm = new PinManager();

    // Pin 80 = A, 81 = B, 82 = XOR.OUT (also INVERTER.IN), 83 = final OUT
    const xor = await ChipInstance.create({
      wasm: loadChipWasm('xor'),
      pinManager: pm,
      wires: new Map([['A', 80], ['B', 81], ['OUT', 82]]),
    });
    xor.start();

    const inv = await ChipInstance.create({
      wasm: loadChipWasm('inverter'),
      pinManager: pm,
      wires: new Map([['IN', 82], ['OUT', 83]]),
    });
    inv.start();

    // Now run the truth table — pin 83 should equal !(A xor B) = XNOR.
    const cases = [
      [false, false, true],
      [false, true,  false],
      [true,  false, false],
      [true,  true,  true],
    ];
    for (const [a, b, expected] of cases) {
      pm.triggerPinChange(80, a);
      pm.triggerPinChange(81, b);
      expect(pm.getPinState(83)).toBe(expected);
    }

    xor.dispose(); inv.dispose();
  });
});
