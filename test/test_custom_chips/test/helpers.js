/**
 * Shared helpers for custom-chip tests.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/** Resolve a path inside fixtures/. */
export function fixture(name) {
  return resolve(here, '..', 'fixtures', name);
}

/** Load a compiled chip .wasm by base name (without extension). */
export function loadChipWasm(name) {
  const p = fixture(`${name}.wasm`);
  if (!existsSync(p)) {
    throw new Error(`Missing fixture: ${p}. Run scripts/compile-all.sh.`);
  }
  return readFileSync(p);
}

export function chipWasmExists(name) {
  return existsSync(fixture(`${name}.wasm`));
}

/** Minimal AVRTWI fake for tests that drive the I2C bus directly (no AVR). */
export function makeFakeTwi() {
  const log = [];
  return {
    eventHandler: null,
    log,
    lastAck: null,
    lastRead: null,
    completeStart()      { log.push(['start']); },
    completeStop()       { log.push(['stop']); },
    completeConnect(ack) { log.push(['connect', ack]); this.lastAck = ack; },
    completeWrite(ack)   { log.push(['write', ack]);   this.lastAck = ack; },
    completeRead(value)  { log.push(['read', value]);  this.lastRead = value; },
  };
}

/**
 * High-level convenience: connect to a slave, write a sequence of bytes, stop.
 * Asserts every byte was ACKed.
 */
export function i2cWrite(bus, twi, address, bytes) {
  bus.connectToSlave(address, false);
  if (twi.lastAck !== true) throw new Error(`I2C connect to 0x${address.toString(16)} NACKed`);
  for (const b of bytes) {
    bus.writeByte(b);
    if (twi.lastAck !== true) throw new Error(`I2C write of 0x${b.toString(16)} NACKed`);
  }
  bus.stop();
}

/**
 * Connect to a slave for read mode, read `count` bytes, stop. Returns array.
 * Optionally resets the pointer first by issuing a write transaction with `setPointer`.
 */
export function i2cRead(bus, twi, address, count) {
  bus.connectToSlave(address, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    bus.readByte(i < count - 1);
    out.push(twi.lastRead);
  }
  bus.stop();
  return out;
}
