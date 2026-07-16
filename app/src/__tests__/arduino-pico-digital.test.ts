/**
 * Mixed Arduino Uno + Pi Pico — digital pin propagation across kinds
 * ==================================================================
 *
 * Wire: Uno.D7 ↔ Pico.GP15.  Toggling D7 on the Uno sketch should reach
 * GP15 on the Pico, and vice versa.
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

describe('Arduino Uno ↔ Raspberry Pi Pico — digital pin propagation', () => {
  beforeEach(() => {
    fullReset();
  });

  function setupMixed() {
    const store = useSimulatorStore.getState();
    const unoId = 'arduino-uno'; // default board
    const picoId = store.addBoard('pi-pico-w', 400, 100);
    setWires(useSimulatorStore, [
      { fromBoard: unoId, fromPin: 'D7', toBoard: picoId, toPin: 'GP15' },
      { fromBoard: unoId, fromPin: 'GND', toBoard: picoId, toPin: 'GND' },
    ]);
    return { unoId, picoId };
  }

  it('Uno.D7 → Pico.setPinState(15, true)', () => {
    const { unoId, picoId } = setupMixed();
    const pmUno = getBoardPinManager(unoId)!;
    const simPico = getBoardSimulator(picoId) as any;
    pmUno.triggerPinChange(7, true);
    expect(simPico.setPinState).toHaveBeenCalledWith(15, true);
  });

  it('Pico.GP15 → Uno.setPinState(7, true)', () => {
    const { unoId, picoId } = setupMixed();
    const pmPico = getBoardPinManager(picoId)!;
    const simUno = getBoardSimulator(unoId) as any;
    pmPico.triggerPinChange(15, true);
    expect(simUno.setPinState).toHaveBeenCalledWith(7, true);
  });

  it('numeric pin name "7" on Uno is interpreted same as "D7"', () => {
    const store = useSimulatorStore.getState();
    const unoId = 'arduino-uno';
    const picoId = store.addBoard('pi-pico-w', 400, 100);
    setWires(useSimulatorStore, [
      { fromBoard: unoId, fromPin: '7', toBoard: picoId, toPin: 'GP15' },
    ]);
    const pmUno = getBoardPinManager(unoId)!;
    const simPico = getBoardSimulator(picoId) as any;
    pmUno.triggerPinChange(7, true);
    expect(simPico.setPinState).toHaveBeenCalledWith(15, true);
  });
});
