/**
 * TIER 3 — Multiple chips: two 24C01 EEPROMs at different I2C addresses.
 * 2 tests proving independent state and address-pin selection.
 */
import { describe, it, expect } from 'vitest';
import { ChipInstance } from '../../src/ChipRuntime.js';
import { PinManager } from '../../src/PinManager.js';
import { I2CBus } from '../../src/I2CBus.js';
import { loadChipWasm, chipWasmExists, makeFakeTwi, i2cWrite, i2cRead } from '../helpers.js';

const skip = !chipWasmExists('eeprom-24c01');

describe('TIER 3 — Two 24C01 EEPROMs on the same I2C bus', () => {
  it.skipIf(skip)('addresses 0x50 and 0x51 hold independent contents', async () => {
    const pm = new PinManager();
    const twi = makeFakeTwi();
    const bus = new I2CBus(twi);
    const wasm = loadChipWasm('eeprom-24c01');

    // Chip at 0x50: A0 LOW
    pm.triggerPinChange(40, false); pm.triggerPinChange(41, false); pm.triggerPinChange(42, false);
    const c1 = await ChipInstance.create({ wasm, pinManager: pm, i2cBus: bus,
      wires: new Map([['A0',40],['A1',41],['A2',42],['SDA',43],['SCL',44]]) });
    c1.start();

    // Chip at 0x51: A0 HIGH
    pm.triggerPinChange(50, true); pm.triggerPinChange(51, false); pm.triggerPinChange(52, false);
    const c2 = await ChipInstance.create({ wasm, pinManager: pm, i2cBus: bus,
      wires: new Map([['A0',50],['A1',51],['A2',52],['SDA',53],['SCL',54]]) });
    c2.start();

    i2cWrite(bus, twi, 0x50, [0x00, 0xAA, 0xBB]);
    i2cWrite(bus, twi, 0x51, [0x00, 0xCC, 0xDD]);

    i2cWrite(bus, twi, 0x50, [0x00]);
    expect(i2cRead(bus, twi, 0x50, 2)).toEqual([0xAA, 0xBB]);
    i2cWrite(bus, twi, 0x51, [0x00]);
    expect(i2cRead(bus, twi, 0x51, 2)).toEqual([0xCC, 0xDD]);

    c1.dispose(); c2.dispose();
  });

  it.skipIf(skip)('NACKs every address that does not match either chip', async () => {
    const pm = new PinManager();
    const twi = makeFakeTwi();
    const bus = new I2CBus(twi);
    const wasm = loadChipWasm('eeprom-24c01');

    pm.triggerPinChange(60, false);
    const c1 = await ChipInstance.create({ wasm, pinManager: pm, i2cBus: bus,
      wires: new Map([['A0',60],['A1',61],['A2',62],['SDA',63],['SCL',64]]) });
    c1.start();
    pm.triggerPinChange(70, true);
    const c2 = await ChipInstance.create({ wasm, pinManager: pm, i2cBus: bus,
      wires: new Map([['A0',70],['A1',71],['A2',72],['SDA',73],['SCL',74]]) });
    c2.start();

    for (const addr of [0x52, 0x53, 0x54, 0x68, 0x77]) {
      bus.connectToSlave(addr, false);
      expect(twi.lastAck).toBe(false);
    }
    bus.connectToSlave(0x50, false); expect(twi.lastAck).toBe(true);
    bus.connectToSlave(0x51, false); expect(twi.lastAck).toBe(true);
    bus.stop();

    c1.dispose(); c2.dispose();
  });
});
