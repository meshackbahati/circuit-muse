/**
 * TIER 2 — UART protocol on the ROT13 chip.
 * 5 tests covering uppercase, lowercase, wrap-around, non-alpha passthrough, and a string round-trip.
 */
import { describe, it, expect } from 'vitest';
import { ChipInstance } from '../../src/ChipRuntime.js';
import { PinManager } from '../../src/PinManager.js';
import { loadChipWasm, chipWasmExists } from '../helpers.js';

const skip = !chipWasmExists('uart-rot13');

async function newRot13() {
  const pm = new PinManager();
  const chip = await ChipInstance.create({
    wasm: loadChipWasm('uart-rot13'), pinManager: pm,
    wires: new Map([['RX', 50], ['TX', 51]]),
  });
  chip.start();
  const out = [];
  chip.onUartTx((b) => out.push(b));
  return { chip, out };
}

const code = (c) => c.charCodeAt(0);

describe('TIER 2 — ROT13 UART chip', () => {
  it.skipIf(skip)('uppercase: "A" → "N", "N" → "A"', async () => {
    const { chip, out } = await newRot13();
    chip.feedUart(code('A'));
    chip.feedUart(code('N'));
    expect(out.map((b) => String.fromCharCode(b))).toEqual(['N', 'A']);
    chip.dispose();
  });

  it.skipIf(skip)('uppercase wrap: "Z" → "M"', async () => {
    const { chip, out } = await newRot13();
    chip.feedUart(code('Z'));
    chip.feedUart(code('M'));
    expect(out.map((b) => String.fromCharCode(b))).toEqual(['M', 'Z']);
    chip.dispose();
  });

  it.skipIf(skip)('lowercase: "hello" → "uryyb"', async () => {
    const { chip, out } = await newRot13();
    for (const c of 'hello') chip.feedUart(code(c));
    expect(String.fromCharCode(...out)).toBe('uryyb');
    chip.dispose();
  });

  it.skipIf(skip)('non-alphabetic bytes pass through unchanged', async () => {
    const { chip, out } = await newRot13();
    for (const b of [0x00, 0x09, 0x20, 0x30, 0x39, 0x7F, 0xFF]) chip.feedUart(b);
    expect(out).toEqual([0x00, 0x09, 0x20, 0x30, 0x39, 0x7F, 0xFF]);
    chip.dispose();
  });

  it.skipIf(skip)('round-trip: rot13(rot13(x)) === x for every printable ASCII', async () => {
    const { chip, out } = await newRot13();
    const input = [];
    for (let c = 0x20; c <= 0x7E; c++) input.push(c);

    for (const b of input) chip.feedUart(b);
    const intermediate = [...out];
    out.length = 0;
    for (const b of intermediate) chip.feedUart(b);
    expect(out).toEqual(input);
    chip.dispose();
  });
});
