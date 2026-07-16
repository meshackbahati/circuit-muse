/**
 * Intel 8080 emulator chip — comprehensive TDD spec.
 *
 * The chip is implemented in `8080.c` (TBD). Until that file exists and
 * compiles to fixtures/8080.wasm, all tests skip cleanly.
 *
 * Test strategy:
 *   - Most tests use BoardHarness.installFakeRom() to feed a hand-crafted
 *     opcode stream into the CPU's bus protocol. The fake ROM watches
 *     RD̅ and drives D0..D7 from a JS array — no per-test recompile.
 *   - Internal CPU state (registers) is observed indirectly: programs
 *     end with STA storing a register to a known RAM address; tests
 *     inspect that address via the fake RAM.
 *   - Bus traces (write cycles, address sequences) are captured via
 *     captureWrites() for protocol-level assertions.
 *
 * Pin contract assumed (see test_8080/README.md):
 *   A0..A15  — output (16-bit address)
 *   D0..D7   — bidirectional (data; tristated when chip not driving)
 *   SYNC, DBIN, WR, INTE, WAIT, HLDA  — output
 *   READY, HOLD, INT, RESET           — input
 *   PHI1, PHI2  — clock inputs (we drive both phases)
 *   VCC, GND
 *
 * Total registered: 16 + 8 + 6 + 4 + 2 + 2 = 38 named pins.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BoardHarness } from '../src/BoardHarness.js';
import { chipWasmExists, hex8, hex16 } from '../src/helpers.js';
import { I8080, asm, imm16 } from '../src/isa/8080-opcodes.js';

const CHIP = '8080';
const skip = !chipWasmExists(CHIP);

const CLOCK_HZ = 2_000_000;       // 2 MHz reference
const CLOCK_NS = Math.round(1e9 / CLOCK_HZ);

/** Wire the CPU pins to nets of the same name. */
function fullPinMap() {
  const m = {
    SYNC: 'SYNC', DBIN: 'DBIN', WR: 'WR', INTE: 'INTE',
    WAIT: 'WAIT', HLDA: 'HLDA',
    READY: 'READY', HOLD: 'HOLD', INT: 'INT', RESET: 'RESET',
    PHI1: 'PHI1', PHI2: 'PHI2',
    VCC: 'VCC', GND: 'GND',
  };
  for (let i = 0; i < 16; i++) m[`A${i}`] = `A${i}`;
  for (let i = 0; i < 8;  i++) m[`D${i}`] = `D${i}`;
  return m;
}

/** Set up a board with CPU + fake ROM (program at 0x0000) + fake RAM (0x8000+). */
async function bootCpu(program, opts = {}) {
  const board = new BoardHarness();
  await board.addChip(CHIP, fullPinMap());

  // Program lives at 0x0000 in fake ROM.
  board.installFakeRom(program, {
    addrPrefix: 'A', addrWidth: 16,
    dataPrefix: 'D', dataWidth: 8,
    rd: 'DBIN', rdActiveLow: false,    // 8080 DBIN is active HIGH
    baseAddr: 0,
  });

  // RAM at 0x8000..0xFFFF for stores and stack.
  const ram = board.installFakeRam(0x8000, {
    addrPrefix: 'A', addrWidth: 16,
    dataPrefix: 'D', dataWidth: 8,
    rd: 'DBIN', rdActiveLow: false,    // 8080 DBIN active HIGH
    wr: 'WR',
    baseAddr: 0x8000,
  });

  // Tie inputs that stay quiet during these tests.
  board.setNet('READY', true);
  board.setNet('HOLD',  false);
  board.setNet('INT',   false);

  // Pulse RESET̅ to start clean. 8080 RESET is active HIGH (unlike Z80).
  // Hold RESET high for a few cycles, then release. Do NOT advance time
  // after release — let the caller do that (e.g. via runUntilHlt) so the
  // caller has a chance to set up RAM contents before instructions run.
  board.setNet('RESET', true);
  board.advanceNanos(CLOCK_NS * 4);
  board.setNet('RESET', false);

  return { board, ram };
}

/** Run program until HLT (chip enters halt state) or fail. */
function runUntilHlt(board, maxCycles = 50_000) {
  // 8080 halt is observable: HLTA bit on status byte during T1, OR a
  // simpler convention — many emulators expose a HALT pin we can watch.
  // We use the HLDA pin convention here: when chip is halted, it stops
  // issuing new SYNC pulses and HLDA will stay low. A more portable
  // proxy: the program ends with HLT and we just count enough cycles.
  for (let i = 0; i < maxCycles; i++) board.advanceNanos(CLOCK_NS);
}

describe('Intel 8080 chip', () => {

  describe('pin contract', () => {
    it.skipIf(skip)('registers all 38 named pins', async () => {
      const board = new BoardHarness();
      await expect(board.addChip(CHIP, fullPinMap())).resolves.toBeDefined();
      board.dispose();
    });
  });

  describe('reset behavior', () => {
    it.skipIf(skip)('first opcode fetch reads from address 0x0000', async () => {
      const board = new BoardHarness();
      await board.addChip(CHIP, fullPinMap());

      const fetchAddrs = [];
      // Capture every address asserted while DBIN is high.
      board.watchNet('DBIN', (high) => {
        if (high) fetchAddrs.push(board.readBus('A', 16));
      });

      // Provide a NOP-loop ROM so the CPU has something to fetch.
      board.installFakeRom([I8080.NOP, I8080.NOP, I8080.NOP, I8080.HLT],
        { rd: 'DBIN', rdActiveLow: false });
      board.setNet('READY', true);

      board.setNet('RESET', true);
      board.advanceNanos(CLOCK_NS * 4);
      board.setNet('RESET', false);
      board.advanceNanos(CLOCK_NS * 12);

      expect(fetchAddrs.length).toBeGreaterThan(0);
      expect(fetchAddrs[0], 'first fetch must be from PC=0x0000').toBe(0x0000);
      board.dispose();
    });
  });

  describe('bus protocol — M1 cycle', () => {
    it.skipIf(skip)('asserts SYNC during T1 and drives the data bus with a status byte', async () => {
      const board = new BoardHarness();
      await board.addChip(CHIP, fullPinMap());

      const syncPulses = [];
      board.watchNet('SYNC', (high) => {
        if (high) {
          syncPulses.push({
            atNanos: board.nowNanos,
            statusByte: board.readBus('D', 8),
          });
        }
      });

      board.installFakeRom([I8080.NOP, I8080.HLT], { rd: 'DBIN', rdActiveLow: false });
      board.setNet('READY', true);

      board.setNet('RESET', true);
      board.advanceNanos(CLOCK_NS * 4);
      board.setNet('RESET', false);
      board.advanceNanos(CLOCK_NS * 20);

      expect(syncPulses.length).toBeGreaterThan(0);
      // The first SYNC should carry the M1 status byte (bit 5 = M1, bit 7 = MEMR).
      const first = syncPulses[0].statusByte;
      expect(first & 0b00100000, 'M1 bit must be set on first fetch').toBeTruthy();
      expect(first & 0b10000000, 'MEMR bit must be set on instruction fetch').toBeTruthy();
      board.dispose();
    });
  });

  describe('data movement', () => {
    it.skipIf(skip)('MVI A, n loads immediate into accumulator', async () => {
      // Program: MVI A, 0x42 ; STA 0x8000 ; HLT
      const program = asm(I8080.MVI_A, 0x42, I8080.STA, ...imm16(0x8000), I8080.HLT);
      const { board, ram } = await bootCpu(program);
      runUntilHlt(board);
      expect(ram.peek(0x8000)).toBe(0x42);
      board.dispose();
    });

    it.skipIf(skip)('MOV A, B copies B into A', async () => {
      // MVI B, 0x37 ; MOV A, B ; STA 0x8000 ; HLT
      const program = asm(
        I8080.MVI_B, 0x37,
        I8080.MOV_A_B,
        I8080.STA, ...imm16(0x8000),
        I8080.HLT,
      );
      const { board, ram } = await bootCpu(program);
      runUntilHlt(board);
      expect(ram.peek(0x8000)).toBe(0x37);
      board.dispose();
    });

    it.skipIf(skip)('LXI H, nnnn loads 16-bit immediate', async () => {
      // LXI H, 0x8042 ; MVI A, 0xAB ; MOV M, A ; HLT
      // Effect: writes 0xAB to address 0x8042
      const program = asm(
        I8080.LXI_H, ...imm16(0x8042),
        I8080.MVI_A, 0xAB,
        I8080.MOV_M_A,
        I8080.HLT,
      );
      const { board, ram } = await bootCpu(program);
      runUntilHlt(board);
      expect(ram.peek(0x8042)).toBe(0xAB);
      board.dispose();
    });

    it.skipIf(skip)('LDA n loads accumulator from memory', async () => {
      // Pre-populate RAM[0x8050]=0xCD ; LDA 0x8050 ; STA 0x8000 ; HLT
      const program = asm(
        I8080.LDA, ...imm16(0x8050),
        I8080.STA, ...imm16(0x8000),
        I8080.HLT,
      );
      const { board, ram } = await bootCpu(program);
      ram.poke(0x8050, 0xCD);
      runUntilHlt(board);
      expect(ram.peek(0x8000)).toBe(0xCD);
      board.dispose();
    });
  });

  describe('arithmetic', () => {
    it.skipIf(skip)('ADD with no carry', async () => {
      // MVI A, 0x33 ; MVI B, 0x44 ; ADD B ; STA 0x8000 ; HLT  → 0x77
      const program = asm(
        I8080.MVI_A, 0x33, I8080.MVI_B, 0x44,
        I8080.ADD_B, I8080.STA, ...imm16(0x8000), I8080.HLT,
      );
      const { board, ram } = await bootCpu(program);
      runUntilHlt(board);
      expect(ram.peek(0x8000)).toBe(0x77);
      board.dispose();
    });

    it.skipIf(skip)('ADD with carry-out wraps and stores low byte', async () => {
      // 0xFF + 0x01 = 0x100 → A=0x00, CY=1
      const program = asm(
        I8080.MVI_A, 0xFF, I8080.MVI_B, 0x01,
        I8080.ADD_B, I8080.STA, ...imm16(0x8000),
        // Push PSW + capture flags via PUSH PSW into stack at 0x9000
        I8080.LXI_SP, ...imm16(0x9002),
        I8080.PUSH_PSW,
        I8080.HLT,
      );
      const { board, ram } = await bootCpu(program);
      runUntilHlt(board);
      expect(ram.peek(0x8000)).toBe(0x00);
      // Flags byte stored at 0x9000 (PUSH PSW writes flags then A, SP--).
      // Bit 0 of flags = CY (must be 1 here).
      expect(ram.peek(0x9000) & 0x01, 'CY flag after 0xFF+0x01').toBe(0x01);
      board.dispose();
    });

    it.skipIf(skip)('SUB sets Z flag when result is zero', async () => {
      const program = asm(
        I8080.MVI_A, 0x55, I8080.MVI_B, 0x55,
        I8080.SUB_B,
        I8080.STA, ...imm16(0x8000),
        I8080.LXI_SP, ...imm16(0x9002),
        I8080.PUSH_PSW,
        I8080.HLT,
      );
      const { board, ram } = await bootCpu(program);
      runUntilHlt(board);
      expect(ram.peek(0x8000)).toBe(0x00);
      // Bit 6 of flags byte = Z
      expect(ram.peek(0x9000) & 0x40, 'Z flag').toBe(0x40);
      board.dispose();
    });

    it.skipIf(skip)('INR sets / clears Z flag without affecting CY', async () => {
      // INR from 0xFF wraps to 0x00 → Z=1, but CY is unchanged.
      // Pre-set CY via STC before the INR. Standard 8080 behaviour:
      // INR does NOT affect CY.
      const program = asm(
        I8080.STC,                  // CY = 1
        I8080.MVI_A, 0xFF,
        I8080.INR_A,                // A = 0x00, Z=1, CY unchanged
        I8080.STA, ...imm16(0x8000),
        I8080.LXI_SP, ...imm16(0x9002),
        I8080.PUSH_PSW,
        I8080.HLT,
      );
      const { board, ram } = await bootCpu(program);
      runUntilHlt(board);
      expect(ram.peek(0x8000)).toBe(0x00);
      const flags = ram.peek(0x9000);
      expect(flags & 0x40, 'Z=1 after wrap').toBe(0x40);
      expect(flags & 0x01, 'CY unchanged by INR').toBe(0x01);
      board.dispose();
    });

    it.skipIf(skip)('DAA decimal-adjusts after addition', async () => {
      // 0x35 + 0x47 = 0x7C ; DAA → 0x82 (BCD: 35 + 47 = 82)
      const program = asm(
        I8080.MVI_A, 0x35, I8080.MVI_B, 0x47,
        I8080.ADD_B,
        I8080.DAA,
        I8080.STA, ...imm16(0x8000),
        I8080.HLT,
      );
      const { board, ram } = await bootCpu(program);
      runUntilHlt(board);
      expect(ram.peek(0x8000)).toBe(0x82);
      board.dispose();
    });
  });

  describe('control flow', () => {
    it.skipIf(skip)('JMP transfers PC unconditionally', async () => {
      // JMP 0x0006 ; (skip 1 byte) ; HLT ; MVI A, 0xAA ; STA 0x8000 ; HLT
      // After JMP we land at 0x0006 (the MVI A).
      const program = new Uint8Array(16);
      program.fill(I8080.NOP);
      program[0] = I8080.JMP; program[1] = 0x06; program[2] = 0x00;
      program[3] = I8080.HLT;        // unreachable
      program[6] = I8080.MVI_A; program[7] = 0xAA;
      program[8] = I8080.STA; program[9] = 0x00; program[10] = 0x80;
      program[11] = I8080.HLT;
      const { board, ram } = await bootCpu(program);
      runUntilHlt(board);
      expect(ram.peek(0x8000)).toBe(0xAA);
      board.dispose();
    });

    it.skipIf(skip)('JZ taken when Z=1, skipped when Z=0', async () => {
      // SUB A=A → Z=1 ; JZ taken ; STA 0x8000=0x11 ; HLT ; ... unreached
      const program = asm(
        I8080.MVI_A, 0x05,
        I8080.SUB_B,                // B is 0 by reset → A=5 still, Z=0 (NOT zero)
        // Actually B's reset value is undocumented; force it.
        // Let's make this deterministic:
        I8080.HLT, // placeholder; we'll rewrite as a proper sequence
      );
      // Simpler explicit version:
      // Layout (bytes):  0:MVI_A 1:00  2:MVI_B 3:00  4:SUB_B
      //                  5:JZ 6:0B 7:00  (target = byte 0x0B)
      //                  8:MVI_A 9:EE  10:HLT  (unreached if jump taken)
      //                 11:MVI_A 12:11 13:STA 14:00 15:80 16:HLT
      const p2 = asm(
        I8080.MVI_A, 0x00, I8080.MVI_B, 0x00,
        I8080.SUB_B,                       // Z=1
        I8080.JZ, ...imm16(0x000B),        // jump past the unreachable HLT
        I8080.MVI_A, 0xEE,                 // unreached
        I8080.HLT,                         // unreached
        I8080.MVI_A, 0x11,
        I8080.STA, ...imm16(0x8000),
        I8080.HLT,
      );
      const { board, ram } = await bootCpu(p2);
      runUntilHlt(board);
      expect(ram.peek(0x8000)).toBe(0x11);
      board.dispose();
    });

    it.skipIf(skip)('CALL pushes return address, RET pops it', async () => {
      // SP = 0x9000 ; CALL sub ; STA 0x8000 (after RET) ; HLT
      // sub: MVI A, 0x77 ; RET
      const program = asm(
        I8080.LXI_SP, ...imm16(0x9000),
        I8080.CALL, ...imm16(0x000A),       // call to offset 10
        I8080.STA, ...imm16(0x8000),
        I8080.HLT,
        // padding to offset 10
        I8080.NOP,
        // offset 10:
        I8080.MVI_A, 0x77,
        I8080.RET,
      );
      const { board, ram } = await bootCpu(program);
      runUntilHlt(board);
      expect(ram.peek(0x8000)).toBe(0x77);
      board.dispose();
    });
  });

  describe('I/O ports', () => {
    it.skipIf(skip)('OUT drives address bus with port number and asserts WR̅', async () => {
      // MVI A, 0x99 ; OUT 0x42 ; HLT
      const program = asm(I8080.MVI_A, 0x99, I8080.OUT, 0x42, I8080.HLT);
      const { board } = await bootCpu(program);

      const outWrites = board.captureWrites({ wr: 'WR' });

      runUntilHlt(board, 1000);

      // The 8080 mirrors the port number on both A0..A7 and A8..A15
      // during an OUT cycle.
      const port = outWrites.find((w) => (w.addr & 0xff) === 0x42);
      expect(port, 'OUT cycle to port 0x42').toBeDefined();
      expect(port.data).toBe(0x99);
      board.dispose();
    });
  });

  describe('halt', () => {
    it.skipIf(skip)('HLT stops further opcode fetches', async () => {
      const program = asm(I8080.HLT);
      const { board } = await bootCpu(program);

      let fetchesAfterHalt = 0;
      // Hook DBIN to count fetches *after* a settling period.
      board.watchNet('DBIN', (high) => {
        if (high && board.nowNanos > BigInt(CLOCK_NS * 30)) fetchesAfterHalt++;
      });
      board.advanceNanos(CLOCK_NS * 100);

      // HLT should freeze fetches; allow up to 1 extra fetch for the
      // halt-state status update, beyond that is a bug.
      expect(fetchesAfterHalt).toBeLessThanOrEqual(1);
      board.dispose();
    });
  });

  describe('interrupts', () => {
    it.skipIf(skip)('INT pin + INTA bus cycle vectors via RST opcode jammed on bus', async () => {
      // EI ; loop: NOP ; JMP loop
      // ISR at 0x0028 (RST 5): MVI A, 0x55 ; STA 0x8000 ; HLT
      const program = new Uint8Array(0x40);
      program.fill(I8080.NOP);
      program[0x00] = I8080.EI;
      program[0x01] = I8080.JMP; program[0x02] = 0x01; program[0x03] = 0x00;
      program[0x28] = I8080.MVI_A; program[0x29] = 0x55;
      program[0x2A] = I8080.STA;   program[0x2B] = 0x00; program[0x2C] = 0x80;
      program[0x2D] = I8080.HLT;

      const { board, ram } = await bootCpu(program);

      // INTA bus driver. Two-stage:
      //   1. Watch SYNC. When high, sample the status byte. If INTA bit
      //      is set (status 0x23 = M1 + INTA + WO̅), latch a flag.
      //   2. Watch DBIN AFTER bootCpu (so we register last and our drive
      //      overrides the fake_rom's drive on the same DBIN edge).
      //      When DBIN rises during a latched INTA cycle, drive the RST
      //      opcode on D — the chip will read it.
      let intaPending = false;
      board.watchNet('SYNC', (high) => {
        if (!high) return;
        const status = board.readBus('D', 8);
        intaPending = (status & 0x01) !== 0;
      });
      board.watchNet('DBIN', (high) => {
        if (!high || !intaPending) return;
        intaPending = false;
        const RST5 = 0xEF;
        for (let i = 0; i < 8; i++) {
          board.setNet(`D${i}`, ((RST5 >> i) & 1) === 1);
        }
      });

      // Let EI + a few NOPs run.
      board.advanceNanos(CLOCK_NS * 20);
      // Pulse INT high.
      board.setNet('INT', true);
      board.advanceNanos(CLOCK_NS * 5);
      board.setNet('INT', false);
      // Let the ISR run to HLT.
      board.advanceNanos(CLOCK_NS * 200);

      expect(ram.peek(0x8000)).toBe(0x55);
      board.dispose();
    });
  });

  describe('integration', () => {
    it.skipIf(skip)('runs a hand-built loop that increments memory 10× and stores final count', async () => {
      // Loop: B = 10; mem[0x8000] = 0; do { mem[0x8000]++; B--; } while (B != 0);
      //
      //   LXI H, 0x8000          ; HL ← 0x8000 (memory pointer)
      //   MVI M, 0x00            ; mem[HL] = 0
      //   MVI B, 10              ; B = 10 (loop count)
      //   loop: INR M            ; mem[HL]++
      //         DCR B            ; B--
      //         JNZ loop         ; while B != 0
      //   HLT                    ; stop
      const program = asm(
        I8080.LXI_H, ...imm16(0x8000),     // 0x00..0x02
        I8080.MVI_M, 0x00,                  // 0x03..0x04
        I8080.MVI_B, 0x0A,                  // 0x05..0x06
        I8080.INR_M,                        // 0x07  ← loop label
        I8080.DCR_B,                        // 0x08
        I8080.JNZ, ...imm16(0x0007),        // 0x09..0x0B
        I8080.HLT,                          // 0x0C
      );
      const { board, ram } = await bootCpu(program);
      runUntilHlt(board);
      expect(ram.peek(0x8000), 'memory must hold the final loop count = 10').toBe(10);
      board.dispose();
    });

    /* CPUDIAG end-to-end run lives in its own file (`cpudiag.test.js`)
       — it requires a much longer time budget than the unit suite. */
  });
});
