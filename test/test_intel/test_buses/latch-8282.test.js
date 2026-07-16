/**
 * Intel 8282 octal latch — TDD spec.
 *
 * The 8282 is the canonical address latch used on 8086 minimum-mode
 * boards to demultiplex AD0..AD15 → A0..A15. ALE from the 8086 drives
 * STB; when ALE pulses high the latch becomes transparent, when ALE
 * falls the address is latched and held while AD becomes the data bus.
 *
 * 20-pin DIP behaviour (per Intel 8282/8283 datasheet):
 *   STB=1, OE̅=0 → DOn = DIn       (transparent)
 *   STB falling, OE̅=0 → DOn = DIn at the moment STB went 0→1→0
 *                                    (latched, held while STB=0)
 *   OE̅=1 → DO pins float (we model by switching to VX_INPUT)
 *
 * The 8283 is the inverting variant (DOn = ~DIn). We implement the
 * non-inverting 8282 only.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BoardHarness } from '../src/BoardHarness.js';
import { chipWasmExists } from '../src/helpers.js';

const CHIP = 'latch-8282';
const skip = !chipWasmExists(CHIP);

function pinMap() {
  const m = { STB: 'STB', OE: 'OE', VCC: 'VCC', GND: 'GND' };
  for (let i = 0; i < 8; i++) {
    m[`DI${i}`] = `DI${i}`;
    m[`DO${i}`] = `DO${i}`;
  }
  return m;
}

function setDI(board, byte) {
  for (let i = 0; i < 8; i++) board.setNet(`DI${i}`, ((byte >> i) & 1) === 1);
}

function readDO(board) {
  let v = 0;
  for (let i = 0; i < 8; i++) if (board.getNet(`DO${i}`)) v |= (1 << i);
  return v;
}

describe(`${CHIP} chip`, () => {
  let board;
  beforeEach(() => { board = new BoardHarness(); });
  afterEach(() => { board.dispose(); });

  describe('pin contract', () => {
    it.skipIf(skip)('registers all 20 logical pins', async () => {
      await expect(board.addChip(CHIP, pinMap())).resolves.toBeDefined();
    });
  });

  describe('transparent mode', () => {
    it.skipIf(skip)('DO follows DI while STB=1 and OE̅=0', async () => {
      await board.addChip(CHIP, pinMap());
      board.setNet('OE', false);
      board.setNet('STB', true);

      setDI(board, 0xA5);
      board.advanceNanos(20);
      expect(readDO(board)).toBe(0xA5);

      setDI(board, 0x3C);
      board.advanceNanos(20);
      expect(readDO(board)).toBe(0x3C);
    });
  });

  describe('latch mode', () => {
    it.skipIf(skip)('holds DI value at the moment STB falls', async () => {
      // Real 8282 is "transparent while STB=1, latched when STB=0".
      // The latched value is whatever DI was at the falling edge.
      await board.addChip(CHIP, pinMap());
      board.setNet('OE', false);
      board.setNet('STB', true);

      setDI(board, 0x77);
      board.advanceNanos(20);
      // Drop STB → freeze
      board.setNet('STB', false);
      board.advanceNanos(20);
      expect(readDO(board)).toBe(0x77);

      // Change DI; DO should NOT change.
      setDI(board, 0xFF);
      board.advanceNanos(20);
      expect(readDO(board)).toBe(0x77);

      // Raise STB → transparent again
      board.setNet('STB', true);
      board.advanceNanos(20);
      expect(readDO(board)).toBe(0xFF);
    });
  });

  describe('output enable', () => {
    it.skipIf(skip)('does not drive DO pins when OE̅ is high', async () => {
      await board.addChip(CHIP, pinMap());
      board.setNet('STB', true);
      setDI(board, 0xAA);
      board.advanceNanos(20);
      expect(readDO(board)).toBe(0xAA);

      // OE̅ high → 8282 should release outputs. Externally drive DO
      // pins high; 8282 must not pull them back down.
      board.setNet('OE', true);
      board.advanceNanos(20);
      for (let i = 0; i < 8; i++) board.setNet(`DO${i}`, true);
      board.advanceNanos(20);
      expect(readDO(board)).toBe(0xff);
    });
  });
});
