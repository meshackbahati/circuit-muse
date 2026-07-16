/**
 * Two Arduino Unos — hardware Serial (USART0 on D0/D1)
 * ====================================================
 *
 * Wire: A.D1(TX) ↔ B.D0(RX), A.D0(RX) ↔ B.D1(TX), GND ↔ GND.
 * `Serial.write('H')` on A reaches B's USART0 RX.
 *
 * For browser-based AVR sims (same JS event loop), pin propagation
 * alone would also carry the bit transitions — but it's much faster
 * and simpler to also offer the byte-level shortcut: A's `onSerialData`
 * callback fires per TX byte, and the Interconnect routes it directly
 * to B's `serialWrite`.
 *
 * The test asserts the byte-level path (low-overhead, no timing risk).
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

import { useSimulatorStore, getBoardSimulator, getBoardPinManager } from '../store/useSimulatorStore';

function fullReset() {
  clearAllPinManagerState(useSimulatorStore, getBoardPinManager);
  resetInterconnect();
  resetStore(useSimulatorStore);
}

describe('Dual Arduino Uno — hardware Serial (USART0)', () => {
  beforeEach(() => {
    fullReset();
  });

  function setupTwoUnosWithUart() {
    const store = useSimulatorStore.getState();
    const idA = 'arduino-uno';
    const idB = store.addBoard('arduino-uno', 400, 100);
    setWires(useSimulatorStore, [
      // A.D1 (TX) → B.D0 (RX)
      { fromBoard: idA, fromPin: 'D1', toBoard: idB, toPin: 'D0' },
      // B.D1 (TX) → A.D0 (RX)
      { fromBoard: idB, fromPin: 'D1', toBoard: idA, toPin: 'D0' },
      { fromBoard: idA, fromPin: 'GND', toBoard: idB, toPin: 'GND' },
    ]);
    return { idA, idB };
  }

  it('A.Serial.write("H") feeds B.serialWrite("H")', () => {
    const { idA, idB } = setupTwoUnosWithUart();
    const simA = getBoardSimulator(idA) as any;
    const simB = getBoardSimulator(idB) as any;

    expect(typeof simA.onSerialData).toBe('function'); // Interconnect must wire it
    simA.onSerialData('H');
    const fed_H =
      (simB.feedUart as any).mock.calls.some((c: any[]) => c[0] === 0 && c[1] === 'H')
      || (simB.serialWrite as any).mock.calls.some((c: any[]) => c[0] === 'H');
    expect(fed_H).toBe(true);
  });

  it('B.Serial.write("Z") feeds A.serialWrite("Z")', () => {
    const { idA, idB } = setupTwoUnosWithUart();
    const simA = getBoardSimulator(idA) as any;
    const simB = getBoardSimulator(idB) as any;

    expect(typeof simB.onSerialData).toBe('function');
    simB.onSerialData('Z');
    const fed_Z =
      (simA.feedUart as any).mock.calls.some((c: any[]) => c[0] === 0 && c[1] === 'Z')
      || (simA.serialWrite as any).mock.calls.some((c: any[]) => c[0] === 'Z');
    expect(fed_Z).toBe(true);
  });

  it('multi-byte burst preserves byte order', () => {
    const { idA, idB } = setupTwoUnosWithUart();
    const simA = getBoardSimulator(idA) as any;
    const simB = getBoardSimulator(idB) as any;
    for (const ch of 'Hello') simA.onSerialData(ch);
    const fedChars = [
      ...(simB.feedUart as any).mock.calls.filter((c: any[]) => c[0] === 0).map((c: any[]) => c[1]),
      ...(simB.serialWrite as any).mock.calls.map((c: any[]) => c[0]),
    ];
    expect(fedChars.join('')).toContain('Hello');
  });

  it('only-TX-wire (no RX wire) stops echo from B back to A', () => {
    const store = useSimulatorStore.getState();
    const idA = 'arduino-uno';
    const idB = store.addBoard('arduino-uno', 400, 100);
    setWires(useSimulatorStore, [
      // Only A.D1 → B.D0; no return wire
      { fromBoard: idA, fromPin: 'D1', toBoard: idB, toPin: 'D0' },
    ]);
    const simA = getBoardSimulator(idA) as any;
    const simB = getBoardSimulator(idB) as any;

    simA.onSerialData('H');
    const fed_H =
      (simB.feedUart as any).mock.calls.some((c: any[]) => c[0] === 0 && c[1] === 'H')
      || (simB.serialWrite as any).mock.calls.some((c: any[]) => c[0] === 'H');
    expect(fed_H).toBe(true);

    simB.onSerialData('Z');
    expect(simA.serialWrite).not.toHaveBeenCalled();
  });
});
