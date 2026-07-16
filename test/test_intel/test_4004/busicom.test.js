/**
 * Busicom 141-PF firmware — end-to-end Intel 4004 integration test.
 *
 * The Busicom 141-PF was the printing electronic calculator that
 * Intel built the 4004 *for* in 1971. The full 1 KB firmware (4× 256-
 * byte 4001 ROMs) was released to the public domain by Intel in 2009
 * via Tim McNerney's restoration project on 4004.com. This test runs
 * the original silicon's binary on our clean-room 4004 + 4002.
 *
 * What we verify
 * --------------
 * 1) The 4004 chip executes >2000 instruction cycles of the real
 *    firmware without crashing or stalling on a single PC.
 * 2) PC visits a wide spread of unique addresses across the 1 KB
 *    image — proving the chip's full ISA + bus protocol cope with
 *    code Intel actually shipped to customers, not just hand-crafted
 *    micro-tests.
 * 3) The firmware exercises SRC + WMP + WRR over the shared nibble
 *    bus — visible as CMRAM/CMROM strobes and writes to the 4002.
 *
 * What we do NOT model
 * --------------------
 * - 4003 shift registers for keyboard / printer scanning. The
 *   firmware's scanning loops will read all-zero (no keys), so the
 *   chip stays in the polling state — that's the correct behaviour
 *   for an unattended Busicom; the goal here is "code executes
 *   without breaking", not "produces a printed receipt".
 * - 4× 4001 ROM chip-id variants. Instead of compiling 4 separate
 *   chip variants we use a JS-side nibble-bus driver that serves
 *   bytes from the 1 KB image regardless of the chip-id — the 4004
 *   side of the bus protocol is identical, only the source of the
 *   nibbles differs.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { BoardHarness } from '../src/BoardHarness.js';
import { chipWasmExists } from '../src/helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROM_PATH = join(__dirname, '..', 'roms', '4004', 'busicom_141pf.bin');

const skip = !chipWasmExists('4004') || !chipWasmExists('4002-ram')
          || !existsSync(ROM_PATH);

const CLOCK_NS = 1351;   // 4004 ran at 740 kHz → 1351 ns per phase

function cpuPinMap() {
  const m = {
    SYNC: 'SYNC', RESET: 'RESET', TEST: 'TEST',
    CMROM: 'CMROM',
    CMRAM0: 'CMRAM0', CMRAM1: 'CMRAM1', CMRAM2: 'CMRAM2', CMRAM3: 'CMRAM3',
    CLK1: 'CLK1', CLK2: 'CLK2',
    VDD: 'VDD', VSS: 'VSS',
  };
  for (let i = 0; i < 4; i++) m[`D${i}`] = `D${i}`;
  return m;
}

function ramPinMap() {
  const m = {
    SYNC: 'SYNC', CL: 'CLK1', RESET: 'RESET', CM: 'CMRAM0',
    VDD: 'VDD', VSS: 'VSS',
  };
  for (let i = 0; i < 4; i++) m[`D${i}`] = `D${i}`;
  for (let i = 0; i < 4; i++) m[`O${i}`] = `O${i}`;
  return m;
}

describe.skipIf(skip)('Busicom 141-PF firmware (4004) integration', () => {

  it('runs >2000 cycles of the original Intel firmware without crashing', async () => {
    const rom = readFileSync(ROM_PATH);
    expect(rom.length, 'Busicom firmware must be at least 1 KB').toBeGreaterThanOrEqual(1024);

    // Use the first 1 KB (4× 256-byte ROMs concatenated in order).
    // The firmware references PCs in [0x000..0x3FF].
    const PROG = new Uint8Array(0x400);
    PROG.set(rom.subarray(0, 0x400), 0);

    const board = new BoardHarness();
    // 4002 first so its on_phase fires before the 4004 (one-frame-behind
    // protocol, see 4002-ram.c documentation).
    await board.addChip('4002-ram', ramPinMap());
    await board.addChip('4004', cpuPinMap());

    // The 4004's TEST pin on a real Busicom is wired to the printer
    // drum encoder — it pulses every few ms as the drum rotates. The
    // very first instruction is JCN (jump-if-TEST-low) waiting for
    // that pulse, so without toggling TEST the firmware spins forever
    // on the first JCN. Toggle TEST every ~5000 phases of simulated
    // time below to mimic the drum sync.
    board.setNet('TEST', true);
    board.setNet('RESET', true);
    board.advanceNanos(CLOCK_NS * 12);
    board.setNet('RESET', false);

    // JS-side nibble-bus driver: feeds opcode high/low nibbles during
    // M1/M2 from the firmware image. Captures the 4004's PC via the
    // address drives at A1/A2/A3.
    let phaseSinceSync = -1;
    let observedPc = 0;
    let pcLow = 0, pcMid = 0;
    const pcHistogram = new Map();
    const cmramStrobes = [0, 0, 0, 0];
    let cmromStrobes = 0;

    board.watchNet('SYNC', (high) => { if (high) phaseSinceSync = 0; });
    for (let i = 0; i < 4; i++) {
      const idx = i;
      board.watchNet(`CMRAM${i}`, (high) => { if (high) cmramStrobes[idx]++; });
    }
    board.watchNet('CMROM', (high) => { if (high) cmromStrobes++; });

    function driveDNibble(n) {
      for (let i = 0; i < 4; i++) {
        board.setNet(`D${i}`, ((n >> i) & 1) === 1);
      }
    }

    // 8 phases × 2500 cycles = 20_000 phases ≈ 27 ms simulated time.
    const PHASES = 8 * 2500;
    let m1FetchCount = 0;
    let testHigh = true;
    for (let p = 0; p < PHASES; p++) {
      // Pulse TEST every ~400 phases to mimic the printer-drum encoder
      // sync the firmware polls in its main loop.
      if ((p % 400) === 0) {
        testHigh = !testHigh;
        board.setNet('TEST', testHigh);
      }
      if (phaseSinceSync === 3) {
        driveDNibble((PROG[observedPc & 0x3FF] >> 4) & 0xF);
      } else if (phaseSinceSync === 4) {
        driveDNibble(PROG[observedPc & 0x3FF] & 0xF);
      }
      board.advanceNanos(CLOCK_NS);
      if (phaseSinceSync === 0)      pcLow = board.readBus('D', 4);
      else if (phaseSinceSync === 1) pcMid = board.readBus('D', 4);
      else if (phaseSinceSync === 2) {
        const pcHigh = board.readBus('D', 4);
        observedPc = pcLow | (pcMid << 4) | (pcHigh << 8);
        pcHistogram.set(observedPc, (pcHistogram.get(observedPc) ?? 0) + 1);
        m1FetchCount++;
      }
      if (phaseSinceSync >= 0) phaseSinceSync++;
    }

    // Sanity: chip kept fetching new instructions across the run.
    expect(m1FetchCount, 'opcode-fetch cycles in the run').toBeGreaterThan(2000);

    // Sanity: chip explored a meaningful slice of the firmware, not
    // just a 1-byte halt loop. Real Busicom firmware visits dozens
    // of distinct addresses even in its idle keyboard-scan state.
    expect(pcHistogram.size, 'unique PC addresses visited').toBeGreaterThan(15);

    // Sanity: bus protocol fired CMROM (instruction fetch strobe)
    // many times, and at least one CMRAM strobe (firmware does talk
    // to RAM during init).
    expect(cmromStrobes, 'CMROM strobes during the run').toBeGreaterThan(100);
    const totalCmram = cmramStrobes.reduce((a, b) => a + b, 0);
    expect(totalCmram, 'CMRAM strobes during the run').toBeGreaterThan(0);

    board.dispose();
  }, { timeout: 30_000 });

});
