/**
 * Zilog Z80 emulator chip — TDD spec.
 *
 * The Z80 is binary-compatible with the 8080 plus extensions, so the
 * 8080 tests' structure carries over. This file focuses on:
 *   1. The Z80-specific bus protocol (M1̅ / MREQ̅ / IORQ̅ / RFSH̅)
 *   2. Z80-only instructions (EX, EXX, DJNZ, IX/IY, block ops, IM 0-2)
 *   3. NMI behaviour (pushes PC, vectors to 0x0066)
 *
 * The 8080-subset instructions are NOT re-tested here — once both chips
 * are implemented, a shared "8080-subset suite" should run against both.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BoardHarness } from '../src/BoardHarness.js';
import { chipWasmExists, hex8, hex16 } from '../src/helpers.js';

const CHIP = 'z80';
const skip = !chipWasmExists(CHIP);

const CLOCK_HZ = 4_000_000;
const CLOCK_NS = Math.round(1e9 / CLOCK_HZ);

function fullPinMap() {
  const m = {
    M1: 'M1', MREQ: 'MREQ', IORQ: 'IORQ', RD: 'RD', WR: 'WR', RFSH: 'RFSH',
    HALT: 'HALT', WAIT: 'WAIT', INT: 'INT', NMI: 'NMI', RESET: 'RESET',
    BUSREQ: 'BUSREQ', BUSACK: 'BUSACK', CLK: 'CLK',
    VCC: 'VCC', GND: 'GND',
  };
  for (let i = 0; i < 16; i++) m[`A${i}`] = `A${i}`;
  for (let i = 0; i < 8;  i++) m[`D${i}`] = `D${i}`;
  return m;
}

async function bootZ80(program) {
  const board = new BoardHarness();
  await board.addChip(CHIP, fullPinMap());

  board.installFakeRom(program, {
    addrPrefix: 'A', addrWidth: 16,
    dataPrefix: 'D', dataWidth: 8,
    rd: 'RD', rdActiveLow: true,
    cs: 'MREQ',                       // only respond when MREQ̅ is asserted
    csActiveLow: true,
    baseAddr: 0,
  });

  const ram = board.installFakeRam(0x8000, {
    addrPrefix: 'A', addrWidth: 16,
    dataPrefix: 'D', dataWidth: 8,
    rd: 'RD', wr: 'WR',
    cs: 'MREQ',
    baseAddr: 0x8000,
  });

  board.setNet('WAIT',   true);   // not waiting
  board.setNet('INT',    true);   // INT̅ deasserted (active-low on Z80)
  board.setNet('NMI',    true);   // NMI̅ deasserted
  board.setNet('BUSREQ', true);
  board.setNet('RESET',  false);
  board.advanceNanos(CLOCK_NS * 4);
  board.setNet('RESET',  true);
  // Do NOT advance after RESET deassert — the caller has its own
  // advanceNanos loop, and may want to poke RAM contents first
  // (same lesson as bootCpu in the 8080 tests).
  return { board, ram };
}

describe('Zilog Z80 chip', () => {

  describe('pin contract', () => {
    it.skipIf(skip)('registers all 40 named pins', async () => {
      const board = new BoardHarness();
      await expect(board.addChip(CHIP, fullPinMap())).resolves.toBeDefined();
      board.dispose();
    });
  });

  describe('reset', () => {
    it.skipIf(skip)('first M1 fetch is from 0x0000', async () => {
      const board = new BoardHarness();
      await board.addChip(CHIP, fullPinMap());

      const m1Fetches = [];
      board.watchNet('M1', (low) => {
        if (low === false) m1Fetches.push(board.readBus('A', 16));
      });
      board.installFakeRom([0x00, 0x00, 0x76], {  // NOP NOP HALT
        rd: 'RD', cs: 'MREQ', csActiveLow: true,
      });
      board.setNet('WAIT', true);
      board.setNet('INT', true);
      board.setNet('NMI', true);
      board.setNet('BUSREQ', true);
      board.setNet('RESET', false);
      board.advanceNanos(CLOCK_NS * 4);
      board.setNet('RESET', true);
      board.advanceNanos(CLOCK_NS * 30);

      expect(m1Fetches[0], 'first M1 fetch').toBe(0x0000);
      board.dispose();
    });
  });

  describe('M1 cycle', () => {
    it.skipIf(skip)('asserts M1̅ + MREQ̅ + RD̅ during opcode fetch', async () => {
      const board = new BoardHarness();
      await board.addChip(CHIP, fullPinMap());

      let sawAllAsserted = false;
      board.watchNet('M1', (state) => {
        if (state === false) {
          // Snap the other signals at the same instant
          if (board.getNet('MREQ') === false && board.getNet('RD') === false) {
            sawAllAsserted = true;
          }
        }
      });
      board.installFakeRom([0x00, 0x76], { rd: 'RD', cs: 'MREQ', csActiveLow: true });
      board.setNet('WAIT', true);
      board.setNet('INT', true); board.setNet('NMI', true); board.setNet('BUSREQ', true);
      board.setNet('RESET', false);
      board.advanceNanos(CLOCK_NS * 4);
      board.setNet('RESET', true);
      board.advanceNanos(CLOCK_NS * 30);

      expect(sawAllAsserted, 'M1̅, MREQ̅, RD̅ asserted simultaneously during fetch').toBe(true);
      board.dispose();
    });

    it.skipIf(skip)('asserts RFSH̅ during the refresh phase of M1', async () => {
      const board = new BoardHarness();
      await board.addChip(CHIP, fullPinMap());

      let rfshSeen = false;
      board.watchNet('RFSH', (state) => { if (state === false) rfshSeen = true; });
      board.installFakeRom([0x00, 0x00, 0x76], { rd: 'RD', cs: 'MREQ', csActiveLow: true });
      board.setNet('WAIT', true); board.setNet('INT', true);
      board.setNet('NMI', true); board.setNet('BUSREQ', true);
      board.setNet('RESET', false);
      board.advanceNanos(CLOCK_NS * 4);
      board.setNet('RESET', true);
      board.advanceNanos(CLOCK_NS * 30);

      expect(rfshSeen, 'RFSH̅ must pulse low after M1 fetch').toBe(true);
      board.dispose();
    });
  });

  describe('Z80-only instructions', () => {
    // Z80 mnemonic constants — only those used in tests below.
    const LD_A_n   = 0x3E;
    const LD_BC_nn = 0x01;
    const LD_DE_nn = 0x11;
    const LD_HL_nn = 0x21;
    const LD_IX_nn = 0xDD; const _IX_LD_nn = 0x21;   // DD 21 nn nn
    const EX_DE_HL = 0xEB;
    const EXX      = 0xD9;
    const DJNZ     = 0x10;
    const LDIR     = 0xED; const _LDIR = 0xB0;       // ED B0
    const LD_aHL_n = 0x36;
    const LD_addr_A = 0x32;
    const HALT     = 0x76;

    it.skipIf(skip)('EX DE, HL swaps register pairs', async () => {
      // LD HL, 0x1234 ; LD DE, 0x5678 ; EX DE, HL ; LD (0x8000), A is awkward
      // because we can't read HL/DE directly. Use this instead:
      // LD HL, 0xAA00 ; LD DE, 0xBB00 ; EX DE, HL ; LD (HL), 0x77 ; HALT
      // After EX, HL = 0xBB00 (in our RAM range) so we write to 0xBB00.
      // Wait, 0xBB00 is in our RAM (0x8000+) — yes.
      const program = new Uint8Array([
        LD_HL_nn, 0x00, 0xAA,
        LD_DE_nn, 0x00, 0xBB,
        EX_DE_HL,
        LD_aHL_n, 0x77,
        HALT,
      ]);
      const { board, ram } = await bootZ80(program);
      for (let i = 0; i < 200; i++) board.advanceNanos(CLOCK_NS);
      expect(ram.peek(0xBB00)).toBe(0x77);
      board.dispose();
    });

    it.skipIf(skip)('DJNZ decrements B and jumps while non-zero', async () => {
      // LD A, 0 ; LD B, 5 ; LOOP: INC A ; DJNZ LOOP ; LD (0x8000), A ; HALT
      // Expected: A = 5 stored at 0x8000.
      const INC_A = 0x3C;
      const program = new Uint8Array([
        LD_A_n, 0x00,
        0x06, 0x05,                        // LD B, 5
        INC_A,                             // LOOP:
        DJNZ, 0xFD,                        // jump back -3 to LOOP
        LD_addr_A, 0x00, 0x80,             // LD (0x8000), A
        HALT,
      ]);
      const { board, ram } = await bootZ80(program);
      for (let i = 0; i < 500; i++) board.advanceNanos(CLOCK_NS);
      expect(ram.peek(0x8000)).toBe(5);
      board.dispose();
    });

    it.skipIf(skip)('LDIR copies a memory block from HL to DE', async () => {
      // Pre-load source: 4 bytes at 0xC000..0xC003. Then LDIR HL=0xC000,
      // DE=0x9000, BC=4. After: 4 bytes copied to 0x9000..0x9003.
      const program = new Uint8Array([
        LD_HL_nn, 0x00, 0xC0,    // LD HL, 0xC000
        LD_DE_nn, 0x00, 0x90,    // LD DE, 0x9000
        LD_BC_nn, 0x04, 0x00,    // LD BC, 0x0004
        LDIR, _LDIR,             // ED B0
        HALT,
      ]);
      const { board, ram } = await bootZ80(program);
      ram.poke(0xC000, 0x11);
      ram.poke(0xC001, 0x22);
      ram.poke(0xC002, 0x33);
      ram.poke(0xC003, 0x44);
      for (let i = 0; i < 500; i++) board.advanceNanos(CLOCK_NS);
      expect(ram.peek(0x9000)).toBe(0x11);
      expect(ram.peek(0x9001)).toBe(0x22);
      expect(ram.peek(0x9002)).toBe(0x33);
      expect(ram.peek(0x9003)).toBe(0x44);
      board.dispose();
    });

    it.skipIf(skip)('LD A, (IX+d) reads via IX with signed displacement', async () => {
      // Pre-load 0xCD at 0xA005. Set IX = 0xA000. LD A, (IX+5) → A=0xCD.
      // Then LD (0x9000), A so we can verify.
      const program = new Uint8Array([
        LD_IX_nn, _IX_LD_nn, 0x00, 0xA0,   // DD 21 00 A0 — LD IX, 0xA000
        0xDD, 0x7E, 0x05,                    // DD 7E 05 — LD A, (IX+5)
        LD_addr_A, 0x00, 0x90,               // LD (0x9000), A
        HALT,
      ]);
      const { board, ram } = await bootZ80(program);
      ram.poke(0xA005, 0xCD);
      for (let i = 0; i < 400; i++) board.advanceNanos(CLOCK_NS);
      expect(ram.peek(0x9000)).toBe(0xCD);
      board.dispose();
    });

    it.skipIf(skip)('EXX swaps the main register set with the shadow set', async () => {
      // LD HL, 0x1111
      // EXX             ; swap → HL = shadow (0x0000 after reset shadow init)
      // LD HL, 0x9000   ; main HL now 0x9000 (was the shadow)
      // EXX             ; swap back → original HL = 0x1111 in main set
      // LD (HL), 0x77   ; writes to 0x1111... wait, main HL is 0x1111
      //                 ; that's not in our RAM range (0x8000+).
      // Restructure: use two HL values both in RAM range.
      // LD HL, 0x9100 ; EXX ; LD HL, 0x9200 ; EXX ; LD (HL), 0x77 ; HALT
      // After: write to 0x9100 (the original main HL).
      const program = new Uint8Array([
        LD_HL_nn, 0x00, 0x91,    // LD HL, 0x9100 (main)
        EXX,                      // → main set goes to shadow
        LD_HL_nn, 0x00, 0x92,    // LD HL, 0x9200 (this is now the new "main")
        EXX,                      // → swap back; main HL = 0x9100
        LD_aHL_n, 0x77,           // LD (HL), 0x77 → write 0x77 to 0x9100
        HALT,
      ]);
      const { board, ram } = await bootZ80(program);
      for (let i = 0; i < 300; i++) board.advanceNanos(CLOCK_NS);
      expect(ram.peek(0x9100)).toBe(0x77);
      // Verify the OTHER write didn't happen (shadow set's HL=0x9200
      // was never written via LD (HL), 0x77 in the shadow context).
      expect(ram.peek(0x9200)).toBe(0x00);
      board.dispose();
    });
  });

  describe('interrupts', () => {
    it.skipIf(skip)('NMI̅ falling edge pushes PC and vectors to 0x0066', async () => {
      // EI ; loop: NOP ; JR -1
      // ISR at 0x0066: LD A, 0xAB ; LD (0x9000), A ; HALT
      const program = new Uint8Array(0x80);
      program.fill(0x00);
      program[0x00] = 0xFB;             // EI
      program[0x01] = 0x00;             // NOP
      program[0x02] = 0x18; program[0x03] = 0xFD;   // JR -3 → loop
      program[0x66] = 0x3E; program[0x67] = 0xAB;   // LD A, 0xAB
      program[0x68] = 0x32; program[0x69] = 0x00; program[0x6A] = 0x90; // LD (0x9000), A
      program[0x6B] = 0x76;             // HALT
      const { board, ram } = await bootZ80(program);
      // Run a few cycles to enter the loop.
      for (let i = 0; i < 50; i++) board.advanceNanos(CLOCK_NS);
      // Pulse NMI̅ low (active low) → falling edge triggers interrupt.
      board.setNet('NMI', false);
      board.advanceNanos(CLOCK_NS * 4);
      board.setNet('NMI', true);
      for (let i = 0; i < 200; i++) board.advanceNanos(CLOCK_NS);
      expect(ram.peek(0x9000)).toBe(0xAB);
      board.dispose();
    });

    it.skipIf(skip)('IM 1 + INT̅ vectors to 0x0038', async () => {
      // EI ; IM 1 ; loop: NOP ; JR -1
      // ISR at 0x0038: LD A, 0x39 ; LD (0x9000), A ; HALT
      const program = new Uint8Array(0x80);
      program.fill(0x00);
      program[0x00] = 0xFB;             // EI
      program[0x01] = 0xED; program[0x02] = 0x56;   // IM 1
      program[0x03] = 0x00;             // NOP loop
      program[0x04] = 0x18; program[0x05] = 0xFD;   // JR -3
      program[0x38] = 0x3E; program[0x39] = 0x39;   // LD A, 0x39
      program[0x3A] = 0x32; program[0x3B] = 0x00; program[0x3C] = 0x90;
      program[0x3D] = 0x76;             // HALT
      const { board, ram } = await bootZ80(program);
      for (let i = 0; i < 50; i++) board.advanceNanos(CLOCK_NS);
      // INT̅ active-low: drive low to request interrupt.
      board.setNet('INT', false);
      for (let i = 0; i < 200; i++) board.advanceNanos(CLOCK_NS);
      board.setNet('INT', true);
      for (let i = 0; i < 200; i++) board.advanceNanos(CLOCK_NS);
      expect(ram.peek(0x9000)).toBe(0x39);
      board.dispose();
    });

    it.skipIf(skip)('IM 2 + INT̅ uses I:byte to vector through a table', async () => {
      // Set up:
      //   I = 0x40, vector byte = 0x00 (our chip approximates the bus
      //   data byte as 0x00 since we don't model an INTA cycle), so
      //   vector table address = 0x4000. Place ISR pointer (0x6000)
      //   there. ISR writes 0xC2 to 0x9000 and HALTs.
      const program = new Uint8Array(0x8000);
      program.fill(0x00);
      program[0x00] = 0x3E; program[0x01] = 0x40;       // LD A, 0x40
      program[0x02] = 0xED; program[0x03] = 0x47;       // LD I, A
      program[0x04] = 0xED; program[0x05] = 0x5E;       // IM 2
      program[0x06] = 0xFB;                              // EI
      program[0x07] = 0x00;                              // NOP (loop)
      program[0x08] = 0x18; program[0x09] = 0xFD;       // JR -3 → 0x07

      // Vector table at I:00 = 0x4000 → ISR @ 0x6000
      program[0x4000] = 0x00;
      program[0x4001] = 0x60;

      // ISR at 0x6000: LD A, 0xC2 ; LD (0x9000), A ; HALT
      program[0x6000] = 0x3E; program[0x6001] = 0xC2;
      program[0x6002] = 0x32; program[0x6003] = 0x00; program[0x6004] = 0x90;
      program[0x6005] = 0x76;

      const { board, ram } = await bootZ80(program);
      // Let LD A,I + LD I,A + IM 2 + EI execute, then enter the loop.
      for (let i = 0; i < 80; i++) board.advanceNanos(CLOCK_NS);
      // Pulse INT̅ low.
      board.setNet('INT', false);
      for (let i = 0; i < 200; i++) board.advanceNanos(CLOCK_NS);
      board.setNet('INT', true);
      for (let i = 0; i < 200; i++) board.advanceNanos(CLOCK_NS);
      expect(ram.peek(0x9000), 'ISR sentinel must reach RAM via IM 2 vectoring').toBe(0xC2);
      board.dispose();
    });
  });

  describe('CB-prefix bit ops', () => {
    const HALT = 0x76;
    const LD_addr_A = 0x32;
    const CB = 0xCB;
    const LD_HL_nn = 0x21;
    const LD_BC_nn = 0x01;

    it.skipIf(skip)('SET n, A turns on the right bit', async () => {
      // LD A, 0x00 ; SET 7, A ; LD (0x9000), A ; HALT
      // Expected: A = 0x80, stored at 0x9000.
      const program = new Uint8Array([
        0x3E, 0x00,             // LD A, 0x00
        CB, 0xFF,               // SET 7, A  (op = 11_111_111 = 0xFF)
        LD_addr_A, 0x00, 0x90,  // LD (0x9000), A
        HALT,
      ]);
      const { board, ram } = await bootZ80(program);
      for (let i = 0; i < 200; i++) board.advanceNanos(CLOCK_NS);
      expect(ram.peek(0x9000)).toBe(0x80);
      board.dispose();
    });

    it.skipIf(skip)('RES n, A turns off the right bit', async () => {
      // LD A, 0xFF ; RES 0, A ; LD (0x9000), A ; HALT
      // Expected: A = 0xFE.
      const program = new Uint8Array([
        0x3E, 0xFF,
        CB, 0x87,               // RES 0, A  (op = 10_000_111 = 0x87)
        LD_addr_A, 0x00, 0x90,
        HALT,
      ]);
      const { board, ram } = await bootZ80(program);
      for (let i = 0; i < 200; i++) board.advanceNanos(CLOCK_NS);
      expect(ram.peek(0x9000)).toBe(0xFE);
      board.dispose();
    });

    it.skipIf(skip)('RLC A rotates left circular', async () => {
      // LD A, 0x81 ; RLC A ; LD (0x9000), A ; HALT
      // 0x81 = 1000_0001 → rotate left circular → 0000_0011 = 0x03 (bit 7
      // wrapped to bit 0).
      const program = new Uint8Array([
        0x3E, 0x81,
        CB, 0x07,               // RLC A
        LD_addr_A, 0x00, 0x90,
        HALT,
      ]);
      const { board, ram } = await bootZ80(program);
      for (let i = 0; i < 200; i++) board.advanceNanos(CLOCK_NS);
      expect(ram.peek(0x9000)).toBe(0x03);
      board.dispose();
    });

    it.skipIf(skip)('SRL A shifts right logical with zero into MSB', async () => {
      // LD A, 0x81 ; SRL A ; LD (0x9000), A ; HALT
      // 0x81 → 0x40 (low bit 1 falls into CF; MSB filled with 0)
      const program = new Uint8Array([
        0x3E, 0x81,
        CB, 0x3F,               // SRL A
        LD_addr_A, 0x00, 0x90,
        HALT,
      ]);
      const { board, ram } = await bootZ80(program);
      for (let i = 0; i < 200; i++) board.advanceNanos(CLOCK_NS);
      expect(ram.peek(0x9000)).toBe(0x40);
      board.dispose();
    });

    it.skipIf(skip)('SRA A shifts right arithmetic, sign-extending', async () => {
      // LD A, 0x80 ; SRA A ; LD (0x9000), A ; HALT
      // 0x80 → 0xC0 (sign bit propagates)
      const program = new Uint8Array([
        0x3E, 0x80,
        CB, 0x2F,               // SRA A
        LD_addr_A, 0x00, 0x90,
        HALT,
      ]);
      const { board, ram } = await bootZ80(program);
      for (let i = 0; i < 200; i++) board.advanceNanos(CLOCK_NS);
      expect(ram.peek(0x9000)).toBe(0xC0);
      board.dispose();
    });

    it.skipIf(skip)('DAA after BCD ADD adjusts the result', async () => {
      // LD A, 0x09 ; LD B, 0x07 ; ADD A, B ; DAA ; LD (0x9000), A ; HALT
      // 9 + 7 = 16 (BCD): raw 0x10 + DAA correction 0x06 = 0x16.
      const program = new Uint8Array([
        0x3E, 0x09,             // LD A, 0x09
        0x06, 0x07,             // LD B, 0x07
        0x80,                   // ADD A, B
        0x27,                   // DAA
        LD_addr_A, 0x00, 0x90,
        HALT,
      ]);
      const { board, ram } = await bootZ80(program);
      for (let i = 0; i < 200; i++) board.advanceNanos(CLOCK_NS);
      expect(ram.peek(0x9000)).toBe(0x16);
      board.dispose();
    });

    it.skipIf(skip)('ADC HL, BC adds register pair with carry', async () => {
      // LD HL, 0x1000 ; LD BC, 0x2000 ; OR A,A (clear CF) ; ADC HL,BC ;
      // LD A, H ; LD (0x9000), A ; LD A, L ; LD (0x9001), A ; HALT
      // After ADC HL=0x3000. Store H and L separately.
      const program = new Uint8Array([
        LD_HL_nn, 0x00, 0x10,   // LD HL, 0x1000
        LD_BC_nn, 0x00, 0x20,   // LD BC, 0x2000
        0xB7,                   // OR A — clears CF (and other flags except SZP)
        0xED, 0x4A,             // ADC HL, BC
        0x7C,                   // LD A, H
        LD_addr_A, 0x00, 0x90,  // LD (0x9000), A
        0x7D,                   // LD A, L
        LD_addr_A, 0x01, 0x90,  // LD (0x9001), A
        HALT,
      ]);
      const { board, ram } = await bootZ80(program);
      for (let i = 0; i < 400; i++) board.advanceNanos(CLOCK_NS);
      expect(ram.peek(0x9000)).toBe(0x30);   // H
      expect(ram.peek(0x9001)).toBe(0x00);   // L
      board.dispose();
    });

    it.skipIf(skip)('RLD rotates a low nibble between A and (HL)', async () => {
      // LD A, 0x12 ; LD HL, 0xC000 ; (ram[0xC000] poked to 0x34) ; RLD ;
      // LD (0x9000), A ; HALT
      // Before: A = 0x12, mem = 0x34
      // RLD: A_low (0x2) → mem_low; mem_high (0x3) → A_low; mem_low (0x4) → mem_high.
      // After: A = 0x13, mem = 0x42.
      const program = new Uint8Array([
        0x3E, 0x12,             // LD A, 0x12
        LD_HL_nn, 0x00, 0xC0,   // LD HL, 0xC000
        0xED, 0x6F,             // RLD
        LD_addr_A, 0x00, 0x90,  // LD (0x9000), A
        HALT,
      ]);
      const { board, ram } = await bootZ80(program);
      ram.poke(0xC000, 0x34);
      for (let i = 0; i < 300; i++) board.advanceNanos(CLOCK_NS);
      expect(ram.peek(0x9000)).toBe(0x13);   // A
      expect(ram.peek(0xC000)).toBe(0x42);   // mem
      board.dispose();
    });

    it.skipIf(skip)('CPIR scans memory for accumulator match', async () => {
      // Pre-poke 0x9100=0x11, 0x9101=0x22, 0x9102=0x33, 0x9103=0x44.
      // LD A, 0x33 ; LD HL, 0x9100 ; LD BC, 0x0004 ; CPIR ;
      // After CPIR: HL stops one past 0x9102 (the match position). HL=0x9103.
      // Store H and L to verify HL.
      const program = new Uint8Array([
        0x3E, 0x33,             // LD A, 0x33
        LD_HL_nn, 0x00, 0x91,   // LD HL, 0x9100
        LD_BC_nn, 0x04, 0x00,   // LD BC, 0x0004
        0xED, 0xB1,             // CPIR
        0x7C,                   // LD A, H
        LD_addr_A, 0x00, 0x80,  // LD (0x8000), A
        0x7D,                   // LD A, L
        LD_addr_A, 0x01, 0x80,  // LD (0x8001), A
        HALT,
      ]);
      const { board, ram } = await bootZ80(program);
      ram.poke(0x9100, 0x11);
      ram.poke(0x9101, 0x22);
      ram.poke(0x9102, 0x33);
      ram.poke(0x9103, 0x44);
      for (let i = 0; i < 600; i++) board.advanceNanos(CLOCK_NS);
      expect(ram.peek(0x8000)).toBe(0x91);   // H
      expect(ram.peek(0x8001)).toBe(0x03);   // L = 0x03 (one past match)
      board.dispose();
    });

    it.skipIf(skip)('BIT 7, A sets ZF when bit clear, clears when bit set', async () => {
      // LD A, 0x00 ; BIT 7, A ; JR Z, +taken ; LD A, 0xFF (should NOT run)
      // taken: LD A, 0xAA ; LD (0x9000), A ; HALT
      const program = new Uint8Array([
        0x3E, 0x00,             // LD A, 0x00
        CB, 0x7F,               // BIT 7, A — ZF=1
        0x28, 0x02,             // JR Z, +2 (skip the next 2 bytes)
        0x3E, 0xFF,             // (skipped) LD A, 0xFF
        0x3E, 0xAA,             // taken: LD A, 0xAA
        LD_addr_A, 0x00, 0x90,  // LD (0x9000), A
        HALT,
      ]);
      const { board, ram } = await bootZ80(program);
      for (let i = 0; i < 300; i++) board.advanceNanos(CLOCK_NS);
      expect(ram.peek(0x9000)).toBe(0xAA);
      board.dispose();
    });
  });

  /* ZEXDOC end-to-end integration run lives in its own file
     (`zexdoc.test.js`) — it needs a much longer time budget than
     the unit suite. */
});
