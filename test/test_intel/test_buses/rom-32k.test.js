/**
 * rom-32k chip — 32 KB read-only memory with 16-bit address and 8-bit data.
 *
 * Pin contract (28-pin DIP — modelled after the 27C256 EPROM):
 *   A0..A14   — input  (15-bit address; high bit ignored when chip
 *                       is mapped above 0x8000 internally)
 *   D0..D7    — output (data, only driven when CE̅=0 AND OE̅=0)
 *   CE̅        — input, active low (chip enable)
 *   OE̅        — input, active low (output enable; tristates D0..D7)
 *   VCC, GND  — power
 *
 * Test image: when the .c source is compiled with
 *   #define ROM_TEST_IMAGE 1
 * it embeds a known 16-byte program at offset 0:
 *   00: 0x12 0x34 0x56 0x78 0x9A 0xBC 0xDE 0xF0
 *   08: 0x11 0x22 0x33 0x44 0x55 0x66 0x77 0x88
 * everything else is 0xFF.
 *
 * Tests assume that test image; the C source must honor it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BoardHarness } from '../src/BoardHarness.js';
import { chipWasmExists, hex8, hex16 } from '../src/helpers.js';

const CHIP = 'rom-32k';
const skip = !chipWasmExists(CHIP);

const TEST_IMAGE = [
  0x12, 0x34, 0x56, 0x78, 0x9A, 0xBC, 0xDE, 0xF0,
  0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88,
];

function setAddr(board, addr) {
  for (let i = 0; i < 15; i++) {
    board.setNet(`A${i}`, ((addr >> i) & 1) === 1);
  }
}

function readData(board) {
  let v = 0;
  for (let i = 0; i < 8; i++) if (board.getNet(`D${i}`)) v |= (1 << i);
  return v;
}

describe(`${CHIP} chip`, () => {
  let board;
  beforeEach(() => { board = new BoardHarness(); });
  afterEach(() => { board.dispose(); });

  describe('pin contract', () => {
    it.skipIf(skip)('registers all 25 logical pins (A0-A14, D0-D7, CE̅, OE̅)', async () => {
      const pinMap = {
        VCC: 'VCC', GND: 'GND', 'CE': 'CE', 'OE': 'OE',
      };
      for (let i = 0; i < 15; i++) pinMap[`A${i}`] = `A${i}`;
      for (let i = 0; i < 8;  i++) pinMap[`D${i}`] = `D${i}`;
      // If chip_setup throws (missing pin) ChipInstance.create rejects.
      await expect(board.addChip(CHIP, pinMap)).resolves.toBeDefined();
    });
  });

  describe('read protocol', () => {
    it.skipIf(skip)('drives D0..D7 with the byte at the asserted address', async () => {
      const pinMap = { VCC: 'VCC', GND: 'GND', CE: 'CE', OE: 'OE' };
      for (let i = 0; i < 15; i++) pinMap[`A${i}`] = `A${i}`;
      for (let i = 0; i < 8;  i++) pinMap[`D${i}`] = `D${i}`;
      await board.addChip(CHIP, pinMap);

      board.setNet('CE', false); // CE̅ asserted
      board.setNet('OE', false); // OE̅ asserted

      for (let addr = 0; addr < TEST_IMAGE.length; addr++) {
        setAddr(board, addr);
        board.advanceNanos(50);
        expect(readData(board), `addr=${hex16(addr)}`).toBe(TEST_IMAGE[addr]);
      }
    });

    it.skipIf(skip)('returns 0xFF for unprogrammed addresses', async () => {
      const pinMap = { VCC: 'VCC', GND: 'GND', CE: 'CE', OE: 'OE' };
      for (let i = 0; i < 15; i++) pinMap[`A${i}`] = `A${i}`;
      for (let i = 0; i < 8;  i++) pinMap[`D${i}`] = `D${i}`;
      await board.addChip(CHIP, pinMap);

      board.setNet('CE', false);
      board.setNet('OE', false);
      setAddr(board, 0x4000); // beyond TEST_IMAGE
      board.advanceNanos(50);
      expect(readData(board)).toBe(0xff);
    });

    it.skipIf(skip)('tristates D0..D7 when OE̅ is high', async () => {
      const pinMap = { VCC: 'VCC', GND: 'GND', CE: 'CE', OE: 'OE' };
      for (let i = 0; i < 15; i++) pinMap[`A${i}`] = `A${i}`;
      for (let i = 0; i < 8;  i++) pinMap[`D${i}`] = `D${i}`;
      await board.addChip(CHIP, pinMap);

      board.setNet('CE', false);
      board.setNet('OE', true);  // OE̅ deasserted
      setAddr(board, 0);
      board.advanceNanos(50);
      // With OE̅ high, the chip must NOT drive its data pins. We check
      // by externally driving D0..D7 high and verifying the chip
      // doesn't fight us.
      for (let i = 0; i < 8; i++) board.setNet(`D${i}`, true);
      board.advanceNanos(50);
      expect(readData(board)).toBe(0xff);
    });

    it.skipIf(skip)('does not drive D0..D7 when CE̅ is high', async () => {
      const pinMap = { VCC: 'VCC', GND: 'GND', CE: 'CE', OE: 'OE' };
      for (let i = 0; i < 15; i++) pinMap[`A${i}`] = `A${i}`;
      for (let i = 0; i < 8;  i++) pinMap[`D${i}`] = `D${i}`;
      await board.addChip(CHIP, pinMap);

      board.setNet('CE', true);   // CE̅ deasserted
      board.setNet('OE', false);
      setAddr(board, 0);
      board.advanceNanos(50);
      for (let i = 0; i < 8; i++) board.setNet(`D${i}`, true);
      board.advanceNanos(50);
      expect(readData(board)).toBe(0xff);
    });
  });

  describe('timing', () => {
    it.skipIf(skip)('updates data within one clock period of an address change', async () => {
      const pinMap = { VCC: 'VCC', GND: 'GND', CE: 'CE', OE: 'OE' };
      for (let i = 0; i < 15; i++) pinMap[`A${i}`] = `A${i}`;
      for (let i = 0; i < 8;  i++) pinMap[`D${i}`] = `D${i}`;
      await board.addChip(CHIP, pinMap);

      board.setNet('CE', false);
      board.setNet('OE', false);

      setAddr(board, 0); board.advanceNanos(50);
      expect(readData(board)).toBe(TEST_IMAGE[0]);

      setAddr(board, 5); board.advanceNanos(50);
      expect(readData(board)).toBe(TEST_IMAGE[5]);
    });
  });
});
