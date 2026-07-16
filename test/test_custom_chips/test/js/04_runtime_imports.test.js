import { describe, it, expect } from 'vitest';
import { ChipInstance } from '../../src/ChipRuntime.js';
import { PinManager } from '../../src/PinManager.js';

/**
 * Build a tiny valid WASM module:
 *   (module
 *     (import "env" "<name>" (func))
 *     (func (export "chip_setup"))
 *   )
 * Used to validate the runtime's "missing import" error reporting.
 */
function buildTinyWasm(missingImportName) {
  const enc = new TextEncoder();
  const env = enc.encode('env');
  const name = enc.encode(missingImportName);
  const exportName = enc.encode('chip_setup');

  const importEntry = [
    env.length, ...env,
    name.length, ...name,
    0x00, 0x00, // kind=func, type idx 0
  ];
  const importSection = [0x02, 1 + importEntry.length, 0x01, ...importEntry];

  const exportEntry = [
    exportName.length, ...exportName,
    0x00, 0x01, // kind=func, idx=1 (after the imported function)
  ];
  const exportSection = [0x07, 1 + exportEntry.length, 0x01, ...exportEntry];

  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,    // magic + version
    0x01, 0x04, 0x01, 0x60, 0x00, 0x00,                 // type section: () → ()
    ...importSection,
    0x03, 0x02, 0x01, 0x00,                             // function section: 1 func, type 0
    ...exportSection,
    0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b,                 // code section: empty body
  ]);
}

describe('ChipRuntime — host import surface', () => {
  it('exposes the velxio-chip imports object on every instance', async () => {
    // We can't fully instantiate without a real chip, but we can construct
    // the instance object up to the point of building imports.
    const pm = new PinManager();
    const inst = new ChipInstance({ wasm: new Uint8Array(0), pinManager: pm });

    // _velxioImports is the env-namespace bag passed to WebAssembly.instantiate.
    const env = inst._velxioImports;
    const required = [
      'vx_pin_register', 'vx_pin_read', 'vx_pin_write', 'vx_pin_read_analog', 'vx_pin_watch',
      'vx_attr_register', 'vx_attr_read',
      'vx_i2c_attach',
      'vx_uart_attach', 'vx_uart_write',
      'vx_sim_now_nanos',
      'vx_timer_create', 'vx_timer_start', 'vx_timer_stop',
      'vx_log',
    ];
    for (const name of required) {
      expect(typeof env[name]).toBe('function');
    }
  });

  it('reports missing host imports clearly (instead of cryptic WASM errors)', async () => {
    const pm = new PinManager();
    const wasm = buildTinyWasm('this_does_not_exist');
    let err;
    try {
      await ChipInstance.create({ wasm, pinManager: pm });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.message).toMatch(/env\.this_does_not_exist/);
  });

  it('instantiates a tiny chip whose only import is vx_log', async () => {
    // Build a WASM that imports env.vx_log (which we DO provide). This
    // should instantiate cleanly, validating the happy path of the loader.
    const pm = new PinManager();
    const wasm = buildTinyWasm('vx_log');
    const chip = await ChipInstance.create({ wasm, pinManager: pm });
    expect(typeof chip.exports.chip_setup).toBe('function');
    chip.start(); // empty body, returns immediately
    chip.dispose();
  });

  it('builds a working WASI shim', async () => {
    const pm = new PinManager();
    const inst = new ChipInstance({ wasm: new Uint8Array(0), pinManager: pm });
    const wasi = inst.wasi.imports();
    expect(wasi.wasi_snapshot_preview1).toBeDefined();
    expect(typeof wasi.wasi_snapshot_preview1.fd_write).toBe('function');
    expect(typeof wasi.wasi_snapshot_preview1.proc_exit).toBe('function');
  });
});
