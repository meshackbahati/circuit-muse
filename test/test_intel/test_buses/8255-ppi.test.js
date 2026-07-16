/**
 * Intel 8255 PPI — Mode 0 unit tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BoardHarness } from '../src/BoardHarness.js';
import { chipWasmExists } from '../src/helpers.js';

const CHIP = '8255-ppi';
const skip = !chipWasmExists(CHIP);

function pinMap() {
  const m = {
    A0: 'A0', A1: 'A1', CS: 'CS', RD: 'RD', WR: 'WR', RESET: 'RESET',
    VCC: 'VCC', GND: 'GND',
  };
  for (let i = 0; i < 8; i++) m[`D${i}`]  = `D${i}`;
  for (let i = 0; i < 8; i++) m[`PA${i}`] = `PA${i}`;
  for (let i = 0; i < 8; i++) m[`PB${i}`] = `PB${i}`;
  for (let i = 0; i < 8; i++) m[`PC${i}`] = `PC${i}`;
  return m;
}

function setData(board, byte) {
  for (let i = 0; i < 8; i++) board.setNet(`D${i}`, ((byte >> i) & 1) === 1);
}
function readData(board) {
  let v = 0;
  for (let i = 0; i < 8; i++) if (board.getNet(`D${i}`)) v |= (1 << i);
  return v;
}
function readPort(board, prefix) {
  let v = 0;
  for (let i = 0; i < 8; i++) if (board.getNet(`${prefix}${i}`)) v |= (1 << i);
  return v;
}
function setPort(board, prefix, byte) {
  for (let i = 0; i < 8; i++) board.setNet(`${prefix}${i}`, ((byte >> i) & 1) === 1);
}

/** CPU-side write to the PPI's register at A1A0 = addr (0..3). */
function ppiWrite(board, addr, value) {
  board.setNet('A0', (addr & 1) !== 0);
  board.setNet('A1', (addr & 2) !== 0);
  setData(board, value);
  board.advanceNanos(20);
  board.setNet('CS', false);
  board.setNet('WR', false);
  board.advanceNanos(20);
  board.setNet('WR', true);          // rising edge latches
  board.advanceNanos(20);
  board.setNet('CS', true);
}

function ppiRead(board, addr) {
  board.setNet('A0', (addr & 1) !== 0);
  board.setNet('A1', (addr & 2) !== 0);
  board.setNet('CS', false);
  board.setNet('RD', false);
  board.advanceNanos(20);
  const v = readData(board);
  board.setNet('RD', true);
  board.setNet('CS', true);
  return v;
}

async function setup(board) {
  await board.addChip(CHIP, pinMap());
  // Idle: CS̅ and strobes high.
  board.setNet('CS', true);
  board.setNet('RD', true);
  board.setNet('WR', true);
  // Pulse RESET to ensure clean state.
  board.setNet('RESET', true);
  board.advanceNanos(50);
  board.setNet('RESET', false);
  board.advanceNanos(50);
}

describe(`${CHIP} chip`, () => {
  let board;
  beforeEach(() => { board = new BoardHarness(); });
  afterEach(() => { board.dispose(); });

  it.skipIf(skip)('registers all 40 logical pins', async () => {
    await expect(board.addChip(CHIP, pinMap())).resolves.toBeDefined();
  });

  it.skipIf(skip)('Mode 0: PA configured as output, value latched and driven', async () => {
    await setup(board);
    // Control word 0x80 = mode set, all ports output.
    ppiWrite(board, 3, 0x80);
    // Write 0xA5 to port A.
    ppiWrite(board, 0, 0xA5);
    expect(readPort(board, 'PA')).toBe(0xA5);
  });

  it.skipIf(skip)('Mode 0: PB configured as input, CPU read returns external pin states', async () => {
    await setup(board);
    // Control 0x82 = bit 1 = 1 → PB is input.
    ppiWrite(board, 3, 0x82);
    // Externally drive PB pins to 0x3C.
    setPort(board, 'PB', 0x3C);
    board.advanceNanos(20);
    expect(ppiRead(board, 1)).toBe(0x3C);
  });

  it.skipIf(skip)('Mode 0: PC upper/lower halves independent', async () => {
    await setup(board);
    // Control: bit 0=1 (PC low input), bit 3=0 (PC high output).
    // Plus mode set bit 7. Group A: PA out (bit 4=0), PC up out (bit 3=0).
    // Group B: PB out (bit 1=0), PC low input (bit 0=1).
    // = 0b1000_0001 = 0x81
    ppiWrite(board, 3, 0x81);
    // Externally drive PC0..PC3 to 0xA (= 1010 binary).
    for (let i = 0; i < 4; i++) board.setNet(`PC${i}`, ((0xA >> i) & 1) === 1);
    // CPU writes 0xF0 to port C → high nibble drives, low nibble is input.
    ppiWrite(board, 2, 0xF0);
    board.advanceNanos(20);
    // Read PC4..PC7 from chip-driven side.
    const pc_high_byte = readPort(board, 'PC') & 0xF0;
    expect(pc_high_byte).toBe(0xF0);
    // CPU reads port C: high nibble = output latch (0xF0), low = external (0xA).
    const cpu_view = ppiRead(board, 2);
    expect(cpu_view).toBe(0xFA);
  });

  it.skipIf(skip)('CS̅ high blocks reads (chip does not drive D)', async () => {
    await setup(board);
    ppiWrite(board, 3, 0x80);
    ppiWrite(board, 0, 0x77);
    // CS̅ stays high — try to read.
    board.setNet('A0', false); board.setNet('A1', false);
    board.setNet('RD', false);
    // External drive D high to test contention.
    for (let i = 0; i < 8; i++) board.setNet(`D${i}`, true);
    board.advanceNanos(20);
    expect(readData(board)).toBe(0xFF);
    board.setNet('RD', true);
  });
});
