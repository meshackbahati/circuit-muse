/**
 * Test helpers for test_intel. Local mirror of test_custom_chips/test/helpers.js
 * but resolves fixtures relative to test_intel/.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/** Resolve a path inside test_intel/fixtures/. */
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

/** Returns true iff the compiled .wasm is present. Used by it.skipIf(). */
export function chipWasmExists(name) {
  return existsSync(fixture(`${name}.wasm`));
}

/** Format a 16-bit address as 0xXXXX, useful for assertion messages. */
export function hex16(v) {
  return '0x' + (v & 0xffff).toString(16).padStart(4, '0').toUpperCase();
}

/** Format an 8-bit byte as 0xXX. */
export function hex8(v) {
  return '0x' + (v & 0xff).toString(16).padStart(2, '0').toUpperCase();
}
