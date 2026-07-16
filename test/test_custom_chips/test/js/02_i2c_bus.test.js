import { describe, it, expect } from 'vitest';
import { I2CBus } from '../../src/I2CBus.js';

/** Minimal AVRTWI fake — captures completion callbacks. */
function makeFakeTwi() {
  const log = [];
  return {
    eventHandler: null,
    log,
    completeStart()   { log.push(['start']); },
    completeStop()    { log.push(['stop']); },
    completeConnect(ack) { log.push(['connect', ack]); },
    completeWrite(ack)   { log.push(['write', ack]); },
    completeRead(value)  { log.push(['read', value]); },
  };
}

describe('I2CBus — Velxio mirror', () => {
  it('routes connect/write/read/stop to the registered device', () => {
    const twi = makeFakeTwi();
    const bus = new I2CBus(twi);

    const writes = [];
    const device = {
      address: 0x50,
      writeByte: (v) => { writes.push(v); return true; },
      readByte: () => 0xab,
      stop: () => writes.push('stop'),
    };
    bus.addDevice(device);

    bus.start(false);
    bus.connectToSlave(0x50, true);
    bus.writeByte(0x10);
    bus.writeByte(0xff);
    bus.readByte(true);
    bus.stop();

    expect(twi.log).toEqual([
      ['start'],
      ['connect', true],
      ['write', true],
      ['write', true],
      ['read', 0xab],
      ['stop'],
    ]);
    expect(writes).toEqual([0x10, 0xff, 'stop']);
  });

  it('NACKs when no device is registered for the address', () => {
    const twi = makeFakeTwi();
    const bus = new I2CBus(twi);
    bus.connectToSlave(0x77, false);
    expect(twi.log).toEqual([['connect', false]]);
  });

  it('reads 0xff and write false when no active device', () => {
    const twi = makeFakeTwi();
    const bus = new I2CBus(twi);
    bus.connectToSlave(0x99, true);
    bus.writeByte(0x42);
    bus.readByte(false);
    expect(twi.log).toEqual([
      ['connect', false],
      ['write', false],
      ['read', 0xff],
    ]);
  });
});
