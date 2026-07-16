/**
 * loadNgSpiceForNode — runtime loader for the vendored ngspice
 * emscripten module in a Node (Vitest) process.
 *
 * The vendored `ngspice-lib.js` is an emscripten singleton build
 * (not MODULARIZE), so the obvious `require('./ngspice-lib.js')`
 * pattern doesn't pass a config to the Module factory.  The CJS
 * module evaluates `var Module = typeof Module != 'undefined' ?
 * Module : {}` in its own scope, which can't see
 * `globalThis.Module`.
 *
 * Workaround: read the source as text, wrap with a hoisted
 * `var Module = config;` so the emscripten guard finds Module
 * already defined (var hoisting + non-redeclaration semantics make
 * the two `var Module` lines refer to the same variable), and
 * evaluate via `new Function`.  Result: our `config` survives and
 * `locateFile` + callbacks work as expected.
 *
 * Only used in Node test contexts.  The browser path
 * (`NgSpiceWorkerAdapter`) goes through the Web Worker which evaluates
 * the lib in its own scope.
 */
// Node-only imports.  This file is never reachable from the browser
// bundle — `runNetlist.ts` gates the dynamic import on
// `typeof Worker === 'undefined'` and Vite tree-shakes it from the
// browser build.  The static import here is what Vite sees when
// bundling this module; once the gate is in place this whole file is
// excluded from the production browser bundle entry.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Subset of the emscripten Module surface we use.  The vendored
 * build adds plenty more, but we only depend on these.
 */
export interface NgSpiceEmscriptenModule {
  cwrap: (
    name: string,
    returnType: string | null,
    argTypes: readonly string[],
  ) => (...args: unknown[]) => unknown;
  addFunction: (fn: (...args: unknown[]) => unknown, signature: string) => number;
  removeFunction: (ptr: number) => void;
  UTF8ToString: (ptr: number) => string;
  stringToUTF8: (str: string, ptr: number, max: number) => void;
  lengthBytesUTF8: (str: string) => number;
  _malloc: (bytes: number) => number;
  _free: (ptr: number) => void;
  _velxio_heap8?: Int8Array;
  _velxio_heap32?: Int32Array;
  _velxio_heapu32?: Uint32Array;
  _velxio_heapf64?: Float64Array;
  /**
   * Note: the vendored build does NOT include `FS` in
   * EXPORTED_RUNTIME_METHODS, so `Module.FS` triggers an abort
   * accessor on this build.  We expose the closure-captured locals
   * via the `_velxio_*` namespace instead — see the wrapper in
   * loadNgSpiceForNode.
   */
  _velxio_fs?: {
    writeFile: (path: string, data: Uint8Array | string) => void;
    mkdir: (path: string) => void;
    analyzePath: (path: string) => { exists: boolean };
  };
  _velxio_env?: Record<string, string>;
  noInitialRun: boolean;
  print?: (text: string) => void;
  printErr?: (text: string) => void;
  locateFile?: (path: string) => string;
  onRuntimeInitialized?: () => void;
}

export interface LoadNgSpiceConfig {
  /** Directory containing ngspice-lib.{js,wasm} + the .cm files. */
  wasmDir: string;
  /** Optional stdout sink (one line at a time). */
  onStdout?: (text: string) => void;
  /** Optional stderr sink. */
  onStderr?: (text: string) => void;
}

function defaultWasmDir(): string {
  // Resolve relative to this file's package location.  `new URL(...).pathname`
  // is portable ESM — no `fileURLToPath` (not available in the browser
  // build shim).  This path is only reached in Node test contexts where
  // import.meta.url is a file:// URL.
  const here = new URL(import.meta.url).pathname;
  return path.resolve(here, '../../../../../../public/wasm/ngspice-interactive');
}

let cachedModule: NgSpiceEmscriptenModule | null = null;
let cachedInit: Promise<NgSpiceEmscriptenModule> | null = null;

/**
 * Load the ngspice WASM module in the current Node process.  Returns
 * the initialised Module on success.
 *
 * Caches the singleton — calling twice returns the same Module.
 * emscripten singleton builds can't be re-initialised within a
 * process, so dispose() is best-effort (resets ngspice state via
 * `ngSpice_Reset`, doesn't free the WASM).
 */
export function loadNgSpiceForNode(
  config: Partial<LoadNgSpiceConfig> = {},
): Promise<NgSpiceEmscriptenModule> {
  if (cachedInit) return cachedInit;

  const wasmDir = config.wasmDir ?? defaultWasmDir();
  const libPath = path.join(wasmDir, 'ngspice-lib.js');

  const moduleConfig: Partial<NgSpiceEmscriptenModule> = {
    noInitialRun: true,
    locateFile: (filename) => {
      // Resolve all asset files (.wasm, .cm, etc.) relative to wasmDir.
      return path.join(wasmDir, filename);
    },
    print: (text: string) => config.onStdout?.(text),
    printErr: (text: string) => config.onStderr?.(text),
  };

  const src = readFileSync(libPath, 'utf8');
  // Wrapping strategy:
  //   1. Hoisted `var Module = config` so the emscripten body's
  //      `var Module = typeof Module != 'undefined' ? Module : {}`
  //      finds Module already defined and keeps our config.
  //   2. After the emscripten body runs, FS / HEAP* are bound to
  //      `var` declarations inside the same closure.  We re-wire
  //      `Module.onRuntimeInitialized` to ALSO copy those locals
  //      onto Module so external code can read them via
  //      `Module.FS`, `Module.HEAPU32`, etc.  The build doesn't
  //      include FS in EXPORTED_RUNTIME_METHODS so this is the
  //      only path that doesn't require recompiling.
  const wrapped = `
    var Module = config;
    ${src}
    var __velxioOriginalInit = Module.onRuntimeInitialized;
    Module.onRuntimeInitialized = function () {
      // Build does not export FS / HEAP* in EXPORTED_RUNTIME_METHODS;
      // those keys on Module trigger abort accessors. Assign to the
      // _velxio_ namespace instead and the NgSpiceNodeAdapter reads
      // from there.
      if (typeof FS !== 'undefined') Module._velxio_fs = FS;
      if (typeof HEAP8 !== 'undefined') Module._velxio_heap8 = HEAP8;
      if (typeof HEAP32 !== 'undefined') Module._velxio_heap32 = HEAP32;
      if (typeof HEAPU32 !== 'undefined') Module._velxio_heapu32 = HEAPU32;
      if (typeof HEAPF64 !== 'undefined') Module._velxio_heapf64 = HEAPF64;
      if (typeof ENV !== 'undefined') Module._velxio_env = ENV;
      if (__velxioOriginalInit) __velxioOriginalInit();
    };
    return Module;
  `;
  const factory = new Function('config', 'require', '__dirname', '__filename', wrapped) as (
    config: unknown,
    req: typeof require,
    dirname: string,
    filename: string,
  ) => NgSpiceEmscriptenModule;

  const req = createRequire(import.meta.url);

  cachedInit = new Promise<NgSpiceEmscriptenModule>((resolve, reject) => {
    moduleConfig.onRuntimeInitialized = () => {
      cachedModule = moduleConfig as NgSpiceEmscriptenModule;
      resolve(cachedModule);
    };
    try {
      factory(moduleConfig, req, wasmDir, libPath);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
    setTimeout(() => reject(new Error('ngspice WASM init timeout (30s)')), 30_000);
  });

  return cachedInit;
}

/**
 * Reset the cached module reference (NOT free the WASM — that's not
 * supported by emscripten singletons).  Subsequent `loadNgSpiceForNode`
 * calls will re-init — which only works if the previous Module was
 * reset via `ngSpice_Reset`.  Best-effort.
 */
export function __resetNgSpiceForTests(): void {
  cachedModule = null;
  cachedInit = null;
}
