/**
 * Intel 8253 PIT — unit tests for Mode 0, Mode 3.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BoardHarness } from '../src/BoardHarness.js';
import { chipWasmExists } from '../src/helpers.js';

const CHIP = '8253-pit';
const skip = !chipWasmExists(CHIP);

function pinMap() {
  const m = {
    A0: 'A0', A1: 'A1', CS: 'CS', RD: 'RD', WR: 'WR',
    VCC: 'VCC', GND: 'GND',
  };
  for (let i = 0; i < 8; i++) m[`D${i}`] = `D${i}`;
  for (let i = 0; i < 3; i++) {
    m[`CLK${i}`]  = `CLK${i}`;
    m[`GATE${i}`] = `GATE${i}`;
    m[`OUT${i}`]  = `OUT${i}`;
  }
  return m;
}

function setData(board, byte) {
  for (let i = 0; i < 8; i++) board.setNet(`D${i}`, ((byte >> i) & 1) === 1);
}

function pitWrite(board, sel, value) {
  board.setNet('A0', (sel & 1) !== 0);
  board.setNet('A1', (sel & 2) !== 0);
  setData(board, value);
  board.advanceNanos(20);
  board.setNet('CS', false);
  board.setNet('WR', false);
  board.advanceNanos(20);
  board.setNet('WR', true);
  board.advanceNanos(20);
  board.setNet('CS', true);
}

function pulseCLK(board, idx, n) {
  for (let i = 0; i < n; i++) {
    board.setNet(`CLK${idx}`, false);
    board.advanceNanos(10);
    board.setNet(`CLK${idx}`, true);
    board.advanceNanos(10);
  }
}

async function setup(board) {
  await board.addChip(CHIP, pinMap());
  board.setNet('CS', true);
  board.setNet('RD', true);
  board.setNet('WR', true);
  for (let i = 0; i < 3; i++) {
    board.setNet(`CLK${i}`, false);
    board.setNet(`GATE${i}`, true);
  }
}

describe(`${CHIP} chip`, () => {
  let board;
  beforeEach(() => { board = new BoardHarness(); });
  afterEach(() => { board.dispose(); });

  it.skipIf(skip)('registers all 24 logical pins', async () => {
    await expect(board.addChip(CHIP, pinMap())).resolves.toBeDefined();
  });

  it.skipIf(skip)('Mode 0: OUT low after control, high when count reaches 0', async () => {
    await setup(board);
    // Counter 0, RW LSB only, Mode 0: 0011_000_0 = 0x10
    pitWrite(board, 3, 0x10);
    expect(board.getNet('OUT0')).toBe(false);
    // Load count = 5
    pitWrite(board, 0, 0x05);
    // Pulse CLK0 four times → count goes 5→4→3→2→1, OUT still low.
    pulseCLK(board, 0, 4);
    expect(board.getNet('OUT0')).toBe(false);
    // One more pulse → count → 0, OUT goes high.
    pulseCLK(board, 0, 1);
    expect(board.getNet('OUT0')).toBe(true);
  });

  it.skipIf(skip)('Mode 0: GATE low pauses countdown', async () => {
    await setup(board);
    pitWrite(board, 3, 0x10);   // ch0 LSB Mode 0
    pitWrite(board, 0, 0x03);
    // Drop GATE — pulses should not decrement.
    board.setNet('GATE0', false);
    pulseCLK(board, 0, 10);
    expect(board.getNet('OUT0')).toBe(false);
    // Restore GATE — now 3 pulses get to terminal count.
    board.setNet('GATE0', true);
    pulseCLK(board, 0, 3);
    expect(board.getNet('OUT0')).toBe(true);
  });

  it.skipIf(skip)('Mode 3: OUT toggles every count/2 CLKs', async () => {
    await setup(board);
    // Counter 1, RW LSB+MSB, Mode 3: 01_11_011_0 = 0x76
    pitWrite(board, 3, 0x76);
    // OUT should be HIGH after Mode 3 control word
    expect(board.getNet('OUT1')).toBe(true);
    // Load count = 4 (LSB then MSB)
    pitWrite(board, 1, 0x04);
    pitWrite(board, 1, 0x00);
    // Mode 3 decrements by 2 each CLK; with count=4, OUT toggles
    // every 2 CLKs.
    pulseCLK(board, 1, 2);
    expect(board.getNet('OUT1')).toBe(false);
    pulseCLK(board, 1, 2);
    expect(board.getNet('OUT1')).toBe(true);
  });
});
