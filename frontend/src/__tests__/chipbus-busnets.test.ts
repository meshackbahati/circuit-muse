/**
 * Phase 1 — multi-driver bus net registry (project/multichip-bus/). Drives the
 * busNets registry against a real PinManager: tri-state release, pull-up
 * fallback, contention warning, and per-chip driver teardown.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PinManager } from '../simulation/PinManager';
import {
  setBusDrive,
  clearBusDriversForChip,
  resetBusNets,
} from '../simulation/customChips/busNets';
import { Strength, HIGHZ_DRIVE, type Drive } from '../simulation/customChips/busLogic';

const NET = 100500; // a stand-in syntheticNetPin key
const strong = (v: 0 | 1): Drive => ({ value: v, strength: Strength.STRONG });
const pull = (v: 0 | 1): Drive => ({ value: v, strength: Strength.PULL });

describe('busNets — multi-driver resolution into PinManager', () => {
  let pm: PinManager;
  beforeEach(() => {
    resetBusNets();
    pm = new PinManager();
  });
  afterEach(() => {
    resetBusNets();
    vi.restoreAllMocks();
  });

  it('a single strong driver sets the net level', () => {
    setBusDrive(pm, NET, 'cpu::D0', strong(1));
    expect(pm.getPinState(NET)).toBe(true);
    setBusDrive(pm, NET, 'cpu::D0', strong(0));
    expect(pm.getPinState(NET)).toBe(false);
  });

  it('tri-state hand-off: the releasing driver yields to the active one', () => {
    setBusDrive(pm, NET, 'rom::D0', strong(1)); // ROM drives 1
    setBusDrive(pm, NET, 'ram::D0', HIGHZ_DRIVE); // RAM released
    expect(pm.getPinState(NET)).toBe(true);

    // ROM releases, RAM drives 0 -> bus follows RAM.
    setBusDrive(pm, NET, 'rom::D0', HIGHZ_DRIVE);
    setBusDrive(pm, NET, 'ram::D0', strong(0));
    expect(pm.getPinState(NET)).toBe(false);
  });

  it('a pull-up holds the bus high only while every driver is released', () => {
    setBusDrive(pm, NET, 'pullup::D0', pull(1));
    setBusDrive(pm, NET, 'drv::D0', HIGHZ_DRIVE);
    expect(pm.getPinState(NET)).toBe(true); // floats up to the pull-up

    setBusDrive(pm, NET, 'drv::D0', strong(0)); // a strong driver beats the pull
    expect(pm.getPinState(NET)).toBe(false);

    setBusDrive(pm, NET, 'drv::D0', HIGHZ_DRIVE); // released again -> pull-up wins
    expect(pm.getPinState(NET)).toBe(true);
  });

  it('contention (two strong, opposite) warns once and resolves low (X)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setBusDrive(pm, NET, 'a::D0', strong(0));
    setBusDrive(pm, NET, 'b::D0', strong(1)); // now in contention
    expect(warn).toHaveBeenCalledTimes(1);
    expect(pm.getPinState(NET)).toBe(false); // X projects to low

    // Re-resolving while still in contention does not warn again.
    setBusDrive(pm, NET, 'a::D0', strong(0));
    expect(warn).toHaveBeenCalledTimes(1);

    // Clearing the contention and re-entering it warns afresh.
    setBusDrive(pm, NET, 'b::D0', HIGHZ_DRIVE);
    setBusDrive(pm, NET, 'b::D0', strong(1));
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('clearBusDriversForChip releases that chip across every net', () => {
    setBusDrive(pm, NET, 'rom::D0', strong(1));
    setBusDrive(pm, NET, 'ram::D0', HIGHZ_DRIVE);
    expect(pm.getPinState(NET)).toBe(true);

    clearBusDriversForChip(pm, 'rom'); // ROM removed -> only RAM's Hi-Z left
    expect(pm.getPinState(NET)).toBe(false); // floats (Z) -> low
  });

  it('a reader notified via onPinChange sees the resolved level synchronously', () => {
    let seen: boolean | null = null;
    pm.onPinChange(NET, (_p, s) => {
      seen = s;
    });
    setBusDrive(pm, NET, 'drv::D0', strong(1));
    expect(seen).toBe(true);
  });
});
