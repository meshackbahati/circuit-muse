/**
 * Hoist-safe simulator mock factories.
 *
 * Usage in a test file:
 *
 *   import { vi } from 'vitest';
 *   import { simulatorMocks } from './helpers/hoistedMocks';
 *   const m = vi.hoisted(simulatorMocks);
 *   vi.mock('../simulation/AVRSimulator', () => ({ AVRSimulator: m.AVRSimulator }));
 *   vi.mock('../simulation/RP2040Simulator', () => ({ RP2040Simulator: m.RP2040Simulator }));
 *   ...etc
 *
 * Each call to `simulatorMocks()` returns a fresh batch of `vi.fn()`
 * constructors — because `vi.hoisted` runs at hoist time, before any
 * regular imports are evaluated.
 */

import { vi } from 'vitest';

export const simulatorMocks = () => {
  const AVRSimulator = vi.fn(function (this: any) {
    this.onSerialData = null;
    this.onBaudRateChange = null;
    this.onPinChangeWithTime = null;
    this.start = vi.fn();
    this.stop = vi.fn();
    this.reset = vi.fn();
    this.loadHex = vi.fn();
    this.serialWrite = vi.fn();
    this.feedUart = vi.fn();
    this.addI2CDevice = vi.fn();
    this.setPinState = vi.fn();
  });

  const RP2040Simulator = vi.fn(function (this: any) {
    this.onSerialData = null;
    this.onUartByte = null;
    this.onPinChangeWithTime = null;
    this.start = vi.fn();
    this.stop = vi.fn();
    this.reset = vi.fn();
    this.loadBinary = vi.fn();
    this.serialWrite = vi.fn();
    this.feedUart = vi.fn();
    this.addI2CDevice = vi.fn();
    this.setPinState = vi.fn();
  });

  const RiscVSimulator = vi.fn(function (this: any) {
    this.onSerialData = null;
    this.serialWrite = vi.fn();
    this.feedUart = vi.fn();
    this.start = vi.fn();
    this.stop = vi.fn();
    this.reset = vi.fn();
    this.setPinState = vi.fn();
  });

  const Esp32C3Simulator = vi.fn(function (this: any) {
    this.onSerialData = null;
    this.serialWrite = vi.fn();
    this.feedUart = vi.fn();
    this.start = vi.fn();
    this.stop = vi.fn();
    this.reset = vi.fn();
    this.setPinState = vi.fn();
  });

  const Esp32Bridge = vi.fn(function (this: any, _id: string, _kind: string) {
    this.onSerialData = null;
    this.onPinChange = null;
    this.onPinDir = null;
    this.onCrash = null;
    this.onDisconnected = null;
    this.onWs2812Update = null;
    this.onWifiStatus = null;
    this.onBleStatus = null;
    this.onI2cEvent = null;
    this.onI2cTransaction = null;
    this.onSpiEvent = null;
    this.connect = vi.fn();
    this.disconnect = vi.fn();
    this.connected = true;
    this.sendSerialByte = vi.fn();
    this.sendSerialBytes = vi.fn();
    this.sendPinEvent = vi.fn();
    this.setAdc = vi.fn();
    this.setAdcWaveform = vi.fn();
    this.setI2cResponse = vi.fn();
    this.setSpiResponse = vi.fn();
    this.sendSensorAttach = vi.fn();
    this.sendSensorUpdate = vi.fn();
    this.sendSensorDetach = vi.fn();
  });

  const Esp32BridgeShim = vi.fn(function (this: any) {
    this.onSerialData = null;
    this.serialWrite = vi.fn();
    this.feedUart = vi.fn();
    this.setPinState = vi.fn();
    this.start = vi.fn();
    this.stop = vi.fn();
  });

  const RaspberryPi3Bridge = vi.fn(function (this: any, _id: string) {
    this.onSerialData = null;
    this.onPinChange = null;
    this.onSystemEvent = null;
    this.onError = null;
    this.connect = vi.fn();
    this.disconnect = vi.fn();
    this.connected = true;
    this.sendSerialByte = vi.fn();
    this.sendSerialBytes = vi.fn();
    this.sendPinEvent = vi.fn();
  });

  const VirtualDS1307 = vi.fn(function (this: any) {});
  const VirtualTempSensor = vi.fn(function (this: any) {});
  const I2CMemoryDevice = vi.fn(function (this: any) {});

  const PinManagerStub = vi.fn(function (this: any) {
    this.updatePort = vi.fn();
    this.onPinChange = vi.fn().mockReturnValue(() => {});
    this.triggerPinChange = vi.fn();
    this.getListenersCount = vi.fn().mockReturnValue(0);
  });

  return {
    AVRSimulator,
    RP2040Simulator,
    RiscVSimulator,
    Esp32C3Simulator,
    Esp32Bridge,
    Esp32BridgeShim,
    RaspberryPi3Bridge,
    VirtualDS1307,
    VirtualTempSensor,
    I2CMemoryDevice,
    PinManagerStub,
  };
};
