/**
 * Arduino Uno ↔ ESP32 — hardware UART across browser/QEMU boundary
 * ================================================================
 *
 * The Uno simulator runs in the browser; the ESP32 talks to a backend
 * QEMU instance via `Esp32Bridge` (WebSocket). Bit-level pin
 * propagation across this boundary is too slow for high-baud UART
 * (~1-50 ms RTT). Therefore the Interconnect must enable the
 * byte-level shortcut for hardware UART pins on cross-process boards.
 *
 * Wire: Uno.D1(TX) ↔ ESP32.GPIO3(UART0 RX), ESP32.GPIO1(UART0 TX) ↔ Uno.D0(RX).
 * (Default ESP32 UART0 is on GPIO1=TX / GPIO3=RX.)
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
  getEsp32Bridge,
  getBoardPinManager,
} from '../store/useSimulatorStore';

function fullReset() {
  clearAllPinManagerState(useSimulatorStore, getBoardPinManager);
  resetInterconnect();
  resetStore(useSimulatorStore);
}

describe('Arduino Uno ↔ ESP32 — hardware UART (byte shortcut over WS)', () => {
  beforeEach(() => {
    fullReset();
  });

  function setupMixedEsp32Uart() {
    const store = useSimulatorStore.getState();
    const unoId = 'arduino-uno';
    const espId = store.addBoard('esp32', 400, 100);
    setWires(useSimulatorStore, [
      // Uno.D1 → ESP32 GPIO3 (UART0 RX)
      { fromBoard: unoId, fromPin: 'D1', toBoard: espId, toPin: '3' },
      // ESP32 GPIO1 (UART0 TX) → Uno.D0
      { fromBoard: espId, fromPin: '1', toBoard: unoId, toPin: 'D0' },
      { fromBoard: unoId, fromPin: 'GND', toBoard: espId, toPin: 'GND' },
    ]);
    return { unoId, espId };
  }

  it('Uno.Serial.write("E") forwards to ESP32 bridge.sendSerialBytes on UART0', () => {
    const { unoId, espId } = setupMixedEsp32Uart();
    const simUno = getBoardSimulator(unoId) as any;
    const espBridge = getEsp32Bridge(espId) as any;
    expect(espBridge).toBeDefined();
    simUno.onSerialData('E');
    // The ESP32 bridge accepts bytes per UART:  sendSerialBytes(bytes, uart)
    const calls = (espBridge.sendSerialBytes as any).mock.calls;
    const matched = calls.some(
      (c: any[]) => Array.isArray(c[0]) && c[0][0] === 'E'.charCodeAt(0) && (c[1] ?? 0) === 0,
    );
    expect(matched).toBe(true);
  });

  it('ESP32 bridge.onSerialData (UART0) forwards to Uno.serialWrite', () => {
    const { unoId, espId } = setupMixedEsp32Uart();
    const simUno = getBoardSimulator(unoId) as any;
    const espBridge = getEsp32Bridge(espId) as any;
    expect(typeof espBridge.onSerialData).toBe('function');
    espBridge.onSerialData('A', 0); // emit from UART0
    const fed_A =
      (simUno.feedUart as any).mock.calls.some((c: any[]) => c[0] === 0 && c[1] === 'A')
      || (simUno.serialWrite as any).mock.calls.some((c: any[]) => c[0] === 'A');
    expect(fed_A).toBe(true);
  });

  it('ESP32 byte from UART2 (different UART than the wired one) is NOT forwarded', () => {
    const { unoId, espId } = setupMixedEsp32Uart();
    const simUno = getBoardSimulator(unoId) as any;
    const espBridge = getEsp32Bridge(espId) as any;
    // Wire is on GPIO1/3 = UART0. UART2 default pins are GPIO16/17 — not wired.
    espBridge.onSerialData('Z', 2);
    // Uno should not receive a UART2 byte over the wire that targets UART0.
    expect(simUno.serialWrite).not.toHaveBeenCalledWith('Z');
  });
});
