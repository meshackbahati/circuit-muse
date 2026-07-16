/**
 * Arduino Uno ↔ Pi Pico — hardware UART across kinds
 * ==================================================
 *
 * Wire: Uno.D1(TX) ↔ Pico.GP1(UART0 RX), Pico.GP0(TX) ↔ Uno.D0(RX).
 * Uno's USART0 → Pico's UART0; Pico's UART0 → Uno's USART0.
 * Byte-level shortcut path.
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

describe('Arduino Uno ↔ Pi Pico — hardware UART', () => {
  beforeEach(() => {
    fullReset();
  });

  function setupMixedUart() {
    const store = useSimulatorStore.getState();
    const unoId = 'arduino-uno';
    const picoId = store.addBoard('pi-pico-w', 400, 100);
    setWires(useSimulatorStore, [
      // Uno.D1 (USART0 TX) → Pico.GP1 (UART0 RX)
      { fromBoard: unoId, fromPin: 'D1', toBoard: picoId, toPin: 'GP1' },
      // Pico.GP0 (UART0 TX) → Uno.D0 (USART0 RX)
      { fromBoard: picoId, fromPin: 'GP0', toBoard: unoId, toPin: 'D0' },
      { fromBoard: unoId, fromPin: 'GND', toBoard: picoId, toPin: 'GND' },
    ]);
    return { unoId, picoId };
  }

  it('Uno.Serial.write("U") feeds Pico.UART0 RX', () => {
    const { unoId, picoId } = setupMixedUart();
    const simUno = getBoardSimulator(unoId) as any;
    const simPico = getBoardSimulator(picoId) as any;
    expect(typeof simUno.onSerialData).toBe('function');
    simUno.onSerialData('U');
    // Pico should receive on UART0. feedUart(0, 'U') is the new per-UART API;
    // serialWrite('U') is the legacy alias for UART0. Either is acceptable.
    const fedUart0 =
      (simPico.feedUart as any).mock.calls.some((c: any[]) => c[0] === 0 && c[1] === 'U') ||
      (simPico.serialWrite as any).mock.calls.some((c: any[]) => c[0] === 'U');
    expect(fedUart0).toBe(true);
  });

  it('Pico.Serial1.write("P") feeds Uno.USART0 RX', () => {
    const { unoId, picoId } = setupMixedUart();
    const simUno = getBoardSimulator(unoId) as any;
    const simPico = getBoardSimulator(picoId) as any;
    // Pico's onSerialData fires for any UART. The byte shortcut should
    // route to Uno because the wire is GP0(TX UART0) → D0.
    simPico.onSerialData('P');
    const fed_P =
      (simUno.feedUart as any).mock.calls.some((c: any[]) => c[0] === 0 && c[1] === 'P')
      || (simUno.serialWrite as any).mock.calls.some((c: any[]) => c[0] === 'P');
    expect(fed_P).toBe(true);
  });
});
