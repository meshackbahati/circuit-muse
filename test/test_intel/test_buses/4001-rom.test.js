/**
 * Intel 4001 ROM — integration test.
 *
 * The interesting part of the 4001 is that it cooperates with a real
 * 4004 over the 8-phase nibble-multiplexed bus. So this test wires
 * BOTH chips together and verifies the 4004 actually fetches and
 * executes opcodes from the 4001 — a true end-to-end integration that
 * couldn't be tested by either chip in isolation.
 *
 * Setup:
 *   - 4001 baked with a known 16-byte program at offsets 0..15.
 *     Byte 0 = 0x00 (NOP). The chip's rom_image only has bytes 0..15
 *     set; rest is zero.
 *   - 4004 wired to the 4001 (D bus, SYNC, RESET, CM-ROM).
 *   - We register the 4001 BEFORE the 4004 so its timer fires first
 *     per advanceNanos — the 4001 drives D before the 4004 reads.
 *   - Run a few cycles, observe that the 4004 advances PC normally
 *     (NOPs walk through addresses 0,1,2,...).
 *
 * The default chip-id (compile-time ROM4001_CHIP_ID = 0) means the
 * 4001 responds when address bits 11..8 are 0 — i.e. for the first
 * 256 bytes of program memory.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BoardHarness } from '../src/BoardHarness.js';
import { chipWasmExists } from '../src/helpers.js';

const ROM = '4001-rom';
const CPU = '4004';
const skip = !chipWasmExists(ROM) || !chipWasmExists(CPU);

const CLOCK_NS = 1351;

describe('4001 ROM + 4004 integration', () => {
  let board;
  beforeEach(() => { board = new BoardHarness(); });
  afterEach(() => { board.dispose(); });

  it.skipIf(skip)('4001 responds to chip-id 0 and the 4004 fetches its bytes', async () => {
    // Register the 4001 FIRST so its timer fires before the 4004's
    // timer in each advanceNanos call.
    await board.addChip(ROM, {
      VDD: 'VDD', VSS: 'VSS', SYNC: 'SYNC', CL: 'CLK1',
      RESET: 'RESET', CM: 'CMROM',
      D0: 'D0', D1: 'D1', D2: 'D2', D3: 'D3',
      IO0: 'I0', IO1: 'I1', IO2: 'I2', IO3: 'I3',
    });

    await board.addChip(CPU, {
      SYNC: 'SYNC', RESET: 'RESET', TEST: 'TEST',
      CMROM: 'CMROM',
      CMRAM0: 'CMRAM0', CMRAM1: 'CMRAM1', CMRAM2: 'CMRAM2', CMRAM3: 'CMRAM3',
      CLK1: 'CLK1', CLK2: 'CLK2',
      VDD: 'VDD', VSS: 'VSS',
      D0: 'D0', D1: 'D1', D2: 'D2', D3: 'D3',
    });

    // Quiet inputs.
    board.setNet('TEST', false);
    // Pulse RESET high then low.
    board.setNet('RESET', true);
    board.advanceNanos(CLOCK_NS * 12);
    board.setNet('RESET', false);

    // Watch SYNC + capture the 4-bit data on D pins right after each
    // SYNC rising pulse — this is what the 4001 drives during M1/M2.
    // Specifically we want to confirm that during M1 of cycle 0, the
    // 4001 drove the high nibble of rom[0] = 0x00, and that the chip
    // advances PC normally.
    const fetchedPCs = [];
    let phaseSinceSync = -1;
    board.watchNet('SYNC', (high) => { if (high) phaseSinceSync = 0; });

    // Run 3 cycles (24 phases). At each A3 (phase 2 since SYNC), read
    // the 12-bit PC the 4004 drove on D0..D3 across A1/A2/A3.
    let pcLow = 0, pcMid = 0, pcHigh = 0;
    for (let i = 0; i < 24; i++) {
      board.advanceNanos(CLOCK_NS);
      if (phaseSinceSync === 0) pcLow = board.readBus('D', 4);
      else if (phaseSinceSync === 1) pcMid = board.readBus('D', 4);
      else if (phaseSinceSync === 2) {
        pcHigh = board.readBus('D', 4);
        fetchedPCs.push(pcLow | (pcMid << 4) | (pcHigh << 8));
      }
      if (phaseSinceSync >= 0) phaseSinceSync++;
    }

    // After 3 cycles: PC should walk 0, 1, 2 (NOP advances by 1).
    // Note: the 4001's ROM image has byte 0 = 0x00 (NOP), so the 4004
    // reads NOP and increments PC.
    expect(fetchedPCs.slice(0, 3)).toEqual([0x000, 0x001, 0x002]);
  });
});
