/**
 * Multi-chip digital bus — Phase 0 LIVE proof with REAL compiled WASM chips.
 *
 * This is the "2 chips exchange a real byte" milestone (03-phases.md, D-008),
 * end-to-end through the actual ChipRuntime + PinManager + the chipbus net-key
 * resolver — not a unit stub. Two chips compiled from C with wasi-sdk:
 *   - bus-driver: drives 0xA5 onto D0..D7 at setup (OUTPUT_HIGH/LOW).
 *   - bus-reader: polls D0..D7 on a 1ms timer, mirrors onto OUT0..OUT7.
 * Wired chip-to-chip (D0..D7 straight across), no board. With the chipbus flag
 * the two chips' Dn pins resolve to ONE shared net key, so the reader observes
 * the driver's byte and reproduces 0xA5 on OUT.
 *
 * Sources: test/test_custom_chips/sdk/examples/{bus-driver,bus-reader}.c.
 * Fixtures (.wasm) are committed alongside this test; regenerate with:
 *   clang --target=wasm32-unknown-wasip1 -O2 -nostartfiles -Wl,--import-memory \
 *     -Wl,--export-table -Wl,--no-entry -Wl,--export=chip_setup \
 *     -Wl,--allow-undefined -I test/test_custom_chips/sdk/include <src.c> -o <out.wasm>
 * (same flags as test_intel/scripts/compile-chip.sh).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PinManager } from '../simulation/PinManager';
import { ChipInstance } from '../simulation/customChips/ChipRuntime';
import {
  resolveChipNetKey,
  setChipBusEnabledForTest,
  resetChipNetIndexForTest,
  type ChipNetState,
} from '../simulation/customChips/chipNets';
import { syntheticChipPin } from '../simulation/customChips/syntheticPins';

const driverWasmPath = fileURLToPath(new URL('./fixtures/chipbus/bus-driver.wasm', import.meta.url));
const readerWasmPath = fileURLToPath(new URL('./fixtures/chipbus/bus-reader.wasm', import.meta.url));
const haveFixtures = existsSync(driverWasmPath) && existsSync(readerWasmPath);

const chip = (id: string) => ({ id, metadataId: 'custom-chip' });
const wire = (aId: string, aPin: string, bId: string, bPin: string) => ({
  start: { componentId: aId, pinName: aPin },
  end: { componentId: bId, pinName: bPin },
});
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

// The data bus: driver.D0..D7 wired straight across to reader.D0..D7, no board.
const STATE: ChipNetState = {
  wires: range(8).map((i) => wire('driver', `D${i}`, 'reader', `D${i}`)),
  components: [chip('driver'), chip('reader')],
  boards: [],
};

// Mirror what traceDetailed hands CustomChipPart's `wires` map: a chip-to-chip
// net resolves to the shared net key; an unwired chip pin (the reader's OUTn)
// falls back to its own synthetic key (rule 3).
function pinKey(chipId: string, pin: string): number {
  return resolveChipNetKey(STATE, chipId, pin) ?? syntheticChipPin(chipId, pin);
}

describe.skipIf(!haveFixtures)('chipbus Phase 0 — two REAL chips exchange a byte', () => {
  beforeAll(() => {
    setChipBusEnabledForTest(true);
    resetChipNetIndexForTest();
  });
  afterAll(() => {
    setChipBusEnabledForTest(null);
    resetChipNetIndexForTest();
  });

  it('reader reproduces the driver byte 0xA5 over the shared chip-to-chip bus', async () => {
    const driverWasm = new Uint8Array(readFileSync(driverWasmPath));
    const readerWasm = new Uint8Array(readFileSync(readerWasmPath));

    // The bus pins resolve to ONE shared key for both chips (root cause A fix).
    expect(pinKey('driver', 'D0')).toBe(pinKey('reader', 'D0'));

    const pm = new PinManager();

    const driverWires = new Map<string, number>(
      range(8).map((i) => [`D${i}`, pinKey('driver', `D${i}`)] as [string, number]),
    );
    const readerWires = new Map<string, number>([
      ...range(8).map((i) => [`D${i}`, pinKey('reader', `D${i}`)] as [string, number]),
      ...range(8).map((i) => [`OUT${i}`, pinKey('reader', `OUT${i}`)] as [string, number]),
    ]);

    // componentId must be distinct so each chip's bus drivers are keyed apart
    // (the real app always passes it; busNets keys drivers by `${id}::${pin}`).
    const driver = await ChipInstance.create({
      wasm: driverWasm,
      componentId: 'driver',
      pinManager: pm,
      wires: driverWires,
    });
    driver.start(); // chip_setup drives 0xA5 onto the shared D0..D7 net keys.

    const reader = await ChipInstance.create({
      wasm: readerWasm,
      componentId: 'reader',
      pinManager: pm,
      wires: readerWires,
    });
    reader.start();

    // Fire the reader's 1ms polling timer (advance sim time well past it).
    reader.tickTimers(5_000_000n);

    // Reconstruct the byte the reader mirrored onto OUT0..OUT7.
    let out = 0;
    for (const i of range(8)) {
      if (pm.getPinState(pinKey('reader', `OUT${i}`))) out |= 1 << i;
    }
    expect(out).toBe(0xa5);

    driver.dispose();
    reader.dispose();
  });
});
