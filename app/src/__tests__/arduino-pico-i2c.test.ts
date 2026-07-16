/**
 * Arduino Uno (master) ↔ Pi Pico (slave) — I2C bus
 * ================================================
 *
 * Wire: Uno.A4 (SDA, pin 18) ↔ Pico.GP4 (I2C0 SDA),
 *       Uno.A5 (SCL, pin 19) ↔ Pico.GP5 (I2C0 SCL),
 *       GND ↔ GND.
 *
 * Strategy: pin-level propagation handles SDA/SCL transitions just like
 * any other digital pin. Each board's I2C peripheral sees the bus
 * transitions and decodes naturally.
 *
 * v1 caveat: open-drain is approximated as wired-OR ("any LOW = bus LOW")
 * by always propagating each pin transition. True multi-master arbitration
 * is deferred to v2.
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

describe('Arduino Uno ↔ Pi Pico — I2C pin-level propagation', () => {
  beforeEach(() => {
    fullReset();
  });

  function setupI2C() {
    const store = useSimulatorStore.getState();
    const unoId = 'arduino-uno';
    const picoId = store.addBoard('pi-pico-w', 400, 100);
    setWires(useSimulatorStore, [
      // Uno.A4 (SDA = pin 18) ↔ Pico.GP4 (I2C0 SDA)
      { fromBoard: unoId, fromPin: 'A4', toBoard: picoId, toPin: 'GP4' },
      // Uno.A5 (SCL = pin 19) ↔ Pico.GP5 (I2C0 SCL)
      { fromBoard: unoId, fromPin: 'A5', toBoard: picoId, toPin: 'GP5' },
      { fromBoard: unoId, fromPin: 'GND', toBoard: picoId, toPin: 'GND' },
    ]);
    return { unoId, picoId };
  }

  it('Uno SDA pin transition propagates to Pico GP4', () => {
    const { unoId, picoId } = setupI2C();
    const pmUno = getBoardPinManager(unoId)!;
    const simPico = getBoardSimulator(picoId) as any;
    pmUno.triggerPinChange(18, false); // SDA goes LOW (start condition)
    expect(simPico.setPinState).toHaveBeenCalledWith(4, false);
  });

  it('Uno SCL pin transition propagates to Pico GP5', () => {
    const { unoId, picoId } = setupI2C();
    const pmUno = getBoardPinManager(unoId)!;
    const simPico = getBoardSimulator(picoId) as any;
    pmUno.triggerPinChange(19, true); // SCL pulse
    pmUno.triggerPinChange(19, false);
    expect(simPico.setPinState).toHaveBeenCalledWith(5, true);
    expect(simPico.setPinState).toHaveBeenCalledWith(5, false);
  });

  it('Pico SDA toggle propagates back to Uno (bidirectional, slave responses)', () => {
    const { unoId, picoId } = setupI2C();
    const pmPico = getBoardPinManager(picoId)!;
    const simUno = getBoardSimulator(unoId) as any;
    pmPico.triggerPinChange(4, false); // slave pulls SDA low (ACK)
    expect(simUno.setPinState).toHaveBeenCalledWith(18, false);
  });
});
