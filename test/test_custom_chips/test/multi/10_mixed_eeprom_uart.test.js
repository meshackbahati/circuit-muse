/**
 * TIER 3 — Heterogeneous chips on the same simulator.
 * One I2C EEPROM and one UART chip, exercised in alternation.
 * Validates the runtime can host different protocol families simultaneously.
 */
import { describe, it, expect } from 'vitest';
import { ChipInstance } from '../../src/ChipRuntime.js';
import { PinManager } from '../../src/PinManager.js';
import { I2CBus } from '../../src/I2CBus.js';
import { loadChipWasm, chipWasmExists, makeFakeTwi, i2cWrite, i2cRead } from '../helpers.js';

const skip = !chipWasmExists('eeprom-24c01') || !chipWasmExists('uart-rot13');

describe('TIER 3 — EEPROM + UART chip running in parallel', () => {
  it.skipIf(skip)('EEPROM stores bytes while UART chip ROT13s in parallel', async () => {
    const pm = new PinManager();
    const twi = makeFakeTwi();
    const bus = new I2CBus(twi);

    const eeprom = await ChipInstance.create({
      wasm: loadChipWasm('eeprom-24c01'), pinManager: pm, i2cBus: bus,
      wires: new Map([['A0',90],['A1',91],['A2',92],['SDA',93],['SCL',94]]),
    });
    eeprom.start();

    const uartChip = await ChipInstance.create({
      wasm: loadChipWasm('uart-rot13'), pinManager: pm,
      wires: new Map([['RX', 100], ['TX', 101]]),
    });
    uartChip.start();

    const tx = [];
    uartChip.onUartTx((b) => tx.push(b));

    // Interleave operations.
    i2cWrite(bus, twi, 0x50, [0x00, 0xDE]);
    'Hello'.split('').forEach((c) => uartChip.feedUart(c.charCodeAt(0)));
    i2cWrite(bus, twi, 0x50, [0x01, 0xAD]);
    'World'.split('').forEach((c) => uartChip.feedUart(c.charCodeAt(0)));

    // Verify EEPROM kept correct state.
    i2cWrite(bus, twi, 0x50, [0x00]);
    expect(i2cRead(bus, twi, 0x50, 2)).toEqual([0xDE, 0xAD]);

    // Verify UART chip's output: ROT13("Hello") + ROT13("World")
    expect(String.fromCharCode(...tx)).toBe('UryybJbeyq');

    eeprom.dispose(); uartChip.dispose();
  });
});
