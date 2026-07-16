/**
 * Two Raspberry Pi Pico W — raw digital pin propagation
 * =====================================================
 *
 * Setup: two Pi Pico W boards, wired GP15(A) ↔ GP15(B).
 * `digitalWrite(GP15)` on A → `digitalRead(GP15)` on B sees the same state.
 *
 * Same pin-propagation contract as the Uno↔Uno case, but for RP2040.
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

describe('Dual Raspberry Pi Pico W — digital pin propagation', () => {
  beforeEach(() => {
    fullReset();
  });

  function setupTwoPicosWithDigitalWire(pinA = 'GP15', pinB = 'GP15') {
    const store = useSimulatorStore.getState();
    const idA = store.addBoard('pi-pico-w', 100, 100);
    const idB = store.addBoard('pi-pico-w', 400, 100);
    setWires(useSimulatorStore, [
      { fromBoard: idA, fromPin: pinA, toBoard: idB, toPin: pinB },
      { fromBoard: idA, fromPin: 'GND', toBoard: idB, toPin: 'GND' },
    ]);
    return { idA, idB };
  }

  it('A.GP15 HIGH → B.setPinState(15, true)', () => {
    const { idA, idB } = setupTwoPicosWithDigitalWire('GP15', 'GP15');
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    pmA.triggerPinChange(15, true);
    expect(simB.setPinState).toHaveBeenCalledWith(15, true);
  });

  it('B.GP15 HIGH → A.setPinState(15, true)', () => {
    const { idA, idB } = setupTwoPicosWithDigitalWire('GP15', 'GP15');
    const pmB = getBoardPinManager(idB)!;
    const simA = getBoardSimulator(idA) as any;
    pmB.triggerPinChange(15, true);
    expect(simA.setPinState).toHaveBeenCalledWith(15, true);
  });

  it('cross pins on Pico (A.GP10 ↔ B.GP20) work', () => {
    const { idA, idB } = setupTwoPicosWithDigitalWire('GP10', 'GP20');
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    pmA.triggerPinChange(10, true);
    expect(simB.setPinState).toHaveBeenCalledWith(20, true);
  });

  it('rapid toggle survives without unbounded re-entry', () => {
    const { idA, idB } = setupTwoPicosWithDigitalWire('GP15', 'GP15');
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    for (let i = 0; i < 100; i++) pmA.triggerPinChange(15, i % 2 === 0);
    expect((simB.setPinState as any).mock.calls.length).toBeLessThanOrEqual(100);
  });

  it('two boards but no wire — no propagation', () => {
    const store = useSimulatorStore.getState();
    const idA = store.addBoard('pi-pico-w', 100, 100);
    const idB = store.addBoard('pi-pico-w', 400, 100);
    // No wire setup
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    pmA.triggerPinChange(15, true);
    expect(simB.setPinState).not.toHaveBeenCalled();
  });
});
