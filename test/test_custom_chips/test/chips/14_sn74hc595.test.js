/**
 * TIER 2 — SPI shift register 74HC595.
 * 4 tests covering byte-level transfer, latching, clear, and multi-byte.
 */
import { describe, it, expect } from 'vitest';
import { ChipInstance } from '../../src/ChipRuntime.js';
import { PinManager } from '../../src/PinManager.js';
import { SPIBus } from '../../src/SPIBus.js';
import { loadChipWasm, chipWasmExists } from '../helpers.js';

const skip = !chipWasmExists('sn74hc595');

const PINS = {
  SER: 200, SRCLK: 201, RCLK: 202, SRCLR: 203, OE: 204, QH: 205,
  Q0: 210, Q1: 211, Q2: 212, Q3: 213, Q4: 214, Q5: 215, Q6: 216, Q7: 217,
};

async function setup() {
  const pm = new PinManager();
  const spi = new SPIBus();
  // Power-on: SRCLR HIGH (no clear), Q outputs default LOW.
  pm.triggerPinChange(PINS.SRCLR, true);
  const chip = await ChipInstance.create({
    wasm: loadChipWasm('sn74hc595'),
    pinManager: pm,
    spiBus: spi,
    wires: new Map(Object.entries(PINS)),
  });
  chip.start();
  return { pm, spi, chip };
}

function readQ(pm) {
  return [PINS.Q0,PINS.Q1,PINS.Q2,PINS.Q3,PINS.Q4,PINS.Q5,PINS.Q6,PINS.Q7]
    .map((p) => pm.getPinState(p) ? 1 : 0);
}

function strobe(pm) {
  pm.triggerPinChange(PINS.RCLK, false);
  pm.triggerPinChange(PINS.RCLK, true);
}

describe('TIER 2 — 74HC595 SPI shift register', () => {
  it.skipIf(skip)('shifts a byte over SPI and latches it on RCLK rising edge', async () => {
    const { pm, spi, chip } = await setup();

    // Clock byte 0xA5 = 0b10100101 in via SPI.
    spi.transferByte(0xA5);
    // Pulse RCLK to latch.
    strobe(pm);

    // Q0 = bit 0 of register, Q7 = bit 7.
    expect(readQ(pm)).toEqual([1, 0, 1, 0, 0, 1, 0, 1]);
    chip.dispose();
  });

  it.skipIf(skip)('outputs do not change until RCLK rises', async () => {
    const { pm, spi, chip } = await setup();
    spi.transferByte(0xff);   // shift in 8 high bits
    expect(readQ(pm).every((q) => q === 0)).toBe(true);   // outputs not latched yet
    strobe(pm);
    expect(readQ(pm).every((q) => q === 1)).toBe(true);
    chip.dispose();
  });

  it.skipIf(skip)('SRCLR LOW resets the shift register', async () => {
    const { pm, spi, chip } = await setup();
    spi.transferByte(0xff);
    strobe(pm);
    expect(readQ(pm).every((q) => q === 1)).toBe(true);

    // Pulse SRCLR low.
    pm.triggerPinChange(PINS.SRCLR, false);
    pm.triggerPinChange(PINS.SRCLR, true);
    // Latch the cleared register.
    strobe(pm);
    expect(readQ(pm).every((q) => q === 0)).toBe(true);
    chip.dispose();
  });

  it.skipIf(skip)('multiple SPI bytes overwrite the shift register; only last is latched', async () => {
    const { pm, spi, chip } = await setup();
    spi.transferByte(0x0f);
    spi.transferByte(0xf0);    // overrides
    strobe(pm);
    expect(readQ(pm)).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);   // 0xf0 LSB-first
    chip.dispose();
  });
});
