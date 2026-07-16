import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ChipInstance } from '../../src/ChipRuntime.js';
import { PinManager } from '../../src/PinManager.js';
import { I2CBus } from '../../src/I2CBus.js';

/** Fake AVRTWI that captures completion ACKs for assertion. */
function makeFakeTwi() {
  return {
    eventHandler: null,
    lastAck: null,
    lastRead: null,
    completeStart()      {},
    completeStop()       {},
    completeConnect(ack) { this.lastAck = ack; },
    completeWrite(ack)   { this.lastAck = ack; },
    completeRead(value)  { this.lastRead = value; },
  };
}

const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = resolve(here, '../../fixtures/eeprom-24c01.wasm');
const wasmAvailable = existsSync(wasmPath);

const skip = !wasmAvailable;
const note = skip ? '  (skipped — run scripts/compile-all.sh to build eeprom-24c01.wasm)' : '';

describe(`24C01 EEPROM chip — pure I2C protocol E2E${note}`, () => {
  it.skipIf(skip)('writes addr + bytes, then reads back the same bytes from the pointer', async () => {
    const wasm = readFileSync(wasmPath);
    const pm = new PinManager();
    const twi = makeFakeTwi();
    const bus = new I2CBus(twi);

    const wires = new Map([
      ['A0', 10], ['A1', 11], ['A2', 12],
      ['SDA', 13], ['SCL', 14], ['VCC', 1], ['GND', 0], ['WP', 15],
    ]);
    // A0=A1=A2 = LOW → base address 0x50.

    const chip = await ChipInstance.create({ wasm, pinManager: pm, i2cBus: bus, wires });
    chip.start();

    // Write the sequence: pointer=0x10, then 0xAB, 0xCD, 0xEF.
    bus.connectToSlave(0x50, false);   // master writes
    expect(twi.lastAck).toBe(true);
    bus.writeByte(0x10);
    expect(twi.lastAck).toBe(true);
    bus.writeByte(0xAB);
    bus.writeByte(0xCD);
    bus.writeByte(0xEF);
    bus.stop();

    // Read three bytes back. Pointer was left at 0x13 after write, so to read
    // from 0x10 we set the pointer first.
    bus.connectToSlave(0x50, false);
    bus.writeByte(0x10);
    bus.stop();

    bus.connectToSlave(0x50, true);    // master reads
    bus.readByte(true);
    expect(twi.lastRead).toBe(0xAB);
    bus.readByte(true);
    expect(twi.lastRead).toBe(0xCD);
    bus.readByte(false);
    expect(twi.lastRead).toBe(0xEF);
    bus.stop();

    chip.dispose();
  });

  it.skipIf(skip)('two instances at addresses 0x50 and 0x51 do not interfere', async () => {
    const wasm = readFileSync(wasmPath);
    const pm = new PinManager();
    const twi = makeFakeTwi();
    const bus = new I2CBus(twi);

    // First instance: A0=0 → 0x50
    pm.triggerPinChange(20, false);
    const wires1 = new Map([['A0', 20], ['A1', 21], ['A2', 22], ['SDA', 23], ['SCL', 24]]);
    const chip1 = await ChipInstance.create({ wasm, pinManager: pm, i2cBus: bus, wires: wires1 });
    chip1.start();

    // Second instance: A0=1 → 0x51
    pm.triggerPinChange(30, true);
    const wires2 = new Map([['A0', 30], ['A1', 31], ['A2', 32], ['SDA', 33], ['SCL', 34]]);
    const chip2 = await ChipInstance.create({ wasm, pinManager: pm, i2cBus: bus, wires: wires2 });
    chip2.start();

    // Write 0x42 to address 0 of the 0x50 chip.
    bus.connectToSlave(0x50, false);
    bus.writeByte(0x00);
    bus.writeByte(0x42);
    bus.stop();

    // Write 0x99 to address 0 of the 0x51 chip.
    bus.connectToSlave(0x51, false);
    bus.writeByte(0x00);
    bus.writeByte(0x99);
    bus.stop();

    // Read each back independently.
    bus.connectToSlave(0x50, false); bus.writeByte(0x00); bus.stop();
    bus.connectToSlave(0x50, true);  bus.readByte(false);
    expect(twi.lastRead).toBe(0x42);
    bus.stop();

    bus.connectToSlave(0x51, false); bus.writeByte(0x00); bus.stop();
    bus.connectToSlave(0x51, true);  bus.readByte(false);
    expect(twi.lastRead).toBe(0x99);
    bus.stop();

    chip1.dispose();
    chip2.dispose();
  });
});
