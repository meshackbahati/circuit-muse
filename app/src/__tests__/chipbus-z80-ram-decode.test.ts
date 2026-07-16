/**
 * Phase 3 computer-core LIVE proof (project/multichip-bus/): a real Z80 with
 * ROM + RAM + address-decode glue, all chip-to-chip over a shared bus, no board.
 *
 * Memory map via real glue logic:
 *   ROM (32K) at 0x0000-0x7FFF   -> rom.CE = A15        (selected when A15=0)
 *   RAM (64K) at 0x8000-0xFFFF   -> ram.CE = NOT A15    (an inverter chip)
 *   both data outputs gated by RD (OE); RAM write gated by WR (WE).
 *
 * The ROM program writes 0x5A to RAM at 0x8000, clears A, reads it back, and
 * HALTs only if the byte survived (else it spins). HALT going low proves: the
 * Z80 ran from ROM, the inverter decoded A15 to select RAM (Phase 2 settle
 * drives the combinational glue), the RAM latched a write and returned it on a
 * read over the shared bus (Phase 1 tri-state), all within synchronous bus
 * cycles (Phase 2 settle-before-read).
 *
 * Fixtures compiled with wasi-sdk; skips if absent. ram-64k.wasm / inverter.wasm
 * are built from the committed examples; z80-ram-rom.c is the boot image.
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

const f = (n: string) => fileURLToPath(new URL(`./fixtures/chipbus/${n}`, import.meta.url));
const paths = {
  z80: f('z80.wasm'),
  rom: f('z80-ram-rom.wasm'),
  ram: f('ram-64k.wasm'),
  inv: f('inverter.wasm'),
};
const haveFixtures = Object.values(paths).every(existsSync);

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

const Z80_PINS = [
  ...range(16).map((i) => `A${i}`),
  ...range(8).map((i) => `D${i}`),
  'M1', 'MREQ', 'IORQ', 'RD', 'WR', 'RFSH', 'HALT', 'WAIT',
  'INT', 'NMI', 'RESET', 'BUSREQ', 'BUSACK', 'CLK', 'VCC', 'GND',
];
const ROM_PINS = [...range(15).map((i) => `A${i}`), ...range(8).map((i) => `D${i}`), 'CE', 'OE', 'VCC', 'GND'];
const RAM_PINS = [...range(16).map((i) => `A${i}`), ...range(8).map((i) => `D${i}`), 'CE', 'OE', 'WE', 'VCC', 'GND'];
const INV_PINS = ['IN', 'OUT'];

const W: ChipNetState['wires'] = [];
const wire = (a: string, ap: string, b: string, bp: string) =>
  (W as { start: { componentId: string; pinName: string }; end: { componentId: string; pinName: string } }[]).push(
    { start: { componentId: a, pinName: ap }, end: { componentId: b, pinName: bp } },
  );
// Address bus A0..A14 shared by Z80, ROM and RAM.
for (const i of range(15)) {
  wire('z80', `A${i}`, 'rom', `A${i}`);
  wire('z80', `A${i}`, 'ram', `A${i}`);
}
// A15: top RAM address bit, ROM chip-select, and the inverter input (decode).
wire('z80', 'A15', 'ram', 'A15');
wire('z80', 'A15', 'rom', 'CE');
wire('z80', 'A15', 'inv', 'IN');
// Data bus shared by all three memory-side chips.
for (const i of range(8)) {
  wire('z80', `D${i}`, 'rom', `D${i}`);
  wire('z80', `D${i}`, 'ram', `D${i}`);
}
// Control: RD -> both output-enables; WR -> RAM write-enable; !A15 -> RAM CE.
wire('z80', 'RD', 'rom', 'OE');
wire('z80', 'RD', 'ram', 'OE');
wire('z80', 'WR', 'ram', 'WE');
wire('inv', 'OUT', 'ram', 'CE');

const STATE: ChipNetState = {
  wires: W,
  components: [
    { id: 'z80', metadataId: 'custom-chip' },
    { id: 'rom', metadataId: 'custom-chip' },
    { id: 'ram', metadataId: 'custom-chip' },
    { id: 'inv', metadataId: 'custom-chip' },
  ],
  boards: [],
};

const pinKey = (chipId: string, pin: string): number =>
  resolveChipNetKey(STATE, chipId, pin) ?? syntheticChipPin(chipId, pin);
const wiresFor = (chipId: string, pins: string[]): Map<string, number> =>
  new Map(pins.map((p) => [p, pinKey(chipId, p)] as [string, number]));

describe.skipIf(!haveFixtures)('chipbus Phase 3 core — Z80 + ROM + RAM + address decode', () => {
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

  it('runs from ROM, round-trips RAM via the inverter-decoded bus, and HALTs', async () => {
    const pm = new PinManager();
    const z80 = await ChipInstance.create({ wasm: new Uint8Array(readFileSync(paths.z80)), componentId: 'z80', pinManager: pm, wires: wiresFor('z80', Z80_PINS) });
    z80.start();
    const rom = await ChipInstance.create({ wasm: new Uint8Array(readFileSync(paths.rom)), componentId: 'rom', pinManager: pm, wires: wiresFor('rom', ROM_PINS) });
    rom.start();
    const ram = await ChipInstance.create({ wasm: new Uint8Array(readFileSync(paths.ram)), componentId: 'ram', pinManager: pm, wires: wiresFor('ram', RAM_PINS) });
    ram.start();
    const inv = await ChipInstance.create({ wasm: new Uint8Array(readFileSync(paths.inv)), componentId: 'inv', pinManager: pm, wires: wiresFor('inv', INV_PINS) });
    inv.start();

    const halt = pinKey('z80', 'HALT');
    expect(pm.getPinState(halt)).toBe(true); // running at power-on

    pm.triggerPinChange(pinKey('z80', 'BUSREQ'), true);
    pm.triggerPinChange(pinKey('z80', 'WAIT'), true);
    pm.triggerPinChange(pinKey('z80', 'RESET'), true);

    z80.tickTimers(100_000n); // ~400 clocks; the program halts after ~7 instructions

    // HALT low: the RAM write+read round-trip survived -> the whole computer core
    // (CPU + ROM + RAM + inverter decode) works over the shared chip-to-chip bus.
    expect(pm.getPinState(halt)).toBe(false);

    z80.dispose(); rom.dispose(); ram.dispose(); inv.dispose();
  });
});
