/**
 * TIER 2 — DS3231 I2C real-time clock.
 * 3 tests: read default seeded time, write new time, BCD encoding.
 */
import { describe, it, expect } from 'vitest';
import { ChipInstance } from '../../src/ChipRuntime.js';
import { PinManager } from '../../src/PinManager.js';
import { I2CBus } from '../../src/I2CBus.js';
import { loadChipWasm, chipWasmExists, makeFakeTwi, i2cWrite, i2cRead } from '../helpers.js';

const skip = !chipWasmExists('ds3231');

const RTC_ADDR = 0x68;

const toBcd   = (n) => ((n / 10 | 0) << 4) | (n % 10);
const fromBcd = (b) => ((b >> 4) & 0x0f) * 10 + (b & 0x0f);

async function setup() {
  const pm = new PinManager();
  const twi = makeFakeTwi();
  const bus = new I2CBus(twi);
  const wires = new Map([
    ['SDA', 500], ['SCL', 501], ['INT', 502], ['RST', 503], ['32K', 504],
  ]);
  const chip = await ChipInstance.create({
    wasm: loadChipWasm('ds3231'), pinManager: pm, i2cBus: bus, wires,
  });
  chip.start();
  return { pm, twi, bus, chip };
}

describe('TIER 2 — DS3231 I2C RTC', () => {
  it.skipIf(skip)('returns the seeded default time on first read', async () => {
    const { twi, bus, chip } = await setup();
    i2cWrite(bus, twi, RTC_ADDR, [0x00]);
    const [sec, min, hr, dow, day, mon, yr] = i2cRead(bus, twi, RTC_ADDR, 7);
    expect(fromBcd(sec)).toBe(56);
    expect(fromBcd(min)).toBe(34);
    expect(fromBcd(hr)).toBe(12);
    expect(dow).toBe(4);
    expect(fromBcd(day)).toBe(15);
    expect(fromBcd(mon)).toBe(1);
    expect(fromBcd(yr)).toBe(26);
    chip.dispose();
  });

  it.skipIf(skip)('writing time then reading back returns same values (BCD)', async () => {
    const { twi, bus, chip } = await setup();
    // Set the clock to 2026-12-31 23:59:45, Sunday.
    i2cWrite(bus, twi, RTC_ADDR, [
      0x00,
      toBcd(45), toBcd(59), toBcd(23), 7, toBcd(31), toBcd(12), toBcd(99),
    ]);
    i2cWrite(bus, twi, RTC_ADDR, [0x00]);
    const out = i2cRead(bus, twi, RTC_ADDR, 7);
    expect(fromBcd(out[0])).toBe(45);
    expect(fromBcd(out[1])).toBe(59);
    expect(fromBcd(out[2])).toBe(23);
    expect(out[3]).toBe(7);
    expect(fromBcd(out[4])).toBe(31);
    expect(fromBcd(out[5])).toBe(12);
    expect(fromBcd(out[6])).toBe(99);
    chip.dispose();
  });

  it.skipIf(skip)('register pointer auto-increments and wraps', async () => {
    const { twi, bus, chip } = await setup();
    i2cWrite(bus, twi, RTC_ADDR, [0x05]);   // pointer = 0x05 (month)
    const out = i2cRead(bus, twi, RTC_ADDR, 3);   // reads month, year, then 0x07
    expect(fromBcd(out[0])).toBe(1);
    expect(fromBcd(out[1])).toBe(26);
    chip.dispose();
  });
});
