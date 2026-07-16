/**
 * Two ESP32s — UART across two backend QEMU bridges
 * =================================================
 *
 * Both boards live behind WebSocket QEMU instances. The frontend
 * Interconnect bridges them in JavaScript: when bridgeA.onSerialData
 * fires, the Interconnect calls bridgeB.sendSerialBytes(... uart …)
 * and vice versa. No backend change required for routing.
 *
 * Wire: A.GPIO1(UART0 TX) ↔ B.GPIO3(UART0 RX), and the reverse.
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

import { useSimulatorStore, getEsp32Bridge, getBoardPinManager } from '../store/useSimulatorStore';

function fullReset() {
  clearAllPinManagerState(useSimulatorStore, getBoardPinManager);
  resetInterconnect();
  resetStore(useSimulatorStore);
}

describe('Dual ESP32 — UART0 cross-bridge', () => {
  beforeEach(() => {
    fullReset();
  });

  function setupTwoEsp32s() {
    const store = useSimulatorStore.getState();
    const idA = store.addBoard('esp32', 100, 100);
    const idB = store.addBoard('esp32', 400, 100);
    setWires(useSimulatorStore, [
      { fromBoard: idA, fromPin: '1', toBoard: idB, toPin: '3' }, // A.UART0 TX → B.UART0 RX
      { fromBoard: idB, fromPin: '1', toBoard: idA, toPin: '3' }, // B.UART0 TX → A.UART0 RX
      { fromBoard: idA, fromPin: 'GND', toBoard: idB, toPin: 'GND' },
    ]);
    return { idA, idB };
  }

  it('A.UART0 TX bytes feed B.bridge.sendSerialBytes(uart=0)', () => {
    const { idA, idB } = setupTwoEsp32s();
    const bridgeA = getEsp32Bridge(idA) as any;
    const bridgeB = getEsp32Bridge(idB) as any;
    expect(typeof bridgeA.onSerialData).toBe('function');
    bridgeA.onSerialData('H', 0);
    const matched = (bridgeB.sendSerialBytes as any).mock.calls.some(
      (c: any[]) => Array.isArray(c[0]) && c[0][0] === 'H'.charCodeAt(0) && (c[1] ?? 0) === 0,
    );
    expect(matched).toBe(true);
  });

  it('B.UART0 TX bytes feed A.bridge.sendSerialBytes', () => {
    const { idA, idB } = setupTwoEsp32s();
    const bridgeA = getEsp32Bridge(idA) as any;
    const bridgeB = getEsp32Bridge(idB) as any;
    bridgeB.onSerialData('Z', 0);
    const matched = (bridgeA.sendSerialBytes as any).mock.calls.some(
      (c: any[]) => Array.isArray(c[0]) && c[0][0] === 'Z'.charCodeAt(0),
    );
    expect(matched).toBe(true);
  });

  it('UART2 from A (no wire on GPIO16/17) is NOT forwarded', () => {
    const { idA, idB } = setupTwoEsp32s();
    const bridgeA = getEsp32Bridge(idA) as any;
    const bridgeB = getEsp32Bridge(idB) as any;
    bridgeA.onSerialData('X', 2);
    const matched = (bridgeB.sendSerialBytes as any).mock.calls.some(
      (c: any[]) => Array.isArray(c[0]) && c[0][0] === 'X'.charCodeAt(0),
    );
    expect(matched).toBe(false);
  });
});
