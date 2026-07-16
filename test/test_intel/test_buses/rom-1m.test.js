/**
 * rom-1m chip — 1 MiB ROM with 20-bit address bus, used by 8086 boards.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BoardHarness } from '../src/BoardHarness.js';
import { chipWasmExists } from '../src/helpers.js';

const CHIP = 'rom-1m';
const skip = !chipWasmExists(CHIP);

const RESET_SIGNATURE = [
  0xEA, 0x00, 0x01, 0x00, 0xF0,
  0x55, 0xAA, 0x12, 0x34,
  0x56, 0x78, 0x9A, 0xBC, 0xDE, 0xF0, 0x77,
];

function pinMap() {
  const m = { VCC: 'VCC', GND: 'GND', CE: 'CE', OE: 'OE' };
  for (let i = 0; i < 20; i++) m[`A${i}`] = `A${i}`;
  for (let i = 0; i < 8;  i++) m[`D${i}`] = `D${i}`;
  return m;
}

function setAddr(board, addr) {
  for (let i = 0; i < 20; i++) board.setNet(`A${i}`, ((addr >> i) & 1) === 1);
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

  it.skipIf(skip)('registers all 30 logical pins', async () => {
    await expect(board.addChip(CHIP, pinMap())).resolves.toBeDefined();
  });

  it.skipIf(skip)('reads the 16-byte reset signature at 0xFFFF0', async () => {
    await board.addChip(CHIP, pinMap());
    board.setNet('CE', false);
    board.setNet('OE', false);
    for (let i = 0; i < RESET_SIGNATURE.length; i++) {
      setAddr(board, 0xFFFF0 + i);
      board.advanceNanos(50);
      expect(readData(board), `addr=0x${(0xFFFF0+i).toString(16)}`).toBe(RESET_SIGNATURE[i]);
    }
  });

  it.skipIf(skip)('returns 0xFF for unprogrammed addresses inside the ROM range', async () => {
    await board.addChip(CHIP, pinMap());
    board.setNet('CE', false);
    board.setNet('OE', false);
    // 0xF0000 is the start of the ROM; only the last 16 bytes (the
    // reset signature) are programmed, everything else is 0xFF.
    setAddr(board, 0xF0000);
    board.advanceNanos(50);
    expect(readData(board)).toBe(0xff);
  });

  it.skipIf(skip)('does not drive D when CE̅ or OE̅ is high', async () => {
    await board.addChip(CHIP, pinMap());
    board.setNet('CE', true);
    board.setNet('OE', false);
    setAddr(board, 0xFFFF0);
    board.advanceNanos(50);
    for (let i = 0; i < 8; i++) board.setNet(`D${i}`, true);
    board.advanceNanos(50);
    expect(readData(board)).toBe(0xff);
  });
});
