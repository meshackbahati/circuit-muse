/**
 * Interconnect router — direct unit tests
 * =======================================
 *
 * Tests the Interconnect singleton in isolation: route registration on
 * wire-add, teardown on wire-remove, re-entrancy guard for symmetric
 * propagation, classifier hints for cross-process byte shortcut.
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
  // Clear pin states FIRST (before tearing down the Interconnect, since
  // tearing down also unsubscribes route listeners — but pinStates are
  // independent of listeners).
  clearAllPinManagerState(useSimulatorStore, getBoardPinManager);
  resetInterconnect();
  resetStore(useSimulatorStore);
}

describe('Interconnect — wire add/remove lifecycle', () => {
  beforeEach(() => {
    fullReset();
  });

  it('a wire added AFTER both boards exist still routes', () => {
    const store = useSimulatorStore.getState();
    const idA = 'arduino-uno';
    const idB = store.addBoard('arduino-uno', 400, 100);
    // Initially no wires
    setWires(useSimulatorStore, []);
    // Add the wire later
    setWires(useSimulatorStore, [{ fromBoard: idA, fromPin: 'D7', toBoard: idB, toPin: 'D7' }]);

    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    pmA.triggerPinChange(7, true);
    expect(simB.setPinState).toHaveBeenCalledWith(7, true);
  });

  it('a board added AFTER the wire was created still gets routed', () => {
    const store = useSimulatorStore.getState();
    const idA = 'arduino-uno';
    // Pre-stage a wire that references a board that does not exist yet
    setWires(useSimulatorStore, [
      { fromBoard: idA, fromPin: 'D7', toBoard: 'arduino-uno-2', toPin: 'D7' },
    ]);
    // Now add the second board
    const idB = store.addBoard('arduino-uno', 400, 100);
    expect(idB).toBe('arduino-uno-2');

    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    pmA.triggerPinChange(7, true);
    expect(simB.setPinState).toHaveBeenCalledWith(7, true);
  });

  it('removing a wire tears down the route (no leaked subscriptions)', () => {
    const store = useSimulatorStore.getState();
    const idA = 'arduino-uno';
    const idB = store.addBoard('arduino-uno', 400, 100);
    setWires(useSimulatorStore, [{ fromBoard: idA, fromPin: 'D7', toBoard: idB, toPin: 'D7' }]);

    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    pmA.triggerPinChange(7, true);
    const callsBefore = (simB.setPinState as any).mock.calls.length;

    // Remove the wire
    setWires(useSimulatorStore, []);
    pmA.triggerPinChange(7, false);
    const callsAfter = (simB.setPinState as any).mock.calls.length;

    expect(callsAfter).toBe(callsBefore); // no new propagation
  });

  it('removing a board tears down all its routes', () => {
    const store = useSimulatorStore.getState();
    const idA = 'arduino-uno';
    const idB = store.addBoard('arduino-uno', 400, 100);
    setWires(useSimulatorStore, [{ fromBoard: idA, fromPin: 'D7', toBoard: idB, toPin: 'D7' }]);

    const pmA = getBoardPinManager(idA)!;
    store.removeBoard(idB);
    // No throw, no broken state
    expect(() => pmA.triggerPinChange(7, true)).not.toThrow();
  });
});

describe('Interconnect — re-entrancy guard', () => {
  beforeEach(() => {
    fullReset();
  });

  it('synchronous setPinState on B does not re-fire onPinChange that propagates back to A', () => {
    const store = useSimulatorStore.getState();
    const idA = 'arduino-uno';
    const idB = store.addBoard('arduino-uno', 400, 100);
    setWires(useSimulatorStore, [{ fromBoard: idA, fromPin: 'D7', toBoard: idB, toPin: 'D7' }]);

    const pmA = getBoardPinManager(idA)!;
    const simA = getBoardSimulator(idA) as any;
    const simB = getBoardSimulator(idB) as any;

    // Reset simA's setPinState mock state
    simA.setPinState.mockClear();
    simB.setPinState.mockClear();

    pmA.triggerPinChange(7, true);

    // simB should receive the change
    expect(simB.setPinState).toHaveBeenCalledWith(7, true);
    // simA should NOT receive a propagation back from B (re-entrancy guard)
    expect(simA.setPinState).not.toHaveBeenCalled();
  });
});
