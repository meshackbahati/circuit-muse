/**
 * Validates the host-side surface for the new API additions:
 *  - vx_pin_watch_stop
 *  - vx_pin_dac_write
 *  - vx_pin_set_mode
 *  - VX_OUTPUT_LOW / VX_OUTPUT_HIGH (initialize pin state via mode)
 *  - vx_spi_attach / vx_spi_start / vx_spi_stop
 *
 * These don't require a real chip — we just check the imports object exposes
 * each function and that the runtime doesn't error when invoked through it.
 */
import { describe, it, expect } from 'vitest';
import { ChipInstance } from '../../src/ChipRuntime.js';
import { PinManager } from '../../src/PinManager.js';

describe('API extras — host surface for new gap-fill features', () => {
  it('exposes every new import in env', async () => {
    const pm = new PinManager();
    const inst = new ChipInstance({ wasm: new Uint8Array(0), pinManager: pm });
    const env = inst._velxioImports;
    for (const name of [
      'vx_pin_dac_write', 'vx_pin_set_mode', 'vx_pin_watch_stop',
      'vx_spi_attach', 'vx_spi_start', 'vx_spi_stop',
    ]) {
      expect(typeof env[name]).toBe('function');
    }
  });

  it('VX_OUTPUT_HIGH initializes pin state to true', () => {
    const pm = new PinManager();
    const inst = new ChipInstance({
      wasm: new Uint8Array(0),
      pinManager: pm,
      wires: new Map([['LED', 700]]),
    });
    // Stub memory so _pin_register can read the cstring.
    inst.memory = new WebAssembly.Memory({ initial: 1 });
    const u8 = new Uint8Array(inst.memory.buffer);
    const name = 'LED\0';
    for (let i = 0; i < name.length; i++) u8[100 + i] = name.charCodeAt(i);
    const handle = inst._pin_register(100, ChipInstance.MODE_OUTPUT_HIGH);
    expect(handle).toBe(0);
    expect(pm.getPinState(700)).toBe(true);
  });

  it('VX_OUTPUT_LOW initializes pin state to false', () => {
    const pm = new PinManager();
    pm.triggerPinChange(701, true);  // start HIGH so we can see it gets driven LOW
    const inst = new ChipInstance({
      wasm: new Uint8Array(0),
      pinManager: pm,
      wires: new Map([['EN', 701]]),
    });
    inst.memory = new WebAssembly.Memory({ initial: 1 });
    const u8 = new Uint8Array(inst.memory.buffer);
    const name = 'EN\0';
    for (let i = 0; i < name.length; i++) u8[200 + i] = name.charCodeAt(i);
    inst._pin_register(200, ChipInstance.MODE_OUTPUT_LOW);
    expect(pm.getPinState(701)).toBe(false);
  });

  it('pin_dac_write fires PinManager analog listeners', () => {
    const pm = new PinManager();
    const samples = [];
    pm.onAnalogChange(800, (_p, v) => samples.push(v));
    const inst = new ChipInstance({
      wasm: new Uint8Array(0),
      pinManager: pm,
      wires: new Map([['AOUT', 800]]),
    });
    inst.memory = new WebAssembly.Memory({ initial: 1 });
    const u8 = new Uint8Array(inst.memory.buffer);
    const name = 'AOUT\0';
    for (let i = 0; i < name.length; i++) u8[300 + i] = name.charCodeAt(i);
    const h = inst._pin_register(300, 1 /* OUTPUT */);
    inst._pin_dac_write(h, 3.3);
    inst._pin_dac_write(h, 0.5);
    expect(samples).toEqual([3.3, 0.5]);
  });
});
