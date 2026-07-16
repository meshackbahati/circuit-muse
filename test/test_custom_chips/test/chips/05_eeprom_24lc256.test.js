/**
 * TIER 2 — Bigger I2C EEPROM (24LC256, 32 KB, 16-bit address).
 * 4 tests covering 16-bit addressing, high-address access, page writes, cross-page reads.
 */
import { describe, it, expect } from 'vitest';
import { ChipInstance } from '../../src/ChipRuntime.js';
import { PinManager } from '../../src/PinManager.js';
import { I2CBus } from '../../src/I2CBus.js';
import { loadChipWasm, chipWasmExists, makeFakeTwi, i2cWrite, i2cRead } from '../helpers.js';

const skip = !chipWasmExists('eeprom-24lc256');

async function setup() {
  const pm = new PinManager();
  const twi = makeFakeTwi();
  const bus = new I2CBus(twi);
  const wires = new Map([
    ['A0', 30], ['A1', 31], ['A2', 32],
    ['SDA', 33], ['SCL', 34], ['VCC', 1], ['GND', 0], ['WP', 35],
  ]);
  const chip = await ChipInstance.create({
    wasm: loadChipWasm('eeprom-24lc256'), pinManager: pm, i2cBus: bus, wires,
  });
  chip.start();
  return { pm, twi, bus, chip, address: 0x50 };
}

describe('TIER 2 — 24LC256 EEPROM (32 KB, 16-bit addressing)', () => {
  it.skipIf(skip)('writes a single byte at a 16-bit address and reads it back', async () => {
    const { twi, bus, chip, address } = await setup();
    // address 0x1234, data 0xA5
    i2cWrite(bus, twi, address, [0x12, 0x34, 0xA5]);
    i2cWrite(bus, twi, address, [0x12, 0x34]);          // reset pointer
    expect(i2cRead(bus, twi, address, 1)).toEqual([0xA5]);
    chip.dispose();
  });

  it.skipIf(skip)('works at high addresses (>0xff)', async () => {
    const { twi, bus, chip, address } = await setup();
    i2cWrite(bus, twi, address, [0x7F, 0xFE, 0xDE, 0xAD]);  // addr 0x7FFE: 0xDE, addr 0x7FFF: 0xAD
    i2cWrite(bus, twi, address, [0x7F, 0xFE]);
    expect(i2cRead(bus, twi, address, 2)).toEqual([0xDE, 0xAD]);
    chip.dispose();
  });

  it.skipIf(skip)('page write of 8 sequential bytes', async () => {
    const { twi, bus, chip, address } = await setup();
    const page = [0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80];
    i2cWrite(bus, twi, address, [0x00, 0x40, ...page]);
    i2cWrite(bus, twi, address, [0x00, 0x40]);
    expect(i2cRead(bus, twi, address, 8)).toEqual(page);
    chip.dispose();
  });

  it.skipIf(skip)('reads across the 0x100 byte boundary auto-increment', async () => {
    const { twi, bus, chip, address } = await setup();
    i2cWrite(bus, twi, address, [0x00, 0xFE, 0xAA, 0xBB, 0xCC, 0xDD]);
    i2cWrite(bus, twi, address, [0x00, 0xFE]);
    // reads at 0x00FE, 0x00FF, 0x0100, 0x0101 — pointer crosses high byte
    expect(i2cRead(bus, twi, address, 4)).toEqual([0xAA, 0xBB, 0xCC, 0xDD]);
    chip.dispose();
  });
});
