/**
 * Phase 1c F1 smoke test — does the vendored WASM load cleanly in
 * the Vitest Node process?  If this fails, the entire Node adapter
 * path is dead and we have to rethink F1.
 */
import { describe, it, expect } from 'vitest';
import {
  loadNgSpiceForNode,
  __resetNgSpiceForTests,
} from '../simulation/spice/adapters/node/loadNgSpiceForNode';

describe('Phase 1c F1 — Node WASM loader', () => {
  it(
    'boots the ngspice emscripten module and exposes cwrap',
    { timeout: 30_000 },
    async () => {
      __resetNgSpiceForTests();
      const stdout: string[] = [];
      const stderr: string[] = [];
      const Module = await loadNgSpiceForNode({
        onStdout: (t) => stdout.push(t),
        onStderr: (t) => stderr.push(t),
      });
      expect(typeof Module.cwrap).toBe('function');
      expect(typeof Module.addFunction).toBe('function');
      expect(typeof Module.UTF8ToString).toBe('function');
      // The vendored build doesn't export FS; the loader exposes it
      // via _velxio_fs to esquivar the abort accessor.
      expect(Module._velxio_fs).toBeDefined();
      expect(typeof Module._velxio_fs?.writeFile).toBe('function');
    },
  );

  it('cwrap binds ngSpice_Reset (a known no-arg ngspice symbol)', async () => {
    const Module = await loadNgSpiceForNode();
    const reset = Module.cwrap('ngSpice_Reset', 'number', []);
    expect(typeof reset).toBe('function');
  });

  it('addFunction is callable and returns a function-table pointer', async () => {
    const Module = await loadNgSpiceForNode();
    expect(typeof Module.addFunction).toBe('function');
    const noop = () => 0;
    const ptr = Module.addFunction(noop, 'iiii');
    expect(typeof ptr).toBe('number');
    expect(ptr).toBeGreaterThan(0);
  });
});
