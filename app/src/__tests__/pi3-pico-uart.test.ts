/**
 * Raspberry Pi 3B ↔ Raspberry Pi Pico — UART across QEMU+browser
 * ==============================================================
 *
 * Pi3B's UART0 default pins on the BCM map: BCM14 (TX, physical pin 8),
 * BCM15 (RX, physical pin 10).  Pico's UART0: GP0 (TX), GP1 (RX).
 *
 * Wire: Pi3B.physical8 ↔ Pico.GP1, Pico.GP0 ↔ Pi3B.physical10.
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
  getBoardBridge,
  getBoardPinManager,
} from '../store/useSimulatorStore';

function fullReset() {
  clearAllPinManagerState(useSimulatorStore, getBoardPinManager);
  resetInterconnect();
  resetStore(useSimulatorStore);
}

describe('Raspberry Pi 3B ↔ Pico W — UART', () => {
  beforeEach(() => {
    fullReset();
  });

  function setupPi3Pico() {
    const store = useSimulatorStore.getState();
    const piId = store.addBoard('raspberry-pi-3', 100, 100);
    const picoId = store.addBoard('pi-pico-w', 400, 100);
    setWires(useSimulatorStore, [
      // Pi3B physical 8 (BCM14, UART0 TX) → Pico GP1 (UART0 RX)
      { fromBoard: piId, fromPin: '8', toBoard: picoId, toPin: 'GP1' },
      // Pico GP0 (UART0 TX) → Pi3B physical 10 (BCM15, UART0 RX)
      { fromBoard: picoId, fromPin: 'GP0', toBoard: piId, toPin: '10' },
      // GND
      { fromBoard: piId, fromPin: '6', toBoard: picoId, toPin: 'GND' },
    ]);
    return { piId, picoId };
  }

  it('Pi3B UART0 TX → Pico.UART0 RX (feedUart/serialWrite)', () => {
    const { piId, picoId } = setupPi3Pico();
    const piBridge = getBoardBridge(piId) as any;
    const simPico = getBoardSimulator(picoId) as any;
    expect(typeof piBridge.onSerialData).toBe('function');
    piBridge.onSerialData('Q');
    const fed =
      (simPico.feedUart as any).mock.calls.some((c: any[]) => c[0] === 0 && c[1] === 'Q') ||
      (simPico.serialWrite as any).mock.calls.some((c: any[]) => c[0] === 'Q');
    expect(fed).toBe(true);
  });

  it('Pico.UART0 TX → Pi3B bridge.sendSerialBytes', () => {
    const { piId, picoId } = setupPi3Pico();
    const piBridge = getBoardBridge(piId) as any;
    const simPico = getBoardSimulator(picoId) as any;
    expect(typeof simPico.onSerialData).toBe('function');
    simPico.onSerialData('R');
    const matched = (piBridge.sendSerialBytes as any).mock.calls.some(
      (c: any[]) => Array.isArray(c[0]) && c[0][0] === 'R'.charCodeAt(0),
    );
    expect(matched).toBe(true);
  });
});
