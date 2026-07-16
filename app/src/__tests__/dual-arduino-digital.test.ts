/**
 * Two Arduino Unos — raw digital pin propagation across a wire
 * ============================================================
 *
 * Setup: two Arduino Uno boards, wired D7(A) ↔ D7(B).
 * When sketch on A toggles D7 OUTPUT, sketch on B's D7 INPUT must read
 * the same state.
 *
 * Implementation: triggering `pmA.triggerPinChange(7, state)` (which is
 * what AVRSimulator does internally when a sketch writes to PORTD bit 7)
 * must result in `simB.setPinState(7, state)` being called by the
 * Interconnect router.
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

describe('Dual Arduino Uno — digital pin propagation', () => {
  beforeEach(() => {
    fullReset();
  });

  function setupTwoUnosWithDigitalWire(pinA = 'D7', pinB = 'D7') {
    const store = useSimulatorStore.getState();
    const idA = 'arduino-uno';
    const idB = store.addBoard('arduino-uno', 400, 100);
    setWires(useSimulatorStore, [
      { fromBoard: idA, fromPin: pinA, toBoard: idB, toPin: pinB },
      { fromBoard: idA, fromPin: 'GND', toBoard: idB, toPin: 'GND' },
    ]);
    return { idA, idB };
  }

  it('sets up two Unos with a real PinManager each', () => {
    const { idA, idB } = setupTwoUnosWithDigitalWire();
    const pmA = getBoardPinManager(idA);
    const pmB = getBoardPinManager(idB);
    expect(pmA).toBeDefined();
    expect(pmB).toBeDefined();
    expect(pmA).not.toBe(pmB);
    expect(typeof pmA?.triggerPinChange).toBe('function');
    expect(typeof pmA?.onPinChange).toBe('function');
  });

  it('A.D7 HIGH propagates to B.setPinState(7, true)', () => {
    const { idA, idB } = setupTwoUnosWithDigitalWire('D7', 'D7');
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    pmA.triggerPinChange(7, true);
    expect(simB.setPinState).toHaveBeenCalledWith(7, true);
  });

  it('A.D7 LOW propagates to B.setPinState(7, false)', () => {
    const { idA, idB } = setupTwoUnosWithDigitalWire('D7', 'D7');
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    pmA.triggerPinChange(7, true);
    pmA.triggerPinChange(7, false);
    expect(simB.setPinState).toHaveBeenLastCalledWith(7, false);
  });

  it('B.D7 → A.D7 is bidirectional', () => {
    const { idA, idB } = setupTwoUnosWithDigitalWire('D7', 'D7');
    const pmB = getBoardPinManager(idB)!;
    const simA = getBoardSimulator(idA) as any;
    pmB.triggerPinChange(7, true);
    expect(simA.setPinState).toHaveBeenCalledWith(7, true);
  });

  it('different pin numbers across the wire (A.D7 ↔ B.D2)', () => {
    const { idA, idB } = setupTwoUnosWithDigitalWire('D7', 'D2');
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    pmA.triggerPinChange(7, true);
    expect(simB.setPinState).toHaveBeenCalledWith(2, true);
    const calls = (simB.setPinState as any).mock.calls;
    const pin7Calls = calls.filter((c: [number, boolean]) => c[0] === 7);
    expect(pin7Calls.length).toBe(0);
  });

  it('only the pin that changes is propagated — D5 transition does not affect D7', () => {
    const { idA, idB } = setupTwoUnosWithDigitalWire('D7', 'D7');
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    pmA.triggerPinChange(5, true);
    expect(simB.setPinState).not.toHaveBeenCalled();
  });

  it('removing the wire stops propagation', () => {
    const { idA, idB } = setupTwoUnosWithDigitalWire('D7', 'D7');
    useSimulatorStore.setState((s) => ({
      wires: s.wires.filter((w) => !(w.start.pinName === 'D7')),
    }));
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    pmA.triggerPinChange(7, true);
    expect(simB.setPinState).not.toHaveBeenCalled();
  });

  it('GND wires are not used as data channels', () => {
    const { idA, idB } = setupTwoUnosWithDigitalWire('D7', 'D7');
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    pmA.triggerPinChange(-1, true);
    const negCalls = (simB.setPinState as any).mock.calls.filter(
      (c: [number, boolean]) => c[0] === -1,
    );
    expect(negCalls.length).toBe(0);
  });

  it('no infinite loop when both boards toggle the same pin', () => {
    const { idA, idB } = setupTwoUnosWithDigitalWire('D7', 'D7');
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    for (let i = 0; i < 50; i++) {
      pmA.triggerPinChange(7, i % 2 === 0);
    }
    expect((simB.setPinState as any).mock.calls.length).toBeLessThanOrEqual(50);
  });
});
