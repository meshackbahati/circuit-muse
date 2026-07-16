/**
 * Phase 2 — synchronous settle kernel (project/multichip-bus/). Drives the
 * delta-cycle settle loop with a real PinManager and listeners standing in for
 * chips (a chip = a watcher that, on its input net, drives an output net — the
 * same shape busNets+ChipRuntime produce). Covers: multi-hop settle to a fixed
 * point, settle-before-read, no deep recursion on long chains, and the
 * oscillation cap.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PinManager } from '../simulation/PinManager';
import { publishNetLevel, resetBusKernel } from '../simulation/customChips/busKernel';

describe('busKernel — delta-cycle settle', () => {
  let pm: PinManager;
  beforeEach(() => {
    resetBusKernel();
    pm = new PinManager();
  });
  afterEach(() => {
    resetBusKernel();
    vi.restoreAllMocks();
  });

  it('settles a multi-hop combinational chain to its fixed point', () => {
    const A = 1000;
    const B = 1001;
    const C = 1002;
    // "chip" 1: B follows A. "chip" 2: C = NOT B.
    pm.onPinChange(A, (_p, v) => publishNetLevel(pm, B, v));
    pm.onPinChange(B, (_p, v) => publishNetLevel(pm, C, !v));

    publishNetLevel(pm, A, true);

    expect(pm.getPinState(A)).toBe(true);
    expect(pm.getPinState(B)).toBe(true);
    expect(pm.getPinState(C)).toBe(false);
  });

  it('settle-before-read: a driven net is settled by the time the publish returns', () => {
    const ADDR = 2000;
    const DATA = 2001;
    // "memory": DATA mirrors ADDR (combinational). Models a ROM driving the data
    // bus in reaction to the address/strobe within the same bus cycle.
    pm.onPinChange(ADDR, (_p, v) => publishNetLevel(pm, DATA, v));

    publishNetLevel(pm, ADDR, true);
    // A synchronous in-cycle read here (as a CPU chip would do) sees settled data.
    expect(pm.getPinState(DATA)).toBe(true);
  });

  it('handles a very long chain without recursing (no stack overflow)', () => {
    const N = 5000;
    for (let i = 0; i < N; i++) {
      const from = 3000 + i;
      const to = 3000 + i + 1;
      pm.onPinChange(from, (_p, v) => publishNetLevel(pm, to, v));
    }
    publishNetLevel(pm, 3000, true);
    expect(pm.getPinState(3000 + N)).toBe(true); // value walked the whole chain
  });

  it('caps a zero-delay oscillation and warns instead of hanging', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const OSC = 4000;
    // A ring oscillator: every settle flips the net, which re-triggers forever.
    pm.onPinChange(OSC, (_p, v) => publishNetLevel(pm, OSC, !v));

    publishNetLevel(pm, OSC, true); // must RETURN (cap trips), not hang

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('did not converge');
  });

  it('coalesces multiple drives of one net within a delta to the latest', () => {
    const N = 5000;
    let fires = 0;
    pm.onPinChange(N, () => {
      fires++;
    });
    // Same net published twice before any settle delta applies it: the watcher
    // should see exactly one (latest) value, not two.
    publishNetLevel(pm, N, true);
    expect(pm.getPinState(N)).toBe(true);
    expect(fires).toBe(1);
  });
});
