/**
 * Two Arduino Unos — SPI master/slave
 * ===================================
 *
 * Uno SPI pins: SCK=D13, MISO=D12, MOSI=D11, SS=D10.
 *
 * Wire: A.D13(SCK) ↔ B.D13(SCK), A.D11(MOSI) ↔ B.D11(MOSI),
 *       B.D12(MISO) ↔ A.D12(MISO), A.D10(SS) ↔ B.D10(SS).
 *
 * As with I2C, pin-level propagation handles SPI clock + data lines
 * directly. Each board's SPI peripheral sees the actual transitions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../simulation/AVRSimulator', () => ({
  AVRSimulator: vi.fn(function (this: any) {
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
  }),
}));
vi.mock('../simulation/RP2040Simulator', () => ({
  RP2040Simulator: vi.fn(function (this: any) {
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
    this.attachCyw43 = vi.fn();
    this.spi = { onByte: null, completeTransfer: vi.fn() };
  }),
}));
vi.mock('../simulation/RiscVSimulator', () => ({
  RiscVSimulator: vi.fn(function (this: any) {
    this.onSerialData = null;
    this.serialWrite = vi.fn();
    this.feedUart = vi.fn();
    this.start = vi.fn();
    this.stop = vi.fn();
    this.reset = vi.fn();
    this.setPinState = vi.fn();
  }),
}));
vi.mock('../simulation/Esp32C3Simulator', () => ({
  Esp32C3Simulator: vi.fn(function (this: any) {
    this.onSerialData = null;
    this.serialWrite = vi.fn();
    this.feedUart = vi.fn();
    this.start = vi.fn();
    this.stop = vi.fn();
    this.reset = vi.fn();
    this.setPinState = vi.fn();
  }),
}));
vi.mock('../simulation/Esp32Bridge', () => ({
  Esp32Bridge: vi.fn(function (this: any, _id: string, _kind: string) {
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
  }),
  Esp32BridgeShim: vi.fn(function (this: any) {
    this.onSerialData = null;
    this.serialWrite = vi.fn();
    this.feedUart = vi.fn();
    this.setPinState = vi.fn();
    this.start = vi.fn();
    this.stop = vi.fn();
  }),
}));
vi.mock('../simulation/RaspberryPi3Bridge', () => ({
  RaspberryPi3Bridge: vi.fn(function (this: any, _id: string) {
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
  }),
}));
vi.mock('../simulation/I2CBusManager', async () => {
  const actual = await vi.importActual<typeof import('../simulation/I2CBusManager')>(
    '../simulation/I2CBusManager',
  );
  return actual;
});
vi.mock('../store/useOscilloscopeStore', () => ({
  useOscilloscopeStore: {
    getState: vi.fn().mockReturnValue({ channels: [], pushSample: vi.fn() }),
  },
}));
vi.stubGlobal('requestAnimationFrame', (_cb: FrameRequestCallback) => 1);
vi.stubGlobal('cancelAnimationFrame', vi.fn());

import { setWires, resetStore, clearAllPinManagerState } from './helpers/multiBoardSetup';
import { resetInterconnect } from '../simulation/Interconnect';

import {
  useSimulatorStore,
  getBoardSimulator,
  getBoardPinManager,
} from '../store/useSimulatorStore';

function fullReset() {
  clearAllPinManagerState(useSimulatorStore, getBoardPinManager);
  resetInterconnect();
  resetStore(useSimulatorStore);
}

describe('Dual Arduino Uno — SPI pin-level propagation', () => {
  beforeEach(() => {
    fullReset();
  });

  function setupSpi() {
    const store = useSimulatorStore.getState();
    const idA = 'arduino-uno';
    const idB = store.addBoard('arduino-uno', 400, 100);
    setWires(useSimulatorStore, [
      { fromBoard: idA, fromPin: 'D13', toBoard: idB, toPin: 'D13' }, // SCK
      { fromBoard: idA, fromPin: 'D11', toBoard: idB, toPin: 'D11' }, // MOSI
      { fromBoard: idB, fromPin: 'D12', toBoard: idA, toPin: 'D12' }, // MISO (slave→master)
      { fromBoard: idA, fromPin: 'D10', toBoard: idB, toPin: 'D10' }, // SS / CS
      { fromBoard: idA, fromPin: 'GND', toBoard: idB, toPin: 'GND' },
    ]);
    return { idA, idB };
  }

  it('SCK pulse from master propagates to slave', () => {
    const { idA, idB } = setupSpi();
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    pmA.triggerPinChange(13, true);
    pmA.triggerPinChange(13, false);
    expect(simB.setPinState).toHaveBeenCalledWith(13, true);
    expect(simB.setPinState).toHaveBeenCalledWith(13, false);
  });

  it('MOSI bit from master reaches slave', () => {
    const { idA, idB } = setupSpi();
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    pmA.triggerPinChange(11, true);
    expect(simB.setPinState).toHaveBeenCalledWith(11, true);
  });

  it('MISO bit from slave reaches master (reverse direction)', () => {
    const { idA, idB } = setupSpi();
    const pmB = getBoardPinManager(idB)!;
    const simA = getBoardSimulator(idA) as any;
    pmB.triggerPinChange(12, true);
    expect(simA.setPinState).toHaveBeenCalledWith(12, true);
  });

  it('SS toggle (chip select) propagates', () => {
    const { idA, idB } = setupSpi();
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    pmA.triggerPinChange(10, false); // master asserts CS LOW
    expect(simB.setPinState).toHaveBeenCalledWith(10, false);
  });
});
