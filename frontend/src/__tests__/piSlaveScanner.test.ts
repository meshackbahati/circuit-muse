/**
 * Tests for piSlaveScanner — verifies that canvas wires from a Pi
 * board's protocol pins to a known I2C/SPI/UART component result in
 * the right pi_attach_slave frames.
 */
import { describe, it, expect, vi } from 'vitest';

import { attachSlavesFromCanvas } from '../simulation/piSlaveScanner';

function makeBridge() {
  return { attachSlave: vi.fn() };
}

const PI_ID = 'raspberry-pi-3';

describe('attachSlavesFromCanvas', () => {
  it('attaches a BMP280 wired via SDA/SCL on bus 1', () => {
    const bridge = makeBridge();
    const components = [
      { id: 'bmp1', metadataId: 'wokwi-bmp280', properties: {} },
    ];
    const wires = [
      { start: { componentId: PI_ID,  pinName: '3' },
        end:   { componentId: 'bmp1', pinName: 'SDA' } },
      { start: { componentId: PI_ID,  pinName: '5' },
        end:   { componentId: 'bmp1', pinName: 'SCL' } },
    ];

    const emitted = attachSlavesFromCanvas(PI_ID, bridge, components, wires);
    expect(emitted).toHaveLength(1);
    expect(bridge.attachSlave).toHaveBeenCalledTimes(1);
    expect(emitted[0]).toMatchObject({
      bus_kind: 'i2c',
      bus_num: 1,
      address: 0x76,
      model_id: 'bme280',
    });
  });

  it('uses the address property when set', () => {
    const bridge = makeBridge();
    const components = [
      { id: 'bmp1', metadataId: 'wokwi-bmp280',
        properties: { address: 0x77 } },
    ];
    const wires = [
      { start: { componentId: PI_ID, pinName: '3' },
        end:   { componentId: 'bmp1', pinName: 'SDA' } },
    ];
    attachSlavesFromCanvas(PI_ID, bridge, components, wires);
    expect(bridge.attachSlave).toHaveBeenCalledWith(
      expect.objectContaining({ address: 0x77 }),
    );
  });

  it('skips unknown components silently', () => {
    const bridge = makeBridge();
    const components = [
      { id: 'led1', metadataId: 'wokwi-led', properties: {} },
    ];
    const wires = [
      { start: { componentId: PI_ID, pinName: '3' },
        end:   { componentId: 'led1', pinName: 'A' } },
    ];
    attachSlavesFromCanvas(PI_ID, bridge, components, wires);
    expect(bridge.attachSlave).not.toHaveBeenCalled();
  });

  it('skips wires that do not touch the Pi', () => {
    const bridge = makeBridge();
    const components = [
      { id: 'bmp1', metadataId: 'wokwi-bmp280', properties: {} },
      { id: 'arduino', metadataId: 'wokwi-arduino-uno', properties: {} },
    ];
    const wires = [
      { start: { componentId: 'arduino', pinName: 'A4' },
        end:   { componentId: 'bmp1',    pinName: 'SDA' } },
    ];
    attachSlavesFromCanvas(PI_ID, bridge, components, wires);
    expect(bridge.attachSlave).not.toHaveBeenCalled();
  });

  it('dedupes when multiple wires hit the same slave', () => {
    const bridge = makeBridge();
    const components = [
      { id: 'bmp1', metadataId: 'wokwi-bmp280', properties: {} },
    ];
    // SDA + SCL both wired — should still produce a single attach.
    const wires = [
      { start: { componentId: PI_ID, pinName: '3' },
        end:   { componentId: 'bmp1', pinName: 'SDA' } },
      { start: { componentId: 'bmp1', pinName: 'SCL' },
        end:   { componentId: PI_ID,  pinName: '5' } },
    ];
    attachSlavesFromCanvas(PI_ID, bridge, components, wires);
    expect(bridge.attachSlave).toHaveBeenCalledTimes(1);
  });

  it('forwards temperature/humidity/pressure props as config', () => {
    const bridge = makeBridge();
    const components = [
      { id: 'bmp1', metadataId: 'wokwi-bmp280',
        properties: {
          temperature_c: 21.5,
          humidity_pct:  55,
          pressure_pa:   99000,
          color:         'red',   // unrelated key, dropped
        } },
    ];
    const wires = [
      { start: { componentId: PI_ID, pinName: '3' },
        end:   { componentId: 'bmp1', pinName: 'SDA' } },
    ];
    attachSlavesFromCanvas(PI_ID, bridge, components, wires);
    expect(bridge.attachSlave).toHaveBeenCalledWith(
      expect.objectContaining({
        config: { temperature_c: 21.5, humidity_pct: 55, pressure_pa: 99000 },
      }),
    );
  });

  it('attaches SPI peer on CE0 when present', () => {
    const bridge = makeBridge();
    // Only CE0 wire is enough to identify the slave; MOSI/MISO/SCLK
    // wires are informational. (Re-uses BMP280 mapping since we
    // don't have a real SPI model in the registry yet — adapt this
    // test when an actual SPI slave model is added.)
    const components = [
      { id: 'flash', metadataId: 'wokwi-bmp280', properties: {} },
    ];
    const wires = [
      { start: { componentId: PI_ID,    pinName: '24' },   // CE0
        end:   { componentId: 'flash',  pinName: 'CS' } },
    ];
    attachSlavesFromCanvas(PI_ID, bridge, components, wires);
    expect(bridge.attachSlave).toHaveBeenCalledTimes(1);
    expect(bridge.attachSlave).toHaveBeenCalledWith(
      expect.objectContaining({ bus_kind: 'spi', bus_num: 0, cs: 0 }),
    );
  });

  it('does not attach SPI peer when only data lines (no CE) are wired', () => {
    const bridge = makeBridge();
    const components = [
      { id: 'flash', metadataId: 'wokwi-bmp280', properties: {} },
    ];
    const wires = [
      // MOSI only — no CE — should not attach.
      { start: { componentId: PI_ID,   pinName: '19' },
        end:   { componentId: 'flash', pinName: 'MOSI' } },
    ];
    attachSlavesFromCanvas(PI_ID, bridge, components, wires);
    expect(bridge.attachSlave).not.toHaveBeenCalled();
  });
});
