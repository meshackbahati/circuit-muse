/**
 * Intel 8251 USART — async-mode unit tests.
 *
 * Verifies CPU-side register interface (mode word + command word
 * loading, status read, data write/read). Does NOT exercise the
 * actual TxD/RxD bit timing — that's handled by the runtime's UART
 * abstraction and proven by the test_custom_chips/uart-rot13 tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BoardHarness } from '../src/BoardHarness.js';
import { chipWasmExists } from '../src/helpers.js';

const CHIP = '8251-usart';
const skip = !chipWasmExists(CHIP);

function pinMap() {
  const m = {
    RD: 'RD', WR: 'WR', CS: 'CS', CD: 'CD', RESET: 'RESET', CLK: 'CLK',
    TXD: 'TXD', RXD: 'RXD',
    TXRDY: 'TXRDY', RXRDY: 'RXRDY', TXEMPTY: 'TXEMPTY',
    DSR: 'DSR', DTR: 'DTR', CTS: 'CTS', RTS: 'RTS',
    VCC: 'VCC', GND: 'GND',
  };
  for (let i = 0; i < 8; i++) m[`D${i}`] = `D${i}`;
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

function uartWrite(board, cd, value) {
  board.setNet('CD', cd);
  setData(board, value);
  board.advanceNanos(20);
  board.setNet('CS', false);
  board.setNet('WR', false);
  board.advanceNanos(20);
  board.setNet('WR', true);
  board.advanceNanos(20);
  board.setNet('CS', true);
}
function uartRead(board, cd) {
  board.setNet('CD', cd);
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
  board.setNet('RESET', true);
  board.advanceNanos(50);
  board.setNet('RESET', false);
  board.advanceNanos(50);
}

describe(`${CHIP} chip`, () => {
  let board;
  beforeEach(() => { board = new BoardHarness(); });
  afterEach(() => { board.dispose(); });

  it.skipIf(skip)('registers all logical pins', async () => {
    await expect(board.addChip(CHIP, pinMap())).resolves.toBeDefined();
  });

  it.skipIf(skip)('after RESET status reads as TxEMPTY without TxRDY', async () => {
    await setup(board);
    const status = uartRead(board, true);
    // bit 0 (TxRDY) = 0 (not enabled yet); bit 2 (TxEMPTY) = 1.
    expect(status & 0x01).toBe(0);
    expect(status & 0x04).toBe(0x04);
  });

  it.skipIf(skip)('mode + command init sequence enables Tx', async () => {
    await setup(board);
    // Mode word: 0x4E = 8N1, baud rate factor x16 (typical setup).
    uartWrite(board, true, 0x4E);
    // Command word: 0x05 = TxEnable + RxEnable.
    uartWrite(board, true, 0x05);
    const status = uartRead(board, true);
    expect(status & 0x01, 'TxRDY set after Tx-enable').toBe(0x01);
  });

  it.skipIf(skip)('command write 0x40 internal-reset returns to expecting mode word', async () => {
    await setup(board);
    uartWrite(board, true, 0x4E);   // mode
    uartWrite(board, true, 0x05);   // command — Tx + Rx enable
    uartWrite(board, true, 0x40);   // internal reset

    // Now the next write to control should be interpreted as a NEW mode
    // word (0x4E) rather than a command. After mode + new command, Tx
    // should re-enable.
    uartWrite(board, true, 0x4E);
    uartWrite(board, true, 0x05);
    const status = uartRead(board, true);
    expect(status & 0x01).toBe(0x01);
  });
});
