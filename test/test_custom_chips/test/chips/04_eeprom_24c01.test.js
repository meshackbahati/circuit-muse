/**
 * TIER 2 — I2C protocol on 24C01 (128-byte EEPROM).
 * 4 tests covering basic write/read, pointer auto-increment, wrap, address pin selection.
 */
import { describe, it, expect } from 'vitest';
import { ChipInstance } from '../../src/ChipRuntime.js';
import { PinManager } from '../../src/PinManager.js';
import { I2CBus } from '../../src/I2CBus.js';
import { loadChipWasm, chipWasmExists, makeFakeTwi, i2cWrite, i2cRead } from '../helpers.js';

const skip = !chipWasmExists('eeprom-24c01');

async function setup(addrBits = 0b000) {
  const pm = new PinManager();
  const twi = makeFakeTwi();
  const bus = new I2CBus(twi);
  // Pre-set A0/A1/A2 pins so the chip reads them at init.
  pm.triggerPinChange(20, (addrBits & 1) !== 0);
  pm.triggerPinChange(21, (addrBits & 2) !== 0);
  pm.triggerPinChange(22, (addrBits & 4) !== 0);
  const wires = new Map([
    ['A0', 20], ['A1', 21], ['A2', 22],
    ['SDA', 23], ['SCL', 24], ['VCC', 1], ['GND', 0], ['WP', 25],
  ]);
  const chip = await ChipInstance.create({
    wasm: loadChipWasm('eeprom-24c01'), pinManager: pm, i2cBus: bus, wires,
  });
  chip.start();
  return { pm, twi, bus, chip, address: 0x50 | addrBits };
}

describe('TIER 2 — 24C01 EEPROM I2C', () => {
  it.skipIf(skip)('writes pointer + 1 byte, then reads it back', async () => {
    const { twi, bus, chip, address } = await setup();
    i2cWrite(bus, twi, address, [0x05, 0x42]);          // pointer=5, data=0x42
    i2cWrite(bus, twi, address, [0x05]);                // reset pointer
    expect(i2cRead(bus, twi, address, 1)).toEqual([0x42]);
    chip.dispose();
  });

  it.skipIf(skip)('sequential writes auto-increment the pointer', async () => {
    const { twi, bus, chip, address } = await setup();
    i2cWrite(bus, twi, address, [0x10, 0xAA, 0xBB, 0xCC, 0xDD]);
    i2cWrite(bus, twi, address, [0x10]);
    expect(i2cRead(bus, twi, address, 4)).toEqual([0xAA, 0xBB, 0xCC, 0xDD]);
    chip.dispose();
  });

  it.skipIf(skip)('pointer wraps at 0x80 (128-byte size)', async () => {
    const { twi, bus, chip, address } = await setup();
    i2cWrite(bus, twi, address, [0x7F, 0xEE]);          // last byte
    i2cWrite(bus, twi, address, [0x00, 0x11]);          // first byte
    i2cWrite(bus, twi, address, [0x7F]);
    const out = i2cRead(bus, twi, address, 2);          // reads 0x7F then wraps to 0x00
    expect(out).toEqual([0xEE, 0x11]);
    chip.dispose();
  });

  it.skipIf(skip)('A0=1 makes the chip respond to 0x51 instead of 0x50', async () => {
    const { twi, bus, chip, address } = await setup(0b001);
    expect(address).toBe(0x51);
    // 0x50 should NACK (no chip there), 0x51 should ACK.
    bus.connectToSlave(0x50, false);
    expect(twi.lastAck).toBe(false);
    bus.connectToSlave(0x51, false);
    expect(twi.lastAck).toBe(true);
    bus.stop();
    chip.dispose();
  });
});
