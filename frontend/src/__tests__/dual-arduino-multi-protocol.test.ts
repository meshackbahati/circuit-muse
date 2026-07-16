/**
 * Two Arduino Unos — every protocol over the same shared bench
 * ============================================================
 *
 * Comprehensive matrix of inter-board communication for two Arduino
 * Unos. Each describe block covers one protocol so a regression on
 * any single signaling path is localized.
 *
 * Pin map (Uno):
 *   USART0:   D0(RX) / D1(TX)
 *   I2C:      A4(SDA, AVR pin 18) / A5(SCL, AVR pin 19)
 *   SPI:      D10(SS) / D11(MOSI) / D12(MISO) / D13(SCK)
 *   PWM-cap:  D3, D5, D6, D9, D10, D11
 *   GPIO:     D2..D13 (D0/D1 reserved for hardware Serial)
 *
 * Test convention: trigger the source PinManager directly (which is
 * exactly what AVRSimulator does internally on PORT writes) and assert
 * the destination simulator's setPinState / serialWrite / feedUart was
 * called along the registered route.
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
  RaspberryPi3Bridge: vi.fn(function (this: any, _id: string) {
    this.onSerialData = null;
    this.onPinChange = null;
    this.connect = vi.fn();
    this.disconnect = vi.fn();
    this.connected = true;
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

// Helper that mirrors flexible UART assertion from other tests.
function uartFedWith(sim: any, expected: string, uart = 0): boolean {
  return (
    (sim.feedUart as any).mock.calls.some(
      (c: any[]) => c[0] === uart && c[1] === expected,
    ) || (sim.serialWrite as any).mock.calls.some((c: any[]) => c[0] === expected)
  );
}

function setupTwoUnos() {
  const store = useSimulatorStore.getState();
  const idA = 'arduino-uno';
  const idB = store.addBoard('arduino-uno', 400, 100);
  return { idA, idB };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Hardware UART (USART0 on D0/D1)
// ─────────────────────────────────────────────────────────────────────────────

describe('Dual Arduino Uno — hardware UART (USART0)', () => {
  beforeEach(() => fullReset());

  it('A.D1(TX) → B.D0(RX) routes byte', () => {
    const { idA, idB } = setupTwoUnos();
    setWires(useSimulatorStore, [
      { fromBoard: idA, fromPin: 'D1', toBoard: idB, toPin: 'D0' },
      { fromBoard: idB, fromPin: 'D1', toBoard: idA, toPin: 'D0' },
    ]);
    const simA = getBoardSimulator(idA) as any;
    const simB = getBoardSimulator(idB) as any;
    simA.onSerialData('X');
    expect(uartFedWith(simB, 'X')).toBe(true);
  });

  it('full duplex — both A→B and B→A simultaneously', () => {
    const { idA, idB } = setupTwoUnos();
    setWires(useSimulatorStore, [
      { fromBoard: idA, fromPin: 'D1', toBoard: idB, toPin: 'D0' },
      { fromBoard: idB, fromPin: 'D1', toBoard: idA, toPin: 'D0' },
    ]);
    const simA = getBoardSimulator(idA) as any;
    const simB = getBoardSimulator(idB) as any;
    simA.onSerialData('A');
    simB.onSerialData('B');
    expect(uartFedWith(simB, 'A')).toBe(true);
    expect(uartFedWith(simA, 'B')).toBe(true);
  });

  it('long burst (printf-style line) preserves byte stream', () => {
    const { idA, idB } = setupTwoUnos();
    setWires(useSimulatorStore, [
      { fromBoard: idA, fromPin: 'D1', toBoard: idB, toPin: 'D0' },
    ]);
    const simA = getBoardSimulator(idA) as any;
    const simB = getBoardSimulator(idB) as any;
    const line = 'Sensor=42.7\n';
    for (const ch of line) simA.onSerialData(ch);
    const fed = [
      ...(simB.feedUart as any).mock.calls.filter((c: any[]) => c[0] === 0).map((c: any[]) => c[1]),
      ...(simB.serialWrite as any).mock.calls.map((c: any[]) => c[0]),
    ].join('');
    expect(fed).toContain('Sensor=42.7');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. I2C (Wire library, A4=SDA, A5=SCL)
// ─────────────────────────────────────────────────────────────────────────────

describe('Dual Arduino Uno — I2C (A4/A5)', () => {
  beforeEach(() => fullReset());

  function setupI2C() {
    const { idA, idB } = setupTwoUnos();
    setWires(useSimulatorStore, [
      // A4 (SDA) ↔ A4
      { fromBoard: idA, fromPin: 'A4', toBoard: idB, toPin: 'A4' },
      // A5 (SCL) ↔ A5
      { fromBoard: idA, fromPin: 'A5', toBoard: idB, toPin: 'A5' },
      { fromBoard: idA, fromPin: 'GND', toBoard: idB, toPin: 'GND' },
    ]);
    return { idA, idB };
  }

  it('SDA pulse from master propagates to slave (Wire.beginTransmission)', () => {
    const { idA, idB } = setupI2C();
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    // Start condition: SDA goes LOW while SCL is HIGH
    pmA.triggerPinChange(18, false); // A4 = AVR pin 18 (SDA)
    expect(simB.setPinState).toHaveBeenCalledWith(18, false);
  });

  it('SCL clock pulses propagate to slave', () => {
    const { idA, idB } = setupI2C();
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    // 8 clock pulses for one byte
    for (let i = 0; i < 8; i++) {
      pmA.triggerPinChange(19, true);  // A5 = AVR pin 19 (SCL)
      pmA.triggerPinChange(19, false);
    }
    const sclCalls = (simB.setPinState as any).mock.calls.filter(
      (c: any[]) => c[0] === 19,
    );
    expect(sclCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('slave ACK (slave pulls SDA low) reaches master', () => {
    const { idA, idB } = setupI2C();
    const pmB = getBoardPinManager(idB)!;
    const simA = getBoardSimulator(idA) as any;
    pmB.triggerPinChange(18, false); // slave acks
    expect(simA.setPinState).toHaveBeenCalledWith(18, false);
  });

  it('I2C and UART can coexist on the same board pair', () => {
    const { idA, idB } = setupTwoUnos();
    setWires(useSimulatorStore, [
      { fromBoard: idA, fromPin: 'A4', toBoard: idB, toPin: 'A4' },
      { fromBoard: idA, fromPin: 'A5', toBoard: idB, toPin: 'A5' },
      { fromBoard: idA, fromPin: 'D1', toBoard: idB, toPin: 'D0' },
    ]);
    const pmA = getBoardPinManager(idA)!;
    const simA = getBoardSimulator(idA) as any;
    const simB = getBoardSimulator(idB) as any;

    // I2C
    pmA.triggerPinChange(18, false);
    expect(simB.setPinState).toHaveBeenCalledWith(18, false);

    // UART byte (independent of I2C activity)
    simA.onSerialData('U');
    expect(uartFedWith(simB, 'U')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. SPI (master D10..D13)
// ─────────────────────────────────────────────────────────────────────────────

describe('Dual Arduino Uno — SPI (D10..D13)', () => {
  beforeEach(() => fullReset());

  function setupSpi() {
    const { idA, idB } = setupTwoUnos();
    setWires(useSimulatorStore, [
      { fromBoard: idA, fromPin: 'D13', toBoard: idB, toPin: 'D13' }, // SCK
      { fromBoard: idA, fromPin: 'D11', toBoard: idB, toPin: 'D11' }, // MOSI
      { fromBoard: idB, fromPin: 'D12', toBoard: idA, toPin: 'D12' }, // MISO
      { fromBoard: idA, fromPin: 'D10', toBoard: idB, toPin: 'D10' }, // SS / CS
      { fromBoard: idA, fromPin: 'GND', toBoard: idB, toPin: 'GND' },
    ]);
    return { idA, idB };
  }

  it('SS/CS goes LOW from master (D10) reaches slave', () => {
    const { idA, idB } = setupSpi();
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    pmA.triggerPinChange(10, false);
    expect(simB.setPinState).toHaveBeenCalledWith(10, false);
  });

  it('SCK toggles propagate (clock signal)', () => {
    const { idA, idB } = setupSpi();
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    pmA.triggerPinChange(13, true);
    pmA.triggerPinChange(13, false);
    pmA.triggerPinChange(13, true);
    const sckCalls = (simB.setPinState as any).mock.calls.filter(
      (c: any[]) => c[0] === 13,
    );
    expect(sckCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('MOSI bit from master reaches slave', () => {
    const { idA, idB } = setupSpi();
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    pmA.triggerPinChange(11, true);
    expect(simB.setPinState).toHaveBeenCalledWith(11, true);
  });

  it('MISO bit from slave reaches master (reverse direction)', () => {
    const { idA, idB } = setupSpi();
    const pmB = getBoardPinManager(idB)!;
    const simA = getBoardSimulator(idA) as any;
    pmB.triggerPinChange(12, true);
    expect(simA.setPinState).toHaveBeenCalledWith(12, true);
  });

  it('full SPI byte sequence (MOSI + 8 SCK pulses) reaches slave', () => {
    const { idA, idB } = setupSpi();
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;

    // CS LOW
    pmA.triggerPinChange(10, false);
    // 8 bits of MOSI=0xA5 = 0b10100101, MSB-first
    const bits = [true, false, true, false, false, true, false, true];
    for (const bit of bits) {
      pmA.triggerPinChange(11, bit);
      pmA.triggerPinChange(13, true);  // SCK rising edge — sample
      pmA.triggerPinChange(13, false);
    }
    pmA.triggerPinChange(10, true); // CS HIGH

    // Slave should have seen pin 10 (CS), 11 (MOSI), 13 (SCK) transitions
    const csCount = (simB.setPinState as any).mock.calls.filter((c: any[]) => c[0] === 10).length;
    const mosiCount = (simB.setPinState as any).mock.calls.filter((c: any[]) => c[0] === 11).length;
    const sckCount = (simB.setPinState as any).mock.calls.filter((c: any[]) => c[0] === 13).length;
    expect(csCount).toBeGreaterThanOrEqual(2); // LOW + HIGH
    expect(mosiCount).toBeGreaterThanOrEqual(1);
    expect(sckCount).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. SoftwareSerial (bit-bang on any digital pair)
// ─────────────────────────────────────────────────────────────────────────────

describe('Dual Arduino Uno — SoftwareSerial', () => {
  beforeEach(() => fullReset());

  it('SoftwareSerial on D2/D3 propagates pin transitions both ways', () => {
    const { idA, idB } = setupTwoUnos();
    setWires(useSimulatorStore, [
      { fromBoard: idA, fromPin: 'D3', toBoard: idB, toPin: 'D2' }, // A SS-TX → B SS-RX
      { fromBoard: idB, fromPin: 'D3', toBoard: idA, toPin: 'D2' }, // B SS-TX → A SS-RX
    ]);
    const pmA = getBoardPinManager(idA)!;
    const pmB = getBoardPinManager(idB)!;
    const simA = getBoardSimulator(idA) as any;
    const simB = getBoardSimulator(idB) as any;

    pmA.triggerPinChange(3, false); // A drives start bit
    expect(simB.setPinState).toHaveBeenCalledWith(2, false);

    pmB.triggerPinChange(3, false); // B drives start bit
    expect(simA.setPinState).toHaveBeenCalledWith(2, false);
  });

  it('SoftwareSerial on alternate pair D8/D9 also works', () => {
    const { idA, idB } = setupTwoUnos();
    setWires(useSimulatorStore, [
      { fromBoard: idA, fromPin: 'D9', toBoard: idB, toPin: 'D8' },
    ]);
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    pmA.triggerPinChange(9, true);
    pmA.triggerPinChange(9, false);
    expect(simB.setPinState).toHaveBeenCalledWith(8, true);
    expect(simB.setPinState).toHaveBeenCalledWith(8, false);
  });

  it('two SoftwareSerial pairs on the same board pair are independent', () => {
    const { idA, idB } = setupTwoUnos();
    setWires(useSimulatorStore, [
      { fromBoard: idA, fromPin: 'D2', toBoard: idB, toPin: 'D3' },
      { fromBoard: idA, fromPin: 'D4', toBoard: idB, toPin: 'D5' },
    ]);
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;

    pmA.triggerPinChange(2, false);
    pmA.triggerPinChange(4, true);

    expect(simB.setPinState).toHaveBeenCalledWith(3, false);
    expect(simB.setPinState).toHaveBeenCalledWith(5, true);
    // No cross-talk
    const pin5False = (simB.setPinState as any).mock.calls.find(
      (c: any[]) => c[0] === 5 && c[1] === false,
    );
    expect(pin5False).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Raw digital pins (digitalWrite/digitalRead)
// ─────────────────────────────────────────────────────────────────────────────

describe('Dual Arduino Uno — raw digital pins', () => {
  beforeEach(() => fullReset());

  it('every digital pin D2..D12 propagates independently', () => {
    const { idA, idB } = setupTwoUnos();
    const pinsToWire = [2, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    setWires(
      useSimulatorStore,
      pinsToWire.map((p) => ({
        fromBoard: idA,
        fromPin: `D${p}`,
        toBoard: idB,
        toPin: `D${p}`,
      })),
    );
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;

    for (const p of pinsToWire) pmA.triggerPinChange(p, true);

    for (const p of pinsToWire) {
      expect(simB.setPinState).toHaveBeenCalledWith(p, true);
    }
  });

  it('analog-as-digital pin (A0 = D14) propagates', () => {
    const { idA, idB } = setupTwoUnos();
    setWires(useSimulatorStore, [
      { fromBoard: idA, fromPin: 'A0', toBoard: idB, toPin: 'A0' },
    ]);
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    pmA.triggerPinChange(14, true);
    expect(simB.setPinState).toHaveBeenCalledWith(14, true);
  });

  it('cross-pin wiring (A.D7 ↔ B.D11) carries the digital signal', () => {
    const { idA, idB } = setupTwoUnos();
    setWires(useSimulatorStore, [
      { fromBoard: idA, fromPin: 'D7', toBoard: idB, toPin: 'D11' },
    ]);
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    pmA.triggerPinChange(7, true);
    expect(simB.setPinState).toHaveBeenCalledWith(11, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Concurrent multi-protocol activity on the same wire bench
// ─────────────────────────────────────────────────────────────────────────────

describe('Dual Arduino Uno — concurrent multi-protocol activity', () => {
  beforeEach(() => fullReset());

  it('UART + I2C + SPI + raw digital all work simultaneously', () => {
    const { idA, idB } = setupTwoUnos();
    setWires(useSimulatorStore, [
      // UART
      { fromBoard: idA, fromPin: 'D1', toBoard: idB, toPin: 'D0' },
      { fromBoard: idB, fromPin: 'D1', toBoard: idA, toPin: 'D0' },
      // I2C
      { fromBoard: idA, fromPin: 'A4', toBoard: idB, toPin: 'A4' },
      { fromBoard: idA, fromPin: 'A5', toBoard: idB, toPin: 'A5' },
      // SPI
      { fromBoard: idA, fromPin: 'D13', toBoard: idB, toPin: 'D13' },
      { fromBoard: idA, fromPin: 'D11', toBoard: idB, toPin: 'D11' },
      { fromBoard: idB, fromPin: 'D12', toBoard: idA, toPin: 'D12' },
      { fromBoard: idA, fromPin: 'D10', toBoard: idB, toPin: 'D10' },
      // Random digital
      { fromBoard: idA, fromPin: 'D7', toBoard: idB, toPin: 'D7' },
      // Common ground
      { fromBoard: idA, fromPin: 'GND', toBoard: idB, toPin: 'GND' },
    ]);
    const pmA = getBoardPinManager(idA)!;
    const simA = getBoardSimulator(idA) as any;
    const simB = getBoardSimulator(idB) as any;

    // UART
    simA.onSerialData('Q');
    // I2C
    pmA.triggerPinChange(18, false);
    pmA.triggerPinChange(19, true);
    // SPI
    pmA.triggerPinChange(10, false);
    pmA.triggerPinChange(11, true);
    pmA.triggerPinChange(13, true);
    // Raw digital
    pmA.triggerPinChange(7, true);

    // All must reach B
    expect(uartFedWith(simB, 'Q')).toBe(true);
    expect(simB.setPinState).toHaveBeenCalledWith(18, false);
    expect(simB.setPinState).toHaveBeenCalledWith(19, true);
    expect(simB.setPinState).toHaveBeenCalledWith(10, false);
    expect(simB.setPinState).toHaveBeenCalledWith(11, true);
    expect(simB.setPinState).toHaveBeenCalledWith(13, true);
    expect(simB.setPinState).toHaveBeenCalledWith(7, true);
  });

  it('removing an I2C wire stops just the I2C path, leaving UART intact', () => {
    const { idA, idB } = setupTwoUnos();
    setWires(useSimulatorStore, [
      { fromBoard: idA, fromPin: 'D1', toBoard: idB, toPin: 'D0' },
      { fromBoard: idA, fromPin: 'A4', toBoard: idB, toPin: 'A4' },
      { fromBoard: idA, fromPin: 'A5', toBoard: idB, toPin: 'A5' },
    ]);

    // Drop I2C wires (keep UART)
    useSimulatorStore.setState((s) => ({
      wires: s.wires.filter(
        (w) => !(w.start.pinName === 'A4' || w.start.pinName === 'A5'),
      ),
    }));

    const pmA = getBoardPinManager(idA)!;
    const simA = getBoardSimulator(idA) as any;
    const simB = getBoardSimulator(idB) as any;

    pmA.triggerPinChange(18, false);
    pmA.triggerPinChange(19, true);
    simA.onSerialData('U');

    // I2C pins NOT propagated
    const i2cCalls = (simB.setPinState as any).mock.calls.filter(
      (c: any[]) => c[0] === 18 || c[0] === 19,
    );
    expect(i2cCalls.length).toBe(0);
    // UART still works
    expect(uartFedWith(simB, 'U')).toBe(true);
  });
});
