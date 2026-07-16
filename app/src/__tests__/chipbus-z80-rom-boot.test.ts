/**
 * Phase 0-2 LIVE end-to-end proof on a REAL CPU (project/multichip-bus/).
 *
 * A real Z80 (examples/intel/z80.c) and a 32K EPROM (z80-boot-rom.c, a rom-32k
 * variant) are wired chip-to-chip over a shared address + data bus, NO board.
 * The ROM holds `JP 0x0006 / HALT`. Booting it requires the Z80 to:
 *   - drive the address bus -> ROM reacts (shared net key, Phase 0);
 *   - assert RD -> ROM tri-state-drives the data bus while the Z80 released it
 *     (Phase 1 drive resolution);
 *   - read the data bus IN THE SAME tickTimers step and get the settled byte
 *     (Phase 2 settle-before-read);
 * fetch C3,06,00 (the JP + target), jump, fetch 76 at 0x0006, and HALT — which
 * drives HALT low. Observing HALT go low is the proof the whole bus works.
 *
 * Fixtures compiled with wasi-sdk (see test_intel/scripts/compile-chip.sh flags);
 * skips cleanly if absent. z80.wasm from examples/intel/z80.c; z80-boot-rom.wasm
 * from project/multichip-bus research (rom-32k with a boot image).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
import { resetBusNets } from '../simulation/customChips/busNets';

const z80Path = fileURLToPath(new URL('./fixtures/chipbus/z80.wasm', import.meta.url));
const romPath = fileURLToPath(new URL('./fixtures/chipbus/z80-boot-rom.wasm', import.meta.url));
const haveFixtures = existsSync(z80Path) && existsSync(romPath);

const range = (n: number, from = 0) => Array.from({ length: n }, (_, i) => i + from);

const Z80_PINS = [
  ...range(16).map((i) => `A${i}`),
  ...range(8).map((i) => `D${i}`),
  'M1', 'MREQ', 'IORQ', 'RD', 'WR', 'RFSH', 'HALT', 'WAIT',
  'INT', 'NMI', 'RESET', 'BUSREQ', 'BUSACK', 'CLK', 'VCC', 'GND',
];
const ROM_PINS = [
  ...range(15).map((i) => `A${i}`),
  ...range(8).map((i) => `D${i}`),
  'CE', 'OE', 'VCC', 'GND',
];

// The schematic: address A0..A14 and data D0..D7 straight across, plus the Z80's
// RD strobe into the ROM's OE so the ROM only drives during reads. CE is left
// unwired (reads 0 = always enabled).
const STATE: ChipNetState = {
  wires: [
    ...range(15).map((i) => ({
      start: { componentId: 'z80', pinName: `A${i}` },
      end: { componentId: 'rom', pinName: `A${i}` },
    })),
    ...range(8).map((i) => ({
      start: { componentId: 'z80', pinName: `D${i}` },
      end: { componentId: 'rom', pinName: `D${i}` },
    })),
    { start: { componentId: 'z80', pinName: 'RD' }, end: { componentId: 'rom', pinName: 'OE' } },
  ],
  components: [
    { id: 'z80', metadataId: 'custom-chip' },
    { id: 'rom', metadataId: 'custom-chip' },
  ],
  boards: [],
};

function pinKey(chipId: string, pin: string): number {
  return resolveChipNetKey(STATE, chipId, pin) ?? syntheticChipPin(chipId, pin);
}
function wiresFor(chipId: string, pins: string[]): Map<string, number> {
  return new Map(pins.map((p) => [p, pinKey(chipId, p)] as [string, number]));
}

describe.skipIf(!haveFixtures)('chipbus Phase 0-2 — a real Z80 boots from a ROM over the bus', () => {
  beforeEach(() => {
    setChipBusEnabledForTest(true);
    resetChipNetIndexForTest();
    resetBusNets();
  });
  afterEach(() => {
    setChipBusEnabledForTest(null);
    resetChipNetIndexForTest();
    resetBusNets();
  });

  it('fetches JP+HALT from the ROM across the bus and drives HALT low', async () => {
    const z80Wasm = new Uint8Array(readFileSync(z80Path));
    const romWasm = new Uint8Array(readFileSync(romPath));
    const pm = new PinManager();

    const z80 = await ChipInstance.create({
      wasm: z80Wasm, componentId: 'z80', pinManager: pm, wires: wiresFor('z80', Z80_PINS),
    });
    z80.start();
    const rom = await ChipInstance.create({
      wasm: romWasm, componentId: 'rom', pinManager: pm, wires: wiresFor('rom', ROM_PINS),
    });
    rom.start();

    const halt = pinKey('z80', 'HALT');
    // At power-on the Z80 holds HALT high (running, registered OUTPUT_HIGH).
    expect(pm.getPinState(halt)).toBe(true);

    // on_clock bails while BUSREQ/WAIT read low (unwired inputs default 0), so
    // deassert them, then release RESET (rising edge) to start the CPU.
    pm.triggerPinChange(pinKey('z80', 'BUSREQ'), true);
    pm.triggerPinChange(pinKey('z80', 'WAIT'), true);
    pm.triggerPinChange(pinKey('z80', 'RESET'), true);

    // Run the 4 MHz pseudo-clock (250 ns period) for ~200 ticks — far more than
    // the 2 instructions to reach HALT.
    z80.tickTimers(50_000n);

    // HALT went low: the Z80 executed JP 0x0006 then HALT, having correctly read
    // every byte from the ROM over the shared chip-to-chip bus.
    expect(pm.getPinState(halt)).toBe(false);

    z80.dispose();
    rom.dispose();
  });
});
