/**
 * Intel 8259 PIC — unit tests.
 *
 * Verifies the CPU-facing register interface (init word sequence, OCW1
 * mask, EOI), the IRQ-to-INT pipeline, and the INTA acknowledge cycle.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BoardHarness } from '../src/BoardHarness.js';
import { chipWasmExists } from '../src/helpers.js';

const CHIP = '8259-pic';
const skip = !chipWasmExists(CHIP);

function pinMap() {
  const m = {
    A0: 'A0', CS: 'CS', RD: 'RD', WR: 'WR',
    INT: 'INT', INTA: 'INTA',
    CAS0: 'CAS0', CAS1: 'CAS1', CAS2: 'CAS2', SPEN: 'SPEN',
    VCC: 'VCC', GND: 'GND',
  };
  for (let i = 0; i < 8; i++) m[`D${i}`]   = `D${i}`;
  for (let i = 0; i < 8; i++) m[`IRQ${i}`] = `IRQ${i}`;
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

function picWrite(board, a0, value) {
  board.setNet('A0', a0 !== 0);
  setData(board, value);
  board.advanceNanos(20);
  board.setNet('CS', false);
  board.setNet('WR', false);
  board.advanceNanos(20);
  board.setNet('WR', true);   // rising-edge latch
  board.advanceNanos(20);
  board.setNet('CS', true);
}
function picRead(board, a0) {
  board.setNet('A0', a0 !== 0);
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
  board.setNet('CS', true);
  board.setNet('RD', true);
  board.setNet('WR', true);
  board.setNet('INTA', true);
  for (let i = 0; i < 8; i++) board.setNet(`IRQ${i}`, false);
  // Init: ICW1 (single mode + ICW4 needed), ICW2 (vector base 0x40),
  // ICW4 (8086 mode bit 0 = 1). After this, IRQ vectors are
  // 0x40..0x47.
  picWrite(board, 0, 0x13);   // ICW1: single, edge-trig, ICW4-needed
  picWrite(board, 1, 0x40);   // ICW2: vector base = 0x40
  picWrite(board, 1, 0x01);   // ICW4: 8086 mode
  picWrite(board, 1, 0x00);   // OCW1: unmask all (IMR = 0)
}

describe(`${CHIP} chip`, () => {
  let board;
  beforeEach(() => { board = new BoardHarness(); });
  afterEach(() => { board.dispose(); });

  it.skipIf(skip)('registers all 28 logical pins', async () => {
    await expect(board.addChip(CHIP, pinMap())).resolves.toBeDefined();
  });

  it.skipIf(skip)('IRQ0 rising drives INT high after init', async () => {
    await setup(board);
    expect(board.getNet('INT')).toBe(false);
    board.setNet('IRQ0', true);
    board.advanceNanos(20);
    expect(board.getNet('INT')).toBe(true);
  });

  it.skipIf(skip)('INTA falling drives the IRQ0 vector (0x40) on D bus', async () => {
    await setup(board);
    board.setNet('IRQ0', true);
    board.advanceNanos(20);
    // CPU asserts INTA̅
    board.setNet('INTA', false);
    board.advanceNanos(20);
    expect(readData(board)).toBe(0x40);
    expect(board.getNet('INT')).toBe(false);   // INT deasserted on ack
    board.setNet('INTA', true);
  });

  it.skipIf(skip)('IRQ3 produces vector base+3 = 0x43', async () => {
    await setup(board);
    board.setNet('IRQ3', true);
    board.advanceNanos(20);
    board.setNet('INTA', false);
    board.advanceNanos(20);
    expect(readData(board)).toBe(0x43);
  });

  it.skipIf(skip)('IMR mask suppresses INT', async () => {
    await setup(board);
    // Mask IRQ0 by writing OCW1 with bit 0 set.
    picWrite(board, 1, 0x01);
    board.setNet('IRQ0', true);
    board.advanceNanos(20);
    expect(board.getNet('INT')).toBe(false);
  });

  it.skipIf(skip)('non-specific EOI clears the in-service bit', async () => {
    await setup(board);
    board.setNet('IRQ0', true);
    board.advanceNanos(20);
    // Acknowledge to lock ISR
    board.setNet('INTA', false);
    board.advanceNanos(20);
    board.setNet('INTA', true);
    board.advanceNanos(20);
    // ISR bit 0 should be set; reading ISR via OCW3 + RD A0=0 confirms.
    picWrite(board, 0, 0x0B);   // OCW3: read ISR next
    expect(picRead(board, 0)).toBe(0x01);
    // Send non-specific EOI
    picWrite(board, 0, 0x20);
    expect(picRead(board, 0)).toBe(0x00);
  });

  it.skipIf(skip)('higher-priority IRQ pre-empts lower-priority pending', async () => {
    await setup(board);
    // IRQ7 lower priority than IRQ1.
    board.setNet('IRQ7', true);
    board.advanceNanos(20);
    expect(board.getNet('INT')).toBe(true);
    // ACK IRQ7
    board.setNet('INTA', false);
    board.advanceNanos(20);
    expect(readData(board)).toBe(0x47);
    board.setNet('INTA', true);
    board.advanceNanos(20);
    // Now IRQ1 fires while IRQ7 is in-service. Should pre-empt INT.
    board.setNet('IRQ1', true);
    board.advanceNanos(20);
    expect(board.getNet('INT')).toBe(true);
    board.setNet('INTA', false);
    board.advanceNanos(20);
    expect(readData(board)).toBe(0x41);
  });
});
