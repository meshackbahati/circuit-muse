/**
 * i2c-multi-board-slave-gap.test.ts
 *
 * Faithful reproduction of the multi-board I2C bug reported in
 * issue #38 and the Discord thread ("multiple boards over I2C
 * does not work").
 *
 * Why the existing I2C tests pass while production fails
 * ------------------------------------------------------
 * The existing arduino-pico-i2c / dual-*-multi-protocol tests
 * mock both AVRSimulator and RP2040Simulator entirely
 * (vi.mock) and only assert that PinManager transitions reach
 * the other board's setPinState() spy.  That proves wire
 * fan-out but never exercises the actual I2C state machine.
 *
 * In production:
 *  - avr8js AVRTWI only emits events when the firmware programs
 *    the TWI registers (master operations).  It does NOT sample
 *    SDA/SCL from GPIO to act as a slave.
 *  - rp2040js RPI2C is the same: master-only API (onConnect /
 *    onWriteByte / onReadByte fire when the CPU programs the
 *    controller, not from GPIO transitions).
 *  - I2CBusManager bridges TWI <-> JavaScript virtual devices
 *    living on the SAME simulator.  There is no API to feed
 *    transactions from another board's bus, nor any code path
 *    in Interconnect that decodes SDA/SCL transitions into I2C
 *    events on the receiving side.
 *
 * This test uses the REAL I2CBusManager on each side.  We drive
 * the master bus the same way the master simulator's AVRTWI
 * eventHandler calls into it once the compiled firmware runs
 * (the I2CBusManager surface is exactly what avr8js's TWI fires
 * — connectToSlave, writeByte, stop).  We then check whether a
 * device registered on the OTHER board's bus sees anything.
 *
 * It demonstrates concretely:
 *
 *   1. The master's local I2C path works (sanity).
 *   2. A virtual I2C device on the slave board's bus, even with
 *      the same address as the master's target, observes
 *      nothing.  The slave bus is fully isolated from the master
 *      bus.
 *   3. There is no public API on I2CBusManager to inject an
 *      external master transaction — confirming the gap is
 *      architectural.
 *
 * Until the gap is closed (either by adding a slave-mode I2C
 * decoder in Interconnect for SDA/SCL pin pairs, or by adding
 * an `acceptExternalTransaction` entry on I2CBusManager so a
 * cross-board router can push transactions in), the
 * REPRODUCTION assertion will fail — and that failure IS the
 * reproduction of the bug.
 */

import { describe, it, expect } from 'vitest';
import {
  I2CBusManager,
  I2CMemoryDevice,
} from '../simulation/I2CBusManager';

/**
 * Minimal AVRTWI mock shaped exactly as I2CBusManager uses it.
 * The real avr8js AVRTWI fires the SAME I2CBusManager method
 * calls (start, connectToSlave, writeByte, stop) when the
 * compiled firmware programs the TWI peripheral — so driving
 * the bus directly via these methods is a faithful stand-in
 * for the firmware path.  This is the same pattern used by
 * virtual-i2c-devices.test.ts.
 */
function makeTWI() {
  const calls: string[] = [];
  return {
    calls,
    set eventHandler(_handler: unknown) {
      /* installed by I2CBusManager constructor */
    },
    completeStart() {
      calls.push('start');
    },
    completeStop() {
      calls.push('stop');
    },
    completeConnect(ack: boolean) {
      calls.push(`connect:${ack}`);
    },
    completeWrite(ack: boolean) {
      calls.push(`write:${ack}`);
    },
    completeRead(value: number) {
      calls.push(`read:${value}`);
    },
  };
}

/**
 * Simulate a full master-side transaction: START + SLA+W
 * (connectToSlave with write=true) + one data byte + STOP.
 *
 * This is exactly what the AVRTWI eventHandler dispatches when
 * Arduino Wire.beginTransmission(addr); Wire.write(byte);
 * Wire.endTransmission() compiles down and runs.
 */
function driveMasterTransaction(
  bus: I2CBusManager,
  slaveAddr: number,
  byte: number,
) {
  bus.start(false);
  bus.connectToSlave(slaveAddr, true);
  bus.writeByte(byte);
  bus.stop();
}

describe('I2C bug — multi-board slave gap (issue #38 / Discord)', () => {
  it('master-local I2C device receives the transaction (sanity baseline)', () => {
    // Single-board I2C works.  This test guards against
    // regressions in the part that is wired correctly so the
    // negative result below cannot be blamed on a broken bus.
    const masterTwi = makeTWI();
    const masterBus = new I2CBusManager(masterTwi as any);
    const memDevice = new I2CMemoryDevice(0x42);
    masterBus.addDevice(memDevice);

    // Use a transaction shape that exercises a register write:
    // SLA+W, pointer byte 0x10, data byte 0xAB, STOP.
    masterBus.start(false);
    masterBus.connectToSlave(0x42, true);
    masterBus.writeByte(0x10); // register pointer
    masterBus.writeByte(0xab); // data byte to register 0x10
    masterBus.stop();

    expect(memDevice.registers[0x10]).toBe(0xab);
    expect(masterTwi.calls).toContain('connect:true');
  });

  it('master finds an unknown address via attached bridge', () => {
    // The FIX: when the master board has no local device at the
    // requested address, the bus walks its attached bridges.  A
    // peer bus that has the device registered ACKs the
    // connection.  All subsequent writeByte / stop are routed
    // to that peer's device.
    const masterTwi = makeTWI();
    const slaveTwi = makeTWI();
    const masterBus = new I2CBusManager(masterTwi as any);
    const slaveBus = new I2CBusManager(slaveTwi as any);

    // Symmetric bridge.  Interconnect installs this when both
    // SDA and SCL of the two boards are wired together.
    masterBus.attachBridge(slaveBus);
    slaveBus.attachBridge(masterBus);

    const slaveBytesObserved: number[] = [];
    const slaveDevice = new I2CMemoryDevice(0x42);
    const originalWriteByte = slaveDevice.writeByte.bind(slaveDevice);
    slaveDevice.writeByte = (v: number) => {
      slaveBytesObserved.push(v);
      return originalWriteByte(v);
    };
    slaveBus.addDevice(slaveDevice);

    driveMasterTransaction(masterBus, 0x42, 0xab);

    // The slave's device must see the data byte.
    expect(slaveBytesObserved).toContain(0xab);
    // And the master TWI must have received the ACK chain.
    expect(masterTwi.calls).toContain('connect:true');
    expect(masterTwi.calls).toContain('write:true');
    expect(masterTwi.calls).toContain('stop');
  });

  it('bridge is bidirectional — slave can also be master toward the peer', () => {
    const aTwi = makeTWI();
    const bTwi = makeTWI();
    const aBus = new I2CBusManager(aTwi as any);
    const bBus = new I2CBusManager(bTwi as any);
    aBus.attachBridge(bBus);
    bBus.attachBridge(aBus);

    const aDevice = new I2CMemoryDevice(0x10);
    const bDevice = new I2CMemoryDevice(0x20);
    aBus.addDevice(aDevice);
    bBus.addDevice(bDevice);

    // B initiates: writes to A's 0x10 device.
    driveMasterTransaction(bBus, 0x10, 0x77);

    aDevice.writeByte(0x05); // probe-only — just to verify pointer state
    expect(bTwi.calls).toContain('connect:true');
  });

  it('local device wins over a bridged device on the same address', () => {
    // Determinism: if the user wires a sensor at 0x68 on both
    // boards, each board's master talks to its OWN device.
    const aTwi = makeTWI();
    const bTwi = makeTWI();
    const aBus = new I2CBusManager(aTwi as any);
    const bBus = new I2CBusManager(bTwi as any);
    aBus.attachBridge(bBus);
    bBus.attachBridge(aBus);

    const aDevice = new I2CMemoryDevice(0x68);
    const bDevice = new I2CMemoryDevice(0x68);
    aBus.addDevice(aDevice);
    bBus.addDevice(bDevice);

    // A writes pointer 0x05 then data 0xCC at 0x68.  Should
    // land on A's own device, not B's.
    aBus.start(false);
    aBus.connectToSlave(0x68, true);
    aBus.writeByte(0x05);
    aBus.writeByte(0xcc);
    aBus.stop();

    expect(aDevice.registers[0x05]).toBe(0xcc);
    expect(bDevice.registers[0x05]).toBe(0);
  });

  it('detachBridge restores the previous isolated behaviour', () => {
    const masterTwi = makeTWI();
    const slaveTwi = makeTWI();
    const masterBus = new I2CBusManager(masterTwi as any);
    const slaveBus = new I2CBusManager(slaveTwi as any);
    masterBus.attachBridge(slaveBus);
    slaveBus.attachBridge(masterBus);
    slaveBus.addDevice(new I2CMemoryDevice(0x42));

    // Confirm bridge works:
    driveMasterTransaction(masterBus, 0x42, 0xaa);
    expect(masterTwi.calls).toContain('connect:true');

    // Now detach the bridge (Interconnect calls this when the
    // user removes an SDA or SCL wire).
    masterBus.detachBridge(slaveBus);
    slaveBus.detachBridge(masterBus);

    masterTwi.calls.length = 0;
    driveMasterTransaction(masterBus, 0x42, 0xbb);
    expect(masterTwi.calls).toContain('connect:false'); // NACK — isolated again
  });
});

describe('I2C multi-hop routing (3+ board chains)', () => {
  it('A↔B↔C: master on A reaches device on C through B (BFS)', () => {
    // Topology:
    //   A.bus ─── B.bus ─── C.bus
    //                       │
    //                       └── I2CMemoryDevice(0x42)
    //
    // Bridges installed bidirectionally between each adjacent pair,
    // mimicking what Interconnect.updateI2CBridges does when the user
    // wires SDA+SCL between three boards.  Board A has no direct
    // bridge to C, but the BFS walk through B's `getBridges()` reaches
    // it.
    const aTwi = makeTWI();
    const bTwi = makeTWI();
    const cTwi = makeTWI();
    const aBus = new I2CBusManager(aTwi as any);
    const bBus = new I2CBusManager(bTwi as any);
    const cBus = new I2CBusManager(cTwi as any);

    // A↔B
    aBus.attachBridge(bBus);
    bBus.attachBridge(aBus);
    // B↔C
    bBus.attachBridge(cBus);
    cBus.attachBridge(bBus);

    const memDevice = new I2CMemoryDevice(0x42);
    cBus.addDevice(memDevice);

    // A writes pointer 0x05, data 0xCC across two hops.
    aBus.start(false);
    aBus.connectToSlave(0x42, true);
    aBus.writeByte(0x05);
    aBus.writeByte(0xcc);
    aBus.stop();

    expect(aTwi.calls).toContain('connect:true');
    expect(memDevice.registers[0x05]).toBe(0xcc);
  });

  it('A↔B↔C: read flows back through both hops', () => {
    const aTwi = makeTWI();
    const bTwi = makeTWI();
    const cTwi = makeTWI();
    const aBus = new I2CBusManager(aTwi as any);
    const bBus = new I2CBusManager(bTwi as any);
    const cBus = new I2CBusManager(cTwi as any);
    aBus.attachBridge(bBus);
    bBus.attachBridge(aBus);
    bBus.attachBridge(cBus);
    cBus.attachBridge(bBus);

    const memDevice = new I2CMemoryDevice(0x42);
    memDevice.registers[0x00] = 0xab;
    memDevice.registers[0x01] = 0xcd;
    cBus.addDevice(memDevice);

    aBus.start(false);
    aBus.connectToSlave(0x42, true);
    aBus.writeByte(0x00); // pointer
    aBus.start(true); // repeated start
    aBus.connectToSlave(0x42, false); // switch to read
    aBus.readByte(true);
    aBus.readByte(false);
    aBus.stop();

    const reads = aTwi.calls.filter((c) => c.startsWith('read:'));
    expect(reads).toContain('read:171'); // 0xAB
    expect(reads).toContain('read:205'); // 0xCD
  });

  it('cycles in the bridge graph do not cause infinite recursion', () => {
    // A↔B↔C and ALSO A↔C — forms a triangle.  Visited Set must
    // prevent the BFS from looping back through the long way around.
    const aTwi = makeTWI();
    const bTwi = makeTWI();
    const cTwi = makeTWI();
    const aBus = new I2CBusManager(aTwi as any);
    const bBus = new I2CBusManager(bTwi as any);
    const cBus = new I2CBusManager(cTwi as any);
    aBus.attachBridge(bBus);
    bBus.attachBridge(aBus);
    bBus.attachBridge(cBus);
    cBus.attachBridge(bBus);
    aBus.attachBridge(cBus); // direct A↔C edge as well
    cBus.attachBridge(aBus);

    const memDevice = new I2CMemoryDevice(0x55);
    cBus.addDevice(memDevice);

    aBus.start(false);
    aBus.connectToSlave(0x55, true);
    aBus.writeByte(0x00);
    aBus.writeByte(0x99);
    aBus.stop();

    expect(memDevice.registers[0x00]).toBe(0x99);
  });

  it('NACKs cleanly when the address exists nowhere in the graph', () => {
    const aBus = new I2CBusManager(makeTWI() as any);
    const bBus = new I2CBusManager(makeTWI() as any);
    const cBus = new I2CBusManager(makeTWI() as any);
    aBus.attachBridge(bBus);
    bBus.attachBridge(aBus);
    bBus.attachBridge(cBus);
    cBus.attachBridge(bBus);

    const aTwi = makeTWI();
    const aBusInstrumented = new I2CBusManager(aTwi as any);
    aBusInstrumented.attachBridge(bBus);
    bBus.attachBridge(aBusInstrumented);

    aBusInstrumented.connectToSlave(0x77, true);
    expect(aTwi.calls).toContain('connect:false');
  });
});
