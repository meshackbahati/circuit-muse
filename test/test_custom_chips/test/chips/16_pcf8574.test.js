/**
 * TIER 2 — I2C 8-bit IO expander PCF8574.
 * 4 tests: write→read, P0..P7 pin states, address pin selection, NACK other addresses.
 */
import { describe, it, expect } from 'vitest';
import { ChipInstance } from '../../src/ChipRuntime.js';
import { PinManager } from '../../src/PinManager.js';
import { I2CBus } from '../../src/I2CBus.js';
import { loadChipWasm, chipWasmExists, makeFakeTwi, i2cWrite, i2cRead } from '../helpers.js';

const skip = !chipWasmExists('pcf8574');

const PINS = {
  A0: 400, A1: 401, A2: 402, INT: 403,
  P0: 410, P1: 411, P2: 412, P3: 413, P4: 414, P5: 415, P6: 416, P7: 417,
  SCL: 420, SDA: 421,
};

async function setup(addrBits = 0b000) {
  const pm = new PinManager();
  const twi = makeFakeTwi();
  const bus = new I2CBus(twi);
  pm.triggerPinChange(PINS.A0, (addrBits & 1) !== 0);
  pm.triggerPinChange(PINS.A1, (addrBits & 2) !== 0);
  pm.triggerPinChange(PINS.A2, (addrBits & 4) !== 0);
  const chip = await ChipInstance.create({
    wasm: loadChipWasm('pcf8574'), pinManager: pm, i2cBus: bus,
    wires: new Map(Object.entries(PINS)),
  });
  chip.start();
  return { pm, twi, bus, chip, address: 0x20 | addrBits };
}

describe('TIER 2 — PCF8574 I2C 8-bit I/O expander', () => {
  it.skipIf(skip)('writing 0xA5 sets P0..P7 to that bit pattern', async () => {
    const { pm, twi, bus, chip, address } = await setup();
    i2cWrite(bus, twi, address, [0xA5]);
    expect([
      pm.getPinState(PINS.P0) ? 1 : 0,
      pm.getPinState(PINS.P1) ? 1 : 0,
      pm.getPinState(PINS.P2) ? 1 : 0,
      pm.getPinState(PINS.P3) ? 1 : 0,
      pm.getPinState(PINS.P4) ? 1 : 0,
      pm.getPinState(PINS.P5) ? 1 : 0,
      pm.getPinState(PINS.P6) ? 1 : 0,
      pm.getPinState(PINS.P7) ? 1 : 0,
    ]).toEqual([1, 0, 1, 0, 0, 1, 0, 1]);
    chip.dispose();
  });

  it.skipIf(skip)('reading returns the current line state', async () => {
    const { twi, bus, chip, address } = await setup();
    i2cWrite(bus, twi, address, [0xff]);
    expect(i2cRead(bus, twi, address, 1)).toEqual([0xff]);
    i2cWrite(bus, twi, address, [0x00]);
    expect(i2cRead(bus, twi, address, 1)).toEqual([0x00]);
    chip.dispose();
  });

  it.skipIf(skip)('A0=A1=1 makes the chip respond to 0x23', async () => {
    const { twi, bus, chip, address } = await setup(0b011);
    expect(address).toBe(0x23);
    bus.connectToSlave(0x20, false);
    expect(twi.lastAck).toBe(false);
    bus.connectToSlave(0x23, false);
    expect(twi.lastAck).toBe(true);
    bus.stop();
    chip.dispose();
  });

  it.skipIf(skip)('writes are persistent across reads (latched output)', async () => {
    const { pm, twi, bus, chip, address } = await setup();
    i2cWrite(bus, twi, address, [0x42]);
    // Read multiple times — value should remain 0x42.
    expect(i2cRead(bus, twi, address, 1)).toEqual([0x42]);
    expect(i2cRead(bus, twi, address, 1)).toEqual([0x42]);
    expect(pm.getPinState(PINS.P1)).toBe(true);   // bit 1 of 0x42 set
    chip.dispose();
  });
});
