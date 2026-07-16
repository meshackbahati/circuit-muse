/**
 * Galaksija — end-to-end Z80 ROM integration test.
 *
 * Galaksija is a 1983 Yugoslav DIY home computer designed by Voja
 * Antonić. The complete schematics + ROM source were published in
 * the magazine "Galaksija" #6 and explicitly placed in the public
 * domain by the author.
 *
 *   ROMs:
 *     ROM A (4 KB) at 0x0000..0x0FFF — Z80 monitor + integer BASIC.
 *     ROM B (4 KB) at 0x1000..0x1FFF — floating-point + extra BASIC.
 *
 *   RAM (this ROM A "init ver 29"):
 *     0x2000..0x27FF — main RAM (system stack grows down from 0x2800).
 *     0x2800..0x3FFF — video + user RAM. The "READY" banner string
 *                       appears at 0x2802 after init completes.
 *
 *   Boot path (from ROM A, verified by disassembly):
 *     0x0000: DI            ; disable interrupts
 *     0x0001: SUB A         ; A=0, all flags set
 *     0x0002: JP 0x03DA     ; main init
 *
 * What we verify
 * --------------
 * 1) The chip executes the boot sequence without locking up — PC
 *    visits the JP target 0x03DA within the first few hundred
 *    machine cycles, and continues past it.
 * 2) After running for a few hundred thousand cycles, the ASCII
 *    string "READY" appears in RAM. That's the Galaksija monitor's
 *    "ready for input" prompt — a real, recognisable boot artifact
 *    that proves: the Z80 chip's full ISA is correct enough to run
 *    a ~500-instruction-long initialisation sequence end-to-end,
 *    its bus protocol drives MREQ̅+RD̅ correctly across 4 KB of ROM,
 *    and writes via WR̅ correctly land in fake RAM.
 *
 * We don't simulate the keyboard — Galaksija scans rows by issuing
 * `IN A,(0xnn)` and decoding the address bus, which is irrelevant to
 * proving boot. The CPU sees no keys pressed and stays in the input
 * polling loop after init, which is exactly the right behaviour to
 * observe.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { BoardHarness } from '../src/BoardHarness.js';
import { chipWasmExists } from '../src/helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROM_PATH = join(__dirname, '..', 'roms', 'z80', 'galaksija_rom_a.bin');
const ROM_B_PATH = join(__dirname, '..', 'roms', 'z80', 'galaksija_rom_b.bin');

const skip = !chipWasmExists('z80') || !existsSync(ROM_PATH);

const CLOCK_NS = 250;   // 4 MHz Z80 (Galaksija ran at 3.072 MHz, close enough)

function fullPinMap() {
  const m = {
    M1: 'M1', MREQ: 'MREQ', IORQ: 'IORQ', RD: 'RD', WR: 'WR',
    RFSH: 'RFSH', HALT: 'HALT', WAIT: 'WAIT',
    INT: 'INT', NMI: 'NMI', RESET: 'RESET', BUSREQ: 'BUSREQ',
    BUSACK: 'BUSACK', CLK: 'CLK', VCC: 'VCC', GND: 'GND',
  };
  for (let i = 0; i < 16; i++) m[`A${i}`] = `A${i}`;
  for (let i = 0; i < 8; i++)  m[`D${i}`] = `D${i}`;
  return m;
}

describe.skipIf(skip)('Galaksija ROM (Z80) integration', () => {

  it('Z80 boots Galaksija ROM A and initialises video framebuffer', async () => {
    const romA = readFileSync(ROM_PATH);
    expect(romA.length, 'ROM A must be exactly 4 KB').toBe(4096);

    // Concatenate ROM A + ROM B → 8 KB image at 0x0000..0x1FFF.
    let romImage = new Uint8Array(8192);
    romImage.set(romA, 0);
    if (existsSync(ROM_B_PATH)) {
      const romB = readFileSync(ROM_B_PATH);
      romImage.set(romB, 0x1000);
    }

    const board = new BoardHarness();
    await board.addChip('z80', fullPinMap());

    // ROM at 0x0000..0x1FFF (read-only, MREQ̅+RD̅).
    board.installFakeRom(romImage, {
      rd: 'RD', rdActiveLow: true,
      cs: 'MREQ', csActiveLow: true,
      baseAddr: 0,
    });

    // System RAM at 0x2000..0x3FFF (writable).
    const ram = board.installFakeRam(0x2000, {
      rd: 'RD', wr: 'WR',
      cs: 'MREQ', csActiveLow: true,
      baseAddr: 0x2000,
    });

    // The 0x4000..0xFFFF region isn't mapped on a real Galaksija;
    // any access there returns floating bus. We don't model that —
    // the Z80 should never go there if the ROM is correct.

    // Watch M1 fetches so we can prove PC advances and visits the
    // JP target 0x03DA from the reset vector.
    const m1Addrs = [];
    let visited3DA = false;
    let lastPc = -1;
    let stuckCount = 0;
    let everMoved = false;
    board.watchNet('M1', (low) => {
      if (low === false) {
        const pc = board.readBus('A', 16);
        m1Addrs.push(pc);
        if (pc === 0x03DA) visited3DA = true;
        if (pc !== lastPc) { everMoved = true; stuckCount = 0; }
        else stuckCount++;
        lastPc = pc;
      }
    });

    // Quiet inputs.
    board.setNet('WAIT',   true);
    board.setNet('INT',    true);
    board.setNet('NMI',    true);
    board.setNet('BUSREQ', true);
    board.setNet('RESET',  false);
    board.advanceNanos(CLOCK_NS * 4);
    board.setNet('RESET',  true);

    // Run a few hundred thousand cycles. ROM A's init routine clears
    // the screen + draws the welcome banner; that's well under 100K
    // cycles even on real hardware (~3 MHz).
    const TARGET_CYCLES = 500_000;
    for (let i = 0; i < TARGET_CYCLES; i++) board.advanceNanos(CLOCK_NS);

    expect(everMoved, 'PC must advance past 0x0000 (chip not stuck at reset)').toBe(true);
    expect(visited3DA, 'PC must reach 0x03DA (the JP target from reset)').toBe(true);
    expect(m1Addrs.length, 'M1 fetches counted during the run').toBeGreaterThan(1000);

    // Search RAM for the ASCII string "READY". The Galaksija monitor
    // writes this prompt during init.
    const READY = [0x52, 0x45, 0x41, 0x44, 0x59];   // 'R','E','A','D','Y'
    let readyAt = -1;
    for (let addr = 0x2000; addr < 0x3FFB && readyAt === -1; addr++) {
      let match = true;
      for (let i = 0; i < 5; i++) {
        if (ram.peek(addr + i) !== READY[i]) { match = false; break; }
      }
      if (match) readyAt = addr;
    }
    expect(readyAt, 'ASCII "READY" prompt must appear in RAM after init')
      .toBeGreaterThanOrEqual(0);

    board.dispose();
  }, { timeout: 30_000 });

});
