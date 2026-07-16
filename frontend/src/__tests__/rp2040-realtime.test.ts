/**
 * RP2040 real-time scheduler
 *
 * The RP2040 core (125 MHz Cortex-M0) is ~8x heavier to emulate than the AVR.
 * A `delay()` on the arduino-pico core BUSY-WAITS (polls the timer in a tight
 * loop) instead of sleeping, so the WFI fast-path never triggers and a host
 * that cannot sustain 125 M instr/s would render a 1 s blink every 4-5 s.
 *
 * Two mechanisms keep simulated time locked to wall-clock:
 *   1. the frame budget is derived from the measured wall-clock delta, and
 *   2. IdleSpinDetector recognises a side-effect-free busy-wait spin so the
 *      scheduler advances the clock over it instead of grinding every cycle.
 *
 * These tests cover the detector in isolation (the risky heuristic) and the
 * end-to-end scheduler against a real rp2040js core running a hand-assembled
 * busy-wait loop — no compiled firmware fixture required.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RP2040 } from 'rp2040js';
import { RP2040Simulator, IdleSpinDetector } from '../simulation/RP2040Simulator';
import { PinManager } from '../simulation/PinManager';

// ── IdleSpinDetector — the heuristic that decides what is safe to skip ───────
describe('IdleSpinDetector', () => {
  const constGpio = () => 0;

  it('detects a stable, side-effect-free spin after the threshold', () => {
    const d = new IdleSpinDetector(32);
    // Drive the real PC sequence: L, L+2, L, L+2, ... (backward branch each loop)
    const L = 0x100;
    let detected = false;
    d.observe(L, constGpio);
    for (let i = 0; i < 40; i++) {
      d.observe(L + 2, constGpio);
      detected = d.observe(L, constGpio) || detected; // L < L+2 → backward branch
    }
    expect(detected).toBe(true);
  });

  it('never elides a bit-bang loop (GPIO changes every iteration)', () => {
    const d = new IdleSpinDetector(32);
    const L = 0x100;
    let toggling = 0;
    const changingGpio = () => (toggling ^= 1); // different value each read
    let detected = false;
    d.observe(L, changingGpio);
    for (let i = 0; i < 200; i++) {
      d.observe(L + 2, changingGpio);
      detected = d.observe(L, changingGpio) || detected;
    }
    expect(detected).toBe(false);
  });

  it('never elides straight-line code (no backward branch)', () => {
    const d = new IdleSpinDetector(8);
    let detected = false;
    for (let pc = 0x100; pc < 0x100 + 8 * 100; pc += 2) {
      detected = d.observe(pc, constGpio) || detected;
    }
    expect(detected).toBe(false);
  });

  it('resets on a long forward jump (loop that calls out)', () => {
    const d = new IdleSpinDetector(4);
    const L = 0x100;
    let detected = false;
    // Each "iteration" jumps far away (a bl to a subroutine) then comes back.
    for (let i = 0; i < 50; i++) {
      d.observe(L, constGpio);
      d.observe(L + 2, constGpio);
      d.observe(L + 0x4000, constGpio); // long forward jump → reset
      detected = d.observe(L, constGpio) || detected; // backward, but count was reset
    }
    expect(detected).toBe(false);
  });

  it('noteElided() makes it re-accumulate before signalling again', () => {
    const d = new IdleSpinDetector(4);
    const L = 0x100;
    const tick = () => {
      d.observe(L + 2, constGpio);
      return d.observe(L, constGpio);
    };
    d.observe(L, constGpio);
    let detected = false;
    for (let i = 0; i < 4; i++) detected = tick() || detected;
    expect(detected).toBe(true);
    d.noteElided();
    // Immediately after eliding, it must NOT re-signal until the loop runs again.
    expect(tick()).toBe(false);
  });
});

// ── End-to-end scheduler against a real rp2040js core ────────────────────────
describe('RP2040Simulator — real-time scheduler', () => {
  const RAM = 0x20000000;
  const NOP = 0xbf00;
  const B_BACK_1 = 0xe7fd; // b .-2  (branch to the previous 16-bit instruction)

  let sim: RP2040Simulator;
  let rp: RP2040;

  /** Build a simulator wrapping a fresh core preloaded with `opcodes` at RAM. */
  function withProgram(opcodes: number[]): void {
    rp = new RP2040();
    opcodes.forEach((op, i) => rp.writeUint16(RAM + i * 2, op));
    rp.core.PC = RAM;
    sim = new RP2040Simulator(new PinManager());
    // Inject the bare core directly — we are unit-testing the scheduler, not
    // the bootrom/flash loader.
    (sim as unknown as { rp2040: RP2040 }).rp2040 = rp;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    sim?.stop();
  });

  it('elides a busy-wait spin: sim-time tracks wall-time with few instructions', () => {
    withProgram([NOP, B_BACK_1]); // nop; loop forever — a side-effect-free spin
    const before = sim.getCurrentCycles();
    const { cyclesAdvanced, instructionsExecuted } = sim.runFrameForTime(16); // 16 ms

    // 16 ms of wall-clock at 125 MHz == 2 000 000 simulated cycles.
    expect(cyclesAdvanced).toBeGreaterThan(1_900_000);
    expect(sim.getCurrentCycles() - before).toBeGreaterThan(1_900_000);
    // ...yet almost none of those cycles were actually executed (the win).
    expect(instructionsExecuted).toBeLessThan(5_000);
  });

  it('does NOT elide when GPIO keeps changing (bit-bang safety)', () => {
    withProgram([NOP, B_BACK_1]);
    // Same loop, but make every GPIO snapshot differ — mimics a pin toggling
    // each iteration. The detector must refuse to skip and grind every cycle.
    let n = 0;
    Object.defineProperty(rp, 'gpioValues', { configurable: true, get: () => n++ });

    const { cyclesAdvanced, instructionsExecuted } = sim.runFrameForTime(1); // 1 ms
    // No skipping: instructions executed are on the order of cycles advanced.
    expect(instructionsExecuted).toBeGreaterThan(cyclesAdvanced / 4);
  });

  it('locks the cycle budget to the measured wall-clock delta', () => {
    withProgram([NOP, B_BACK_1]);
    const small = sim.runFrameForTime(4).cyclesAdvanced;
    const big = sim.runFrameForTime(16).cyclesAdvanced;
    // 4x the wall-time => ~4x the simulated cycles (within scheduling slack).
    expect(big).toBeGreaterThan(small * 3);
    // And the long-delta clamp keeps a backgrounded tab from over-running.
    const clamped = sim.runFrameForTime(100_000).cyclesAdvanced; // 100 s wall-clock
    expect(clamped).toBeLessThan(50 /*MAX_DELTA_MS*/ * 125_000 + 200_000);
  });

  it('still fires scheduled pin changes during an elided frame (not skipped past)', () => {
    withProgram([NOP, B_BACK_1]);
    const setPin = vi.spyOn(sim, 'setPinState');
    const at = sim.getCurrentCycles() + 1000;
    sim.schedulePinChange(2, true, at); // external edge 1000 cycles into the future
    sim.runFrameForTime(16);
    // advanceClock caps each jump at the next scheduled change, so it is
    // applied on time rather than swallowed by the idle skip.
    expect(setPin).toHaveBeenCalledWith(2, true);
  });
});
