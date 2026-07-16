/**
 * Multi-chip digital bus — Phase 0 go/no-go proof (project/multichip-bus/).
 *
 * D-008: the cheapest falsification of the core assumption. If a shared net
 * key does NOT make a byte written by one chip visible to another, the keying
 * model is wrong and we stop before building the kernel. These tests prove:
 *
 *   1. Root cause A is fixed — two chips on one wire resolve to the SAME key.
 *   2. The bug is real — per-endpoint syntheticChipPin keys differ.
 *   3. Byte exchange works — a write on the driver's keys is visible
 *      synchronously to watchers the reader registered on its own keys.
 *   4. The flag gates it — off by default (legacy path untouched).
 *   5. No regression — a single-chip chip-to-component net is NOT collapsed,
 *      so rules 2/3 still own it.
 *
 * This is WASM-free on purpose: it exercises the resolver keying + the real
 * PinManager fan-out directly. The full two-real-chips-light-8-LEDs milestone
 * is verified live in the app once the flag is flipped (see 03-phases.md).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PinManager } from '../simulation/PinManager';
import {
  resolveChipNetKey,
  setChipBusEnabledForTest,
  resetChipNetIndexForTest,
  type ChipNetState,
} from '../simulation/customChips/chipNets';
import { syntheticChipPin } from '../simulation/customChips/syntheticPins';

// ── Builders ─────────────────────────────────────────────────────────────────

const chip = (id: string) => ({ id, metadataId: 'custom-chip' });
const part = (id: string, metadataId: string) => ({ id, metadataId });
const wire = (aId: string, aPin: string, bId: string, bPin: string) => ({
  start: { componentId: aId, pinName: aPin },
  end: { componentId: bId, pinName: bPin },
});
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

// A CPU chip and a ROM chip with D0..D7 wired straight across, no board.
function busState(): ChipNetState {
  return {
    wires: range(8).map((i) => wire('cpu', `D${i}`, 'rom', `D${i}`)),
    components: [chip('cpu'), chip('rom')],
    boards: [],
  };
}

describe('chipbus Phase 0 — net-identity shared key', () => {
  beforeEach(() => {
    setChipBusEnabledForTest(true);
    resetChipNetIndexForTest();
  });
  afterEach(() => {
    setChipBusEnabledForTest(null);
    resetChipNetIndexForTest();
  });

  it('two chips on one wire resolve to the SAME key (root cause A fixed)', () => {
    const state = busState();
    const kCpu = resolveChipNetKey(state, 'cpu', 'D0');
    const kRom = resolveChipNetKey(state, 'rom', 'D0');
    expect(kCpu).not.toBeNull();
    expect(kCpu).toBe(kRom);
  });

  it('distinct data lines get distinct keys (no cross-talk between D0 and D1)', () => {
    const state = busState();
    expect(resolveChipNetKey(state, 'cpu', 'D0')).not.toBe(
      resolveChipNetKey(state, 'cpu', 'D1'),
    );
  });

  it('documents the bug: per-endpoint synthetic keys differ for one net', () => {
    expect(syntheticChipPin('cpu', 'D0')).not.toBe(syntheticChipPin('rom', 'D0'));
  });

  it('byte exchange — a write on the driver is visible synchronously to the reader', () => {
    const state = busState();
    const pm = new PinManager();

    // Reader (ROM) registers a watcher on EACH of its resolved data-bus keys,
    // exactly as vx_pin_watch would after the net key fix.
    let received = 0;
    for (const i of range(8)) {
      const key = resolveChipNetKey(state, 'rom', `D${i}`)!;
      pm.onPinChange(key, (_p, s) => {
        if (s) received |= 1 << i;
        else received &= ~(1 << i);
      });
    }

    // Driver (CPU) writes 0xA5 onto ITS resolved keys (vx_pin_write).
    const byte = 0xa5;
    for (const i of range(8)) {
      const key = resolveChipNetKey(state, 'cpu', `D${i}`)!;
      pm.triggerPinChange(key, ((byte >> i) & 1) === 1);
    }

    // The reader latched exactly the driver's byte, within the same call stack.
    expect(received).toBe(0xa5);
  });

  it('the same key reads back the driven level via getPinState', () => {
    const state = busState();
    const pm = new PinManager();
    const driveKey = resolveChipNetKey(state, 'cpu', 'D3')!;
    const readKey = resolveChipNetKey(state, 'rom', 'D3')!;
    pm.triggerPinChange(driveKey, true);
    expect(pm.getPinState(readKey)).toBe(true);
  });

  it('flag OFF (default): chip-to-chip net is NOT collapsed (legacy path)', () => {
    setChipBusEnabledForTest(false);
    resetChipNetIndexForTest();
    expect(resolveChipNetKey(busState(), 'cpu', 'D0')).toBeNull();
  });

  it('chip-to-component (single chip on net) returns null — rules 2/3 preserved', () => {
    const state: ChipNetState = {
      wires: [wire('chip', 'LED0', 'led1', 'A')],
      components: [chip('chip'), part('led1', 'led')],
      boards: [],
    };
    expect(resolveChipNetKey(state, 'chip', 'LED0')).toBeNull();
  });

  it('a board on the net defers to board priority (returns null)', () => {
    const state: ChipNetState = {
      wires: [
        wire('cpu', 'D0', 'rom', 'D0'),
        wire('cpu', 'D0', 'uno', '7'),
      ],
      components: [chip('cpu'), chip('rom')],
      boards: [{ id: 'uno', boardKind: 'arduino-uno' }],
    };
    expect(resolveChipNetKey(state, 'cpu', 'D0')).toBeNull();
  });

  it('three chips on one bus line all share one key', () => {
    const state: ChipNetState = {
      wires: [wire('cpu', 'D0', 'rom', 'D0'), wire('rom', 'D0', 'ram', 'D0')],
      components: [chip('cpu'), chip('rom'), chip('ram')],
      boards: [],
    };
    const a = resolveChipNetKey(state, 'cpu', 'D0');
    const b = resolveChipNetKey(state, 'rom', 'D0');
    const c = resolveChipNetKey(state, 'ram', 'D0');
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});
