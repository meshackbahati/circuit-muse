/**
 * TIER 2 — SPI ADC MCP3008.
 * 3 tests: zero voltage, half scale, full scale on different channels.
 */
import { describe, it, expect } from 'vitest';
import { ChipInstance } from '../../src/ChipRuntime.js';
import { PinManager } from '../../src/PinManager.js';
import { SPIBus } from '../../src/SPIBus.js';
import { loadChipWasm, chipWasmExists } from '../helpers.js';

const skip = !chipWasmExists('mcp3008');

const PINS = {
  CS: 300, SCK: 301, MOSI: 302, MISO: 303,
  CH0: 310, CH1: 311, CH2: 312, CH3: 313, CH4: 314, CH5: 315, CH6: 316, CH7: 317,
};

async function setup() {
  const pm = new PinManager();
  const spi = new SPIBus();
  pm.triggerPinChange(PINS.CS, true);  // CS idle HIGH
  const chip = await ChipInstance.create({
    wasm: loadChipWasm('mcp3008'),
    pinManager: pm,
    spiBus: spi,
    wires: new Map(Object.entries(PINS)),
  });
  chip.start();
  return { pm, spi, chip };
}

/**
 * Drive the MCP3008 protocol:
 *   exchange 1: master sends [start=0x01, channel<<4, 0x00] → chip computes
 *   exchange 2: master clocks 3 dummy bytes, gets [0x00, hi, lo] back
 * Returns the 10-bit ADC value.
 */
function readChannel(pm, spi, ch) {
  // Pull CS LOW, then send the request bytes.
  pm.triggerPinChange(PINS.CS, false);
  spi.transferByte(0x01);
  spi.transferByte((ch & 0x07) << 4);
  spi.transferByte(0x00);
  // The chip's on_done set up the response buffer. Clock 3 more bytes to read.
  const r0 = spi.transferByte(0x00);
  const r1 = spi.transferByte(0x00);
  const r2 = spi.transferByte(0x00);
  pm.triggerPinChange(PINS.CS, true);
  // r0 ignored, r1 = upper 2 bits, r2 = lower 8 bits.
  return ((r1 & 0x03) << 8) | (r2 & 0xff);
}

describe('TIER 2 — MCP3008 SPI ADC', () => {
  it.skipIf(skip)('reads 0 from a grounded channel', async () => {
    const { pm, spi, chip } = await setup();
    // PinManager has no analog default → 0 V.
    const value = readChannel(pm, spi, 0);
    expect(value).toBe(0);
    chip.dispose();
  });

  it.skipIf(skip)('reads ~512 from a 2.5V (half-scale) channel', async () => {
    const { pm, spi, chip } = await setup();
    // We use the PWM-as-analog hack in the runtime: PWM duty 0.5 → 2.5 V.
    pm.updatePwm(PINS.CH3, 0.5);
    const value = readChannel(pm, spi, 3);
    expect(value).toBeGreaterThanOrEqual(500);
    expect(value).toBeLessThanOrEqual(524);
    chip.dispose();
  });

  it.skipIf(skip)('reads 1023 from a 5V (full-scale) channel', async () => {
    const { pm, spi, chip } = await setup();
    pm.updatePwm(PINS.CH7, 1.0);
    const value = readChannel(pm, spi, 7);
    expect(value).toBe(1023);
    chip.dispose();
  });
});
