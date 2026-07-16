/**
 * ram-64k chip — 64 KB RAM with 16-bit address bus, 8-bit bidirectional
 * data bus. Modelled after the HM62256 / 6264 family.
 *
 * Pin contract (28-pin DIP):
 *   A0..A15  — input  (16-bit address)
 *   D0..D7   — bidirectional (input on write, output on read)
 *   CE̅       — input, active low
 *   OE̅       — input, active low (output enable for reads)
 *   WE̅       — input, active low (write enable; pulse low to write)
 *   VCC, GND
 *
 * RAM is volatile — starts zero-initialized at chip_setup, no embedded
 * image, no persistence between simulation runs.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BoardHarness } from '../src/BoardHarness.js';
import { chipWasmExists, hex16 } from '../src/helpers.js';

const CHIP = 'ram-64k';
const skip = !chipWasmExists(CHIP);

function pinMap() {
  const m = { VCC: 'VCC', GND: 'GND', CE: 'CE', OE: 'OE', WE: 'WE' };
  for (let i = 0; i < 16; i++) m[`A${i}`] = `A${i}`;
  for (let i = 0; i < 8;  i++) m[`D${i}`] = `D${i}`;
  return m;
}

function setAddr(board, addr) {
  for (let i = 0; i < 16; i++) board.setNet(`A${i}`, ((addr >> i) & 1) === 1);
}

function setData(board, byte) {
  for (let i = 0; i < 8; i++) board.setNet(`D${i}`, ((byte >> i) & 1) === 1);
}

function readData(board) {
  let v = 0;
  for (let i = 0; i < 8; i++) if (board.getNet(`D${i}`)) v |= (1 << i);
  return v;
}

async function setupRam(board) {
  await board.addChip(CHIP, pinMap());
  board.setNet('CE', false);
  board.setNet('OE', true);   // start with OE̅ deasserted
  board.setNet('WE', true);   // start with WE̅ deasserted
}

/** Drive a write cycle: address + data on bus, pulse WE̅ low then high. */
function writeCycle(board, addr, data) {
  setAddr(board, addr);
  setData(board, data);
  board.advanceNanos(20);
  board.setNet('WE', false);
  board.advanceNanos(20);
  board.setNet('WE', true);   // rising edge latches
  board.advanceNanos(20);
}

/** Drive a read cycle: address on bus, OE̅ low, sample. */
function readCycle(board, addr) {
  setAddr(board, addr);
  board.setNet('OE', false);
  board.advanceNanos(50);
  const v = readData(board);
  board.setNet('OE', true);
  return v;
}

describe(`${CHIP} chip`, () => {
  let board;
  beforeEach(() => { board = new BoardHarness(); });
  afterEach(() => { board.dispose(); });

  describe('pin contract', () => {
    it.skipIf(skip)('registers all logical pins', async () => {
      await expect(board.addChip(CHIP, pinMap())).resolves.toBeDefined();
    });
  });

  describe('write then read', () => {
    it.skipIf(skip)('round-trips a single byte at low address', async () => {
      await setupRam(board);
      writeCycle(board, 0x0000, 0xA5);
      expect(readCycle(board, 0x0000)).toBe(0xA5);
    });

    it.skipIf(skip)('round-trips bytes at scattered addresses', async () => {
      await setupRam(board);
      const samples = [
        [0x0000, 0x11], [0x00FF, 0x22], [0x0100, 0x33], [0x1234, 0x44],
        [0x8000, 0x55], [0xFFFE, 0x66], [0xFFFF, 0x77],
      ];
      for (const [a, d] of samples) writeCycle(board, a, d);
      for (const [a, d] of samples) {
        expect(readCycle(board, a), `addr=${hex16(a)}`).toBe(d);
      }
    });

    it.skipIf(skip)('writes to one address do not corrupt neighbours', async () => {
      await setupRam(board);
      writeCycle(board, 0x4000, 0xAB);
      writeCycle(board, 0x4001, 0xCD);
      writeCycle(board, 0x4002, 0xEF);
      writeCycle(board, 0x4001, 0x99);
      expect(readCycle(board, 0x4000)).toBe(0xAB);
      expect(readCycle(board, 0x4001)).toBe(0x99);
      expect(readCycle(board, 0x4002)).toBe(0xEF);
    });
  });

  describe('blank state', () => {
    it.skipIf(skip)('reads 0x00 from never-written addresses', async () => {
      await setupRam(board);
      expect(readCycle(board, 0x1234)).toBe(0x00);
    });
  });

  describe('control signals', () => {
    it.skipIf(skip)('does not write when CE̅ is high', async () => {
      await setupRam(board);
      // Try to write with CE̅ high
      board.setNet('CE', true);
      writeCycle(board, 0x0000, 0xFF);
      board.setNet('CE', false);
      expect(readCycle(board, 0x0000)).toBe(0x00);
    });

    it.skipIf(skip)('does not drive data when OE̅ is high', async () => {
      await setupRam(board);
      writeCycle(board, 0x0000, 0xA5);
      // Read with OE̅ high — chip should leave bus alone
      setAddr(board, 0x0000);
      board.setNet('OE', true);
      // Externally drive bus high; chip must not contend
      for (let i = 0; i < 8; i++) board.setNet(`D${i}`, true);
      board.advanceNanos(50);
      expect(readData(board)).toBe(0xff);
    });
  });
});
