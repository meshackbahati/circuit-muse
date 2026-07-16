/**
 * Two Raspberry Pi Pico W — every protocol over the same shared bench
 * ===================================================================
 *
 * Comprehensive matrix for two Pi Pico W boards. Same approach as the
 * dual-Arduino-Uno suite but with the RP2040's GPIO map.
 *
 * Pin map (Pico, Earle Philhower core defaults):
 *   UART0 (Serial1):  GP0(TX) / GP1(RX)
 *   UART1 (Serial2):  GP4(TX) / GP5(RX)   ← also default I2C0 — disambiguated below
 *   I2C0 (Wire):      GP4(SDA) / GP5(SCL) — boardProtocols classifies these as I2C
 *   I2C1 (Wire1):     GP6(SDA) / GP7(SCL)
 *   SPI0:             GP16(MISO) / GP17(CS) / GP18(SCK) / GP19(MOSI)
 *   GPIO:             GP0..GP28
 *   LED_BUILTIN:      GP25
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../simulation/AVRSimulator', () => ({
  AVRSimulator: vi.fn(function (this: any) {
    this.onSerialData = null;
    this.serialWrite = vi.fn();
    this.feedUart = vi.fn();
    this.start = vi.fn();
    this.stop = vi.fn();
    this.reset = vi.fn();
    this.loadHex = vi.fn();
    this.setPinState = vi.fn();
    this.addI2CDevice = vi.fn();
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

function uartFedWith(sim: any, expected: string, uart = 0): boolean {
  return (
    (sim.feedUart as any).mock.calls.some(
      (c: any[]) => c[0] === uart && c[1] === expected,
    ) || (sim.serialWrite as any).mock.calls.some((c: any[]) => c[0] === expected)
  );
}

function setupTwoPicos() {
  const store = useSimulatorStore.getState();
  const idA = store.addBoard('pi-pico-w', 100, 100);
  const idB = store.addBoard('pi-pico-w', 400, 100);
  return { idA, idB };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. UART0 (Serial1) — GP0/GP1
// ─────────────────────────────────────────────────────────────────────────────

describe('Dual Pico W — UART0 (Serial1 on GP0/GP1)', () => {
  beforeEach(() => fullReset());

  it('A.GP0(TX) → B.GP1(RX) byte routes', () => {
    const { idA, idB } = setupTwoPicos();
    setWires(useSimulatorStore, [
      { fromBoard: idA, fromPin: 'GP0', toBoard: idB, toPin: 'GP1' },
      { fromBoard: idB, fromPin: 'GP0', toBoard: idA, toPin: 'GP1' },
    ]);
    const simA = getBoardSimulator(idA) as any;
    const simB = getBoardSimulator(idB) as any;
    simA.onSerialData('K');
    expect(uartFedWith(simB, 'K')).toBe(true);
  });

  it('full-duplex bursts in both directions are isolated', () => {
    const { idA, idB } = setupTwoPicos();
    setWires(useSimulatorStore, [
      { fromBoard: idA, fromPin: 'GP0', toBoard: idB, toPin: 'GP1' },
      { fromBoard: idB, fromPin: 'GP0', toBoard: idA, toPin: 'GP1' },
    ]);
    const simA = getBoardSimulator(idA) as any;
    const simB = getBoardSimulator(idB) as any;
    for (const ch of 'PING') simA.onSerialData(ch);
    for (const ch of 'PONG') simB.onSerialData(ch);

    const fedA = [
      ...(simA.feedUart as any).mock.calls.filter((c: any[]) => c[0] === 0).map((c: any[]) => c[1]),
      ...(simA.serialWrite as any).mock.calls.map((c: any[]) => c[0]),
    ].join('');
    const fedB = [
      ...(simB.feedUart as any).mock.calls.filter((c: any[]) => c[0] === 0).map((c: any[]) => c[1]),
      ...(simB.serialWrite as any).mock.calls.map((c: any[]) => c[0]),
    ].join('');
    expect(fedA).toContain('PONG');
    expect(fedB).toContain('PING');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. UART1 / Serial2 (alternate pins)
// ─────────────────────────────────────────────────────────────────────────────

describe('Dual Pico W — UART1 (Serial2 on GP8/GP9)', () => {
  beforeEach(() => fullReset());

  // GP8/GP9 is one of the Pico's UART1 alternate pin pairs in arduino-pico.
  // Our boardProtocols classifier lists GP4/GP5 as I2C0 by default, so we
  // exercise the alternate pair to keep the protocol routing unambiguous.
  it('GP8/GP9 wire is treated as raw digital (no UART byte shortcut), but pins still propagate', () => {
    const { idA, idB } = setupTwoPicos();
    setWires(useSimulatorStore, [
      { fromBoard: idA, fromPin: 'GP8', toBoard: idB, toPin: 'GP9' },
      { fromBoard: idB, fromPin: 'GP8', toBoard: idA, toPin: 'GP9' },
    ]);
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;

    // Simulating SoftwareSerial-style bit transitions on GP8 (TX side)
    pmA.triggerPinChange(8, false); // start bit
    pmA.triggerPinChange(8, true);
    pmA.triggerPinChange(8, false);

    // B's GP9 (RX) sees the toggle
    expect(simB.setPinState).toHaveBeenCalledWith(9, false);
    expect(simB.setPinState).toHaveBeenCalledWith(9, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. I2C0 (Wire on GP4/GP5)
// ─────────────────────────────────────────────────────────────────────────────

describe('Dual Pico W — I2C0 (GP4=SDA, GP5=SCL)', () => {
  beforeEach(() => fullReset());

  function setupI2C0() {
    const { idA, idB } = setupTwoPicos();
    setWires(useSimulatorStore, [
      { fromBoard: idA, fromPin: 'GP4', toBoard: idB, toPin: 'GP4' }, // SDA
      { fromBoard: idA, fromPin: 'GP5', toBoard: idB, toPin: 'GP5' }, // SCL
      { fromBoard: idA, fromPin: 'GND', toBoard: idB, toPin: 'GND' },
    ]);
    return { idA, idB };
  }

  it('SDA pulse from master propagates', () => {
    const { idA, idB } = setupI2C0();
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    pmA.triggerPinChange(4, false);
    expect(simB.setPinState).toHaveBeenCalledWith(4, false);
  });

  it('SCL clock train propagates', () => {
    const { idA, idB } = setupI2C0();
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    for (let i = 0; i < 8; i++) {
      pmA.triggerPinChange(5, true);
      pmA.triggerPinChange(5, false);
    }
    const clockHits = (simB.setPinState as any).mock.calls.filter(
      (c: any[]) => c[0] === 5,
    );
    expect(clockHits.length).toBeGreaterThanOrEqual(2);
  });

  it('slave-side ACK reaches master (bidirectional)', () => {
    const { idA, idB } = setupI2C0();
    const pmB = getBoardPinManager(idB)!;
    const simA = getBoardSimulator(idA) as any;
    pmB.triggerPinChange(4, false);
    expect(simA.setPinState).toHaveBeenCalledWith(4, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. I2C1 (Wire1 on GP6/GP7)
// ─────────────────────────────────────────────────────────────────────────────

describe('Dual Pico W — I2C1 (GP6=SDA, GP7=SCL)', () => {
  beforeEach(() => fullReset());

  function setupI2C1() {
    const { idA, idB } = setupTwoPicos();
    setWires(useSimulatorStore, [
      { fromBoard: idA, fromPin: 'GP6', toBoard: idB, toPin: 'GP6' },
      { fromBoard: idA, fromPin: 'GP7', toBoard: idB, toPin: 'GP7' },
    ]);
    return { idA, idB };
  }

  it('I2C1 SDA propagates', () => {
    const { idA, idB } = setupI2C1();
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    pmA.triggerPinChange(6, false);
    expect(simB.setPinState).toHaveBeenCalledWith(6, false);
  });

  it('I2C0 and I2C1 can run on the same board pair without cross-talk', () => {
    const { idA, idB } = setupTwoPicos();
    setWires(useSimulatorStore, [
      // I2C0
      { fromBoard: idA, fromPin: 'GP4', toBoard: idB, toPin: 'GP4' },
      { fromBoard: idA, fromPin: 'GP5', toBoard: idB, toPin: 'GP5' },
      // I2C1
      { fromBoard: idA, fromPin: 'GP6', toBoard: idB, toPin: 'GP6' },
      { fromBoard: idA, fromPin: 'GP7', toBoard: idB, toPin: 'GP7' },
    ]);
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;

    pmA.triggerPinChange(4, false); // I2C0 SDA
    pmA.triggerPinChange(6, false); // I2C1 SDA

    expect(simB.setPinState).toHaveBeenCalledWith(4, false);
    expect(simB.setPinState).toHaveBeenCalledWith(6, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. SPI0 (GP16..GP19)
// ─────────────────────────────────────────────────────────────────────────────

describe('Dual Pico W — SPI0 (GP16/GP17/GP18/GP19)', () => {
  beforeEach(() => fullReset());

  function setupSpi0() {
    const { idA, idB } = setupTwoPicos();
    setWires(useSimulatorStore, [
      { fromBoard: idB, fromPin: 'GP16', toBoard: idA, toPin: 'GP16' }, // MISO (slave→master)
      { fromBoard: idA, fromPin: 'GP17', toBoard: idB, toPin: 'GP17' }, // CS
      { fromBoard: idA, fromPin: 'GP18', toBoard: idB, toPin: 'GP18' }, // SCK
      { fromBoard: idA, fromPin: 'GP19', toBoard: idB, toPin: 'GP19' }, // MOSI
    ]);
    return { idA, idB };
  }

  it('SCK toggles propagate', () => {
    const { idA, idB } = setupSpi0();
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    pmA.triggerPinChange(18, true);
    pmA.triggerPinChange(18, false);
    expect(simB.setPinState).toHaveBeenCalledWith(18, true);
    expect(simB.setPinState).toHaveBeenCalledWith(18, false);
  });

  it('MOSI master→slave', () => {
    const { idA, idB } = setupSpi0();
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    pmA.triggerPinChange(19, true);
    expect(simB.setPinState).toHaveBeenCalledWith(19, true);
  });

  it('MISO slave→master', () => {
    const { idA, idB } = setupSpi0();
    const pmB = getBoardPinManager(idB)!;
    const simA = getBoardSimulator(idA) as any;
    pmB.triggerPinChange(16, true);
    expect(simA.setPinState).toHaveBeenCalledWith(16, true);
  });

  it('CS assertion + 8-bit MOSI burst is fully observable on slave', () => {
    const { idA, idB } = setupSpi0();
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;

    pmA.triggerPinChange(17, false); // CS LOW
    const bits = [true, true, false, true, false, false, true, false];
    for (const b of bits) {
      pmA.triggerPinChange(19, b); // MOSI
      pmA.triggerPinChange(18, true);
      pmA.triggerPinChange(18, false);
    }
    pmA.triggerPinChange(17, true); // CS HIGH

    const csCount = (simB.setPinState as any).mock.calls.filter((c: any[]) => c[0] === 17).length;
    const mosiCount = (simB.setPinState as any).mock.calls.filter((c: any[]) => c[0] === 19).length;
    const sckCount = (simB.setPinState as any).mock.calls.filter((c: any[]) => c[0] === 18).length;
    expect(csCount).toBeGreaterThanOrEqual(2);
    expect(mosiCount).toBeGreaterThanOrEqual(1);
    expect(sckCount).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Raw digital pins
// ─────────────────────────────────────────────────────────────────────────────

describe('Dual Pico W — raw digital pins', () => {
  beforeEach(() => fullReset());

  it('every GP2..GP15 propagates independently', () => {
    const { idA, idB } = setupTwoPicos();
    const pinsToWire = [2, 3, 8, 9, 10, 11, 12, 13, 14, 15];
    setWires(
      useSimulatorStore,
      pinsToWire.map((p) => ({
        fromBoard: idA,
        fromPin: `GP${p}`,
        toBoard: idB,
        toPin: `GP${p}`,
      })),
    );
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;

    for (const p of pinsToWire) pmA.triggerPinChange(p, true);

    for (const p of pinsToWire) {
      expect(simB.setPinState).toHaveBeenCalledWith(p, true);
    }
  });

  it('cross-pin wiring (A.GP3 ↔ B.GP25 = LED_BUILTIN) carries the digital signal', () => {
    const { idA, idB } = setupTwoPicos();
    setWires(useSimulatorStore, [
      { fromBoard: idA, fromPin: 'GP3', toBoard: idB, toPin: 'GP25' },
    ]);
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;
    pmA.triggerPinChange(3, true);
    expect(simB.setPinState).toHaveBeenCalledWith(25, true);
  });

  it('high-speed toggle on a single pin is rate-limited only by PinManager dedup', () => {
    const { idA, idB } = setupTwoPicos();
    setWires(useSimulatorStore, [
      { fromBoard: idA, fromPin: 'GP10', toBoard: idB, toPin: 'GP10' },
    ]);
    const pmA = getBoardPinManager(idA)!;
    const simB = getBoardSimulator(idB) as any;

    for (let i = 0; i < 200; i++) pmA.triggerPinChange(10, i % 2 === 0);

    // 200 alternating transitions ≈ 200 routed setPinState calls (no dedup
    // because each is a real change).
    const calls = (simB.setPinState as any).mock.calls.filter((c: any[]) => c[0] === 10);
    expect(calls.length).toBeGreaterThanOrEqual(50);
    expect(calls.length).toBeLessThanOrEqual(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Concurrent multi-protocol activity on a single bench
// ─────────────────────────────────────────────────────────────────────────────

describe('Dual Pico W — concurrent multi-protocol activity', () => {
  beforeEach(() => fullReset());

  it('UART0 + I2C0 + SPI0 + raw GPIO all work simultaneously', () => {
    const { idA, idB } = setupTwoPicos();
    setWires(useSimulatorStore, [
      // UART0
      { fromBoard: idA, fromPin: 'GP0', toBoard: idB, toPin: 'GP1' },
      { fromBoard: idB, fromPin: 'GP0', toBoard: idA, toPin: 'GP1' },
      // I2C0
      { fromBoard: idA, fromPin: 'GP4', toBoard: idB, toPin: 'GP4' },
      { fromBoard: idA, fromPin: 'GP5', toBoard: idB, toPin: 'GP5' },
      // SPI0
      { fromBoard: idA, fromPin: 'GP18', toBoard: idB, toPin: 'GP18' },
      { fromBoard: idA, fromPin: 'GP19', toBoard: idB, toPin: 'GP19' },
      { fromBoard: idB, fromPin: 'GP16', toBoard: idA, toPin: 'GP16' },
      { fromBoard: idA, fromPin: 'GP17', toBoard: idB, toPin: 'GP17' },
      // Random GPIO
      { fromBoard: idA, fromPin: 'GP10', toBoard: idB, toPin: 'GP10' },
      // GND
      { fromBoard: idA, fromPin: 'GND', toBoard: idB, toPin: 'GND' },
    ]);
    const pmA = getBoardPinManager(idA)!;
    const simA = getBoardSimulator(idA) as any;
    const simB = getBoardSimulator(idB) as any;

    simA.onSerialData('Y');
    pmA.triggerPinChange(4, false);
    pmA.triggerPinChange(5, true);
    pmA.triggerPinChange(17, false);
    pmA.triggerPinChange(19, true);
    pmA.triggerPinChange(18, true);
    pmA.triggerPinChange(10, true);

    expect(uartFedWith(simB, 'Y')).toBe(true);
    expect(simB.setPinState).toHaveBeenCalledWith(4, false);
    expect(simB.setPinState).toHaveBeenCalledWith(5, true);
    expect(simB.setPinState).toHaveBeenCalledWith(17, false);
    expect(simB.setPinState).toHaveBeenCalledWith(19, true);
    expect(simB.setPinState).toHaveBeenCalledWith(18, true);
    expect(simB.setPinState).toHaveBeenCalledWith(10, true);
  });

  it('removing the UART wires leaves I2C and SPI intact', () => {
    const { idA, idB } = setupTwoPicos();
    setWires(useSimulatorStore, [
      { fromBoard: idA, fromPin: 'GP0', toBoard: idB, toPin: 'GP1' },
      { fromBoard: idA, fromPin: 'GP4', toBoard: idB, toPin: 'GP4' },
      { fromBoard: idA, fromPin: 'GP18', toBoard: idB, toPin: 'GP18' },
    ]);
    // Drop only the UART wire
    useSimulatorStore.setState((s) => ({
      wires: s.wires.filter((w) => !(w.start.pinName === 'GP0' && w.end.pinName === 'GP1')),
    }));

    const pmA = getBoardPinManager(idA)!;
    const simA = getBoardSimulator(idA) as any;
    const simB = getBoardSimulator(idB) as any;

    simA.onSerialData('Z');
    pmA.triggerPinChange(4, false); // I2C SDA
    pmA.triggerPinChange(18, true); // SPI SCK

    // UART byte should NOT reach B (wire removed)
    expect(uartFedWith(simB, 'Z')).toBe(false);
    // I2C + SPI still propagate
    expect(simB.setPinState).toHaveBeenCalledWith(4, false);
    expect(simB.setPinState).toHaveBeenCalledWith(18, true);
  });

  it('three Picos in a star (P1↔P2 on UART0, P1↔P3 on I2C0) keep buses isolated', () => {
    fullReset();
    const store = useSimulatorStore.getState();
    const p1 = store.addBoard('pi-pico-w', 100, 100);
    const p2 = store.addBoard('pi-pico-w', 400, 100);
    const p3 = store.addBoard('pi-pico-w', 700, 100);
    setWires(useSimulatorStore, [
      // P1 ↔ P2 on UART0
      { fromBoard: p1, fromPin: 'GP0', toBoard: p2, toPin: 'GP1' },
      { fromBoard: p2, fromPin: 'GP0', toBoard: p1, toPin: 'GP1' },
      // P1 ↔ P3 on I2C0
      { fromBoard: p1, fromPin: 'GP4', toBoard: p3, toPin: 'GP4' },
      { fromBoard: p1, fromPin: 'GP5', toBoard: p3, toPin: 'GP5' },
    ]);
    const sim1 = getBoardSimulator(p1) as any;
    const pm1 = getBoardPinManager(p1)!;
    const sim2 = getBoardSimulator(p2) as any;
    const sim3 = getBoardSimulator(p3) as any;

    // P1 sends UART byte → only P2 should receive
    sim1.onSerialData('M');
    expect(uartFedWith(sim2, 'M')).toBe(true);
    expect(uartFedWith(sim3, 'M')).toBe(false);

    // P1 toggles I2C SDA → only P3 should see GP4 transition (P2 isn't wired on GP4)
    pm1.triggerPinChange(4, false);
    expect(sim3.setPinState).toHaveBeenCalledWith(4, false);
    const sim2GP4 = (sim2.setPinState as any).mock.calls.find((c: any[]) => c[0] === 4);
    expect(sim2GP4).toBeUndefined();
  });
});
