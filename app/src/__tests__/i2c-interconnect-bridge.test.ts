/**
 * i2c-interconnect-bridge.test.ts
 *
 * End-to-end coverage of the cross-board I2C bridge installed by
 * Interconnect when a wired (SDA, SCL) pair connects two boards.
 *
 * Each board's I2CBusManager is constructed up-front (with a
 * placeholder master) so Interconnect can attach bridges before any
 * firmware loads.  The store wires real `AVRSimulator` /
 * `RP2040Simulator` instances per board; the bridge then plugs the
 * two `I2CBusManager`s together.
 *
 * These tests focus on Interconnect's bridge install / teardown
 * lifecycle.  The per-bus transaction routing is covered by
 * i2c-multi-board-slave-gap.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const busFactories = vi.hoisted(() => {
  return {
    // Built lazily once vi resolves modules — keeps the hoisted
    // factory free of top-level imports while still being able to
    // construct real I2CBusManager instances per board.
    make: null as null | ((channels: number) => unknown[]),
  };
});

vi.mock('../simulation/I2CBusManager', async () => {
  const actual = await vi.importActual<typeof import('../simulation/I2CBusManager')>(
    '../simulation/I2CBusManager',
  );
  busFactories.make = (channels: number) =>
    Array.from(
      { length: channels },
      () => new actual.I2CBusManager(actual.nullI2CMaster()),
    ) as unknown[];
  return actual;
});

vi.mock('../simulation/AVRSimulator', () => ({
  AVRSimulator: vi.fn(function (this: any) {
    this.onSerialData = null;
    this.start = vi.fn();
    this.stop = vi.fn();
    this.reset = vi.fn();
    this.loadHex = vi.fn();
    this.setPinState = vi.fn();
    const [bus] = busFactories.make!(1) as any[];
    this.i2cBus = bus;
    this.getI2CBus = () => this.i2cBus;
    this.addI2CDevice = (d: any) => this.i2cBus.addDevice(d);
    this.removeI2CDevice = (a: number) => this.i2cBus.removeDevice(a);
  }),
}));

vi.mock('../simulation/RP2040Simulator', () => ({
  RP2040Simulator: vi.fn(function (this: any) {
    this.onSerialData = null;
    this.start = vi.fn();
    this.stop = vi.fn();
    this.reset = vi.fn();
    this.loadBinary = vi.fn();
    this.setPinState = vi.fn();
    this.attachCyw43 = vi.fn();
    this.spi = { onByte: null, completeTransfer: vi.fn() };
    const buses = busFactories.make!(2) as any[];
    this.getI2CBus = (bus: 0 | 1 = 0) => buses[bus];
    this.addI2CDevice = (d: any, bus: 0 | 1 = 0) => buses[bus].addDevice(d);
    this.removeI2CDevice = (a: number, bus: 0 | 1 = 0) => buses[bus].removeDevice(a);
  }),
}));
vi.mock('../simulation/RiscVSimulator', () => ({
  RiscVSimulator: vi.fn(function (this: any) {
    this.onSerialData = null;
    this.start = vi.fn();
    this.stop = vi.fn();
    this.reset = vi.fn();
    this.setPinState = vi.fn();
  }),
}));
vi.mock('../simulation/Esp32C3Simulator', () => ({
  Esp32C3Simulator: vi.fn(function (this: any) {
    this.onSerialData = null;
    this.start = vi.fn();
    this.stop = vi.fn();
    this.reset = vi.fn();
    this.setPinState = vi.fn();
  }),
}));
vi.mock('../simulation/Esp32Bridge', () => ({
  Esp32Bridge: vi.fn(function (this: any) {
    this.onSerialData = null;
    this.onPinChange = null;
    this.connect = vi.fn();
    this.disconnect = vi.fn();
    this.connected = true;
    this.sendSerialBytes = vi.fn();
    this.sendPinEvent = vi.fn();
  }),
  Esp32BridgeShim: vi.fn(function (this: any) {
    this.onSerialData = null;
    this.serialWrite = vi.fn();
    this.feedUart = vi.fn();
    this.setPinState = vi.fn();
  }),
}));
vi.mock('../simulation/RaspberryPi3Bridge', () => ({
  RaspberryPi3Bridge: vi.fn(function (this: any) {
    this.onSerialData = null;
    this.onPinChange = null;
    this.connect = vi.fn();
    this.disconnect = vi.fn();
    this.connected = true;
    this.sendSerialBytes = vi.fn();
    this.sendPinEvent = vi.fn();
  }),
}));
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
import { I2CMemoryDevice } from '../simulation/I2CBusManager';

function fullReset() {
  clearAllPinManagerState(useSimulatorStore, getBoardPinManager);
  resetInterconnect();
  resetStore(useSimulatorStore);
}

describe('Interconnect — auto-installs I2C bridge for (SDA, SCL) wire pairs', () => {
  beforeEach(() => {
    fullReset();
  });

  it('two Arduino Unos wired SDA+SCL share a single I2C bus', () => {
    const store = useSimulatorStore.getState();
    const unoA = 'arduino-uno';
    const unoB = store.addBoard('arduino-uno', 400, 100);

    // Register a virtual device on board B at 0x42.
    const simB = getBoardSimulator(unoB) as any;
    const deviceB = new I2CMemoryDevice(0x42);
    simB.getI2CBus(0).addDevice(deviceB);

    // Wire SDA (A4 = pin 18) and SCL (A5 = pin 19) between the boards.
    setWires(useSimulatorStore, [
      { fromBoard: unoA, fromPin: 'A4', toBoard: unoB, toPin: 'A4' },
      { fromBoard: unoA, fromPin: 'A5', toBoard: unoB, toPin: 'A5' },
    ]);

    // Now board A's master should reach device 0x42 on board B
    // via the auto-installed bridge.
    const simA = getBoardSimulator(unoA) as any;
    const busA = simA.getI2CBus(0);
    busA.start(false);
    busA.connectToSlave(0x42, true);
    busA.writeByte(0x05); // register pointer
    busA.writeByte(0xcc); // data
    busA.stop();

    expect(deviceB.registers[0x05]).toBe(0xcc);
  });

  it('only SDA wired (no SCL): no bridge installed', () => {
    const store = useSimulatorStore.getState();
    const unoA = 'arduino-uno';
    const unoB = store.addBoard('arduino-uno', 400, 100);

    const simB = getBoardSimulator(unoB) as any;
    const deviceB = new I2CMemoryDevice(0x42);
    simB.getI2CBus(0).addDevice(deviceB);

    // Only SDA wired — SCL is missing.
    setWires(useSimulatorStore, [
      { fromBoard: unoA, fromPin: 'A4', toBoard: unoB, toPin: 'A4' },
    ]);

    const simA = getBoardSimulator(unoA) as any;
    const busA = simA.getI2CBus(0);
    busA.start(false);
    busA.connectToSlave(0x42, true);
    busA.stop();

    // No bridge → master never reached device B.
    expect(deviceB.registers[0x05]).toBe(0);
    // And the slave bus is not currently handling an external master.
    expect(simB.getI2CBus(0).isHandlingExternal()).toBe(false);
  });

  it('removing one of the two wires tears the bridge down', () => {
    const store = useSimulatorStore.getState();
    const unoA = 'arduino-uno';
    const unoB = store.addBoard('arduino-uno', 400, 100);

    const simB = getBoardSimulator(unoB) as any;
    const deviceB = new I2CMemoryDevice(0x42);
    simB.getI2CBus(0).addDevice(deviceB);

    setWires(useSimulatorStore, [
      { fromBoard: unoA, fromPin: 'A4', toBoard: unoB, toPin: 'A4' },
      { fromBoard: unoA, fromPin: 'A5', toBoard: unoB, toPin: 'A5' },
    ]);

    // Sanity: bridge works.
    const simA = getBoardSimulator(unoA) as any;
    let busA = simA.getI2CBus(0);
    busA.start(false);
    busA.connectToSlave(0x42, true);
    busA.writeByte(0x01);
    busA.writeByte(0x77);
    busA.stop();
    expect(deviceB.registers[0x01]).toBe(0x77);

    // Drop SCL — bridge should disappear.
    setWires(useSimulatorStore, [
      { fromBoard: unoA, fromPin: 'A4', toBoard: unoB, toPin: 'A4' },
    ]);

    busA = simA.getI2CBus(0);
    busA.start(false);
    busA.connectToSlave(0x42, true);
    busA.writeByte(0x02);
    busA.writeByte(0x88);
    busA.stop();

    // Register 0x02 still 0 — bridge gone.
    expect(deviceB.registers[0x02]).toBe(0);
    // Register 0x01 still has the value from before, proving the
    // first round did land on the device.
    expect(deviceB.registers[0x01]).toBe(0x77);
  });

  it('cross-board: Uno (bus 0) ↔ Pico (bus 0 = GP4/GP5)', () => {
    const store = useSimulatorStore.getState();
    const unoId = 'arduino-uno';
    const picoId = store.addBoard('pi-pico-w', 400, 100);

    // Device on the Pico's I2C0 (Wire).
    const simPico = getBoardSimulator(picoId) as any;
    const deviceP = new I2CMemoryDevice(0x3c);
    simPico.getI2CBus(0).addDevice(deviceP);

    // Pico GP4 = SDA, GP5 = SCL (default I2C0).  Uno A4/A5.
    setWires(useSimulatorStore, [
      { fromBoard: unoId, fromPin: 'A4', toBoard: picoId, toPin: 'GP4' },
      { fromBoard: unoId, fromPin: 'A5', toBoard: picoId, toPin: 'GP5' },
    ]);

    const simUno = getBoardSimulator(unoId) as any;
    const busU = simUno.getI2CBus(0);
    busU.start(false);
    busU.connectToSlave(0x3c, true);
    busU.writeByte(0x10);
    busU.writeByte(0xee);
    busU.stop();

    expect(deviceP.registers[0x10]).toBe(0xee);
  });
});
