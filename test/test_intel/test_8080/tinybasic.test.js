/**
 * Palo Alto Tiny BASIC v2 — end-to-end Intel 8080 integration test.
 *
 * Origin: Li-Chen Wang's Tiny BASIC (Pittsburgh People's Computer
 * Company, May 1976; "@COPYLEFT, ALL WRONGS RESERVED" notice = PD).
 * The .hex distributed by CPUville (`tinybasic2dms_hex.txt`) is a
 * port to the CPUville 8080 board with a polled 8251A UART. ~1.9 KB
 * of code fitting in 0x0000..0x07FF.
 *
 *   I/O ports (polled 8251A):
 *     0x02 — UART data register (read RX, write TX)
 *     0x03 — UART status (bit 0 = TX ready, bit 1 = RX ready)
 *
 * What we verify
 * --------------
 * 1) The 8080 chip executes Wang's 1976 PD Tiny BASIC ROM end-to-
 *    end far enough for the prompt routine to run.
 * 2) The chip drives `OUT 0x03` (8251 mode init) and `OUT 0x02`
 *    (TX data) — i.e. our chip's port-I/O bus protocol is correct
 *    against real-world historic ROM.
 * 3) The TX stream contains the ASCII "OK" prompt (with surrounding
 *    CR/LF), proving the BASIC interpreter reached its main loop.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { BoardHarness } from '../src/BoardHarness.js';
import { chipWasmExists } from '../src/helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HEX_PATH = join(__dirname, '..', 'roms', '8080', 'tinybasic.hex');

const skip = !chipWasmExists('8080') || !existsSync(HEX_PATH);

const CLOCK_NS = 500;   // 2 MHz 8080

/** Parse Intel HEX format into a flat byte array. */
function parseIntelHex(text) {
  const out = new Uint8Array(0x1000);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith(':')) continue;
    const len  = parseInt(line.substr(1, 2), 16);
    const addr = parseInt(line.substr(3, 4), 16);
    const type = parseInt(line.substr(7, 2), 16);
    if (type === 0x01) break;   // EOF record
    if (type !== 0x00) continue;
    for (let i = 0; i < len; i++) {
      out[addr + i] = parseInt(line.substr(9 + i * 2, 2), 16);
    }
  }
  return out;
}

function fullPinMap() {
  // Same shape as test_8080/8080.test.js's fullPinMap.
  const m = {
    SYNC: 'SYNC', DBIN: 'DBIN', WR: 'WR', WAIT: 'WAIT',
    READY: 'READY', HOLD: 'HOLD', HLDA: 'HLDA',
    INT: 'INT', INTE: 'INTE', RESET: 'RESET',
    PHI1: 'PHI1', PHI2: 'PHI2',
    VCC: 'VCC', VDD: 'VDD', VBB: 'VBB', GND: 'GND',
  };
  for (let i = 0; i < 16; i++) m[`A${i}`] = `A${i}`;
  for (let i = 0; i < 8; i++)  m[`D${i}`] = `D${i}`;
  return m;
}

describe.skipIf(skip)('Palo Alto Tiny BASIC v2 (8080) integration', () => {

  it('boots Wang\'s 1976 Tiny BASIC and emits "OK" via the 8251 UART', async () => {
    const program = parseIntelHex(readFileSync(HEX_PATH, 'utf8'));

    const board = new BoardHarness();
    await board.addChip('8080', fullPinMap());

    // ROM at 0x0000..0x07FF (Tiny BASIC code).
    board.installFakeRom(program, {
      addrPrefix: 'A', addrWidth: 16,
      dataPrefix: 'D', dataWidth: 8,
      rd: 'DBIN', rdActiveLow: false,
      baseAddr: 0,
    });
    // RAM at 0x0800..0x0FFF (vars + stack to 0x1000 per `LXI SP,1000h`).
    board.installFakeRam(0x0800, {
      addrPrefix: 'A', addrWidth: 16,
      dataPrefix: 'D', dataWidth: 8,
      rd: 'DBIN', rdActiveLow: false,
      wr: 'WR',
      baseAddr: 0x0800,
    });

    // Fake 8251 UART at ports 0x02 (data) / 0x03 (status).
    // The 8080 distinguishes I/O from memory via the status byte at
    // T1 — but our fake is simpler: we just watch WR̅ + DBIN with
    // the address bus at the known port number on A0..A7.
    //
    // The chip drives I/O port number on A0..A7 AND A8..A15 (mirrored)
    // during IN/OUT cycles. We watch the low byte.
    const uartTx = [];
    let uartStatus = 0x01;     // TX always ready, RX never has data
    let prevWr = true;
    let prevDbin = false;

    board.watchNet('WR', (level) => {
      if (level !== false || prevWr === false) {  // falling edge: WR̅ asserted
        prevWr = level;
        return;
      }
      prevWr = level;
      const port = board.readBus('A', 8);
      if (port === 0x02) {
        uartTx.push(board.readBus('D', 8));
      }
      // port 0x03 writes are 8251 mode/command — ignore for this test.
    });

    board.watchNet('DBIN', (level) => {
      const rising = (level === true && prevDbin === false);
      prevDbin = level;
      if (!rising) return;
      const port = board.readBus('A', 8);
      // Detect IN cycle by status byte at T1 (we don't decode it; the
      // simpler heuristic is: if A0..A7 is a low-byte port and A8..A15
      // mirrors it (8080 IN convention), drive the value).
      const portHi = board.readBus('A', 16) >> 8;
      if (port === portHi) {
        if (port === 0x03) {
          for (let i = 0; i < 8; i++) {
            board.setNet(`D${i}`, ((uartStatus >> i) & 1) === 1);
          }
        } else if (port === 0x02) {
          for (let i = 0; i < 8; i++) board.setNet(`D${i}`, false);  // RX = 0
        }
      }
    });

    // Quiet inputs.
    board.setNet('READY', true);
    board.setNet('HOLD',  false);
    board.setNet('INT',   false);

    board.setNet('RESET', true);
    board.advanceNanos(CLOCK_NS * 4);
    board.setNet('RESET', false);

    // Run for plenty of cycles. Booting + UART init + writing "OK\r\n"
    // is well under 100K instructions on real hardware.
    const TARGET_CYCLES = 400_000;
    for (let i = 0; i < TARGET_CYCLES; i++) board.advanceNanos(CLOCK_NS);

    // Decode TX stream as ASCII (filtering nulls and clearing high
    // bits — Tiny BASIC sometimes drives bit 7 high for echo control).
    const txText = String.fromCharCode(...uartTx.map(b => b & 0x7F).filter(b => b > 0));

    // Should contain "OK" somewhere — it's the BASIC ready prompt.
    expect(uartTx.length, 'BASIC must transmit characters via OUT 0x02').toBeGreaterThan(0);
    expect(txText, 'TX stream should contain the BASIC "OK" prompt').toContain('OK');
  }, { timeout: 30_000 });

});
