/**
 * Three Picos in a chain — digital pin propagation
 * =================================================
 *
 * Topology:  P1.GP10 ─ P2.GP11        P2.GP12 ─ P3.GP13
 *
 * Toggling P1.GP10 should reach P2.GP11 (but NOT P3 — no wire on that
 * link).  Toggling P2.GP12 should reach P3.GP13 (but NOT P1).
 *
 * This test guards against an accidental "broadcast to everyone" router.
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

describe('Three Picos in a chain — digital pin propagation respects wire topology', () => {
  beforeEach(() => {
    fullReset();
  });

  function setupChain() {
    const store = useSimulatorStore.getState();
    const p1 = store.addBoard('pi-pico-w', 100, 100);
    const p2 = store.addBoard('pi-pico-w', 400, 100);
    const p3 = store.addBoard('pi-pico-w', 700, 100);
    setWires(useSimulatorStore, [
      { fromBoard: p1, fromPin: 'GP10', toBoard: p2, toPin: 'GP11' },
      { fromBoard: p2, fromPin: 'GP12', toBoard: p3, toPin: 'GP13' },
      // Common ground daisy
      { fromBoard: p1, fromPin: 'GND', toBoard: p2, toPin: 'GND' },
      { fromBoard: p2, fromPin: 'GND', toBoard: p3, toPin: 'GND' },
    ]);
    return { p1, p2, p3 };
  }

  it('P1.GP10 reaches P2.GP11 only', () => {
    const { p1, p2, p3 } = setupChain();
    const pm1 = getBoardPinManager(p1)!;
    const sim2 = getBoardSimulator(p2) as any;
    const sim3 = getBoardSimulator(p3) as any;

    pm1.triggerPinChange(10, true);

    expect(sim2.setPinState).toHaveBeenCalledWith(11, true);
    expect(sim3.setPinState).not.toHaveBeenCalled();
  });

  it('P2.GP12 reaches P3.GP13 only (not P1)', () => {
    const { p1, p2, p3 } = setupChain();
    const pm2 = getBoardPinManager(p2)!;
    const sim1 = getBoardSimulator(p1) as any;
    const sim3 = getBoardSimulator(p3) as any;

    pm2.triggerPinChange(12, true);

    expect(sim3.setPinState).toHaveBeenCalledWith(13, true);
    expect(sim1.setPinState).not.toHaveBeenCalled();
  });

  it('P2.GP11 (the receiving end of P1↔P2 wire) propagates back to P1.GP10 — bidirectional', () => {
    const { p1, p2 } = setupChain();
    const pm2 = getBoardPinManager(p2)!;
    const sim1 = getBoardSimulator(p1) as any;
    pm2.triggerPinChange(11, true);
    expect(sim1.setPinState).toHaveBeenCalledWith(10, true);
  });
});
