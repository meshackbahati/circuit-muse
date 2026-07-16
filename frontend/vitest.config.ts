import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Vitest configuration — split out from `vite.config.ts` (Phase 1d-tests J).
 *
 * `vite.config.ts` no longer owns the `test:` block; vitest auto-loads
 * this file and CI workflows can reference it directly.  Defaults below
 * tune for the velxio test suite:
 *
 *   - 30 s test timeout: smoke tests iterating 200+ examples need
 *     headroom; per-test individual asserts are still fast.
 *   - `forks` pool with `singleFork: false` so each test file runs in
 *     its own Node worker.  The NgSpiceNodeAdapter is a process-wide
 *     singleton (emscripten module can't reinitialise); without per-file
 *     isolation, state leaks between tests sharing the same worker.
 *   - Coverage excludes the WASM bundle (large binary, irrelevant lcov)
 *     and the test files themselves.
 *
 *   - `resolve.alias` mirrors `vite.config.ts` — vitest's defineConfig
 *     does NOT auto-inherit from vite.config.ts, so the @velxio alias
 *     used by overlay tests (e.g. pro/.../snapshot.test.ts importing
 *     `@velxio/store/useEditorStore`) must be declared here too or
 *     test files explode with "Cannot find package '@velxio/...'".
 */
export default defineConfig({
  resolve: {
    alias: {
      '@velxio': path.resolve(__dirname, 'src'),
    },
  },
  // Allow vitest to import test files / sources from outside this
  // project root - specifically `../../pro/frontend/src/pro/...` for
  // velxio-prod overlay tests. Without this, Vite's fs sandbox blocks
  // the read with "Cannot find module '/@fs/...'".
  server: { fs: { allow: ['..', '../..'] } },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/__tests__/**/*.test.ts',
      'src/**/__tests__/**/*.test.ts',
      // velxio-prod pro overlay tests (when run from a velxio-prod
      // checkout — these are the source-of-truth pro tests, not the
      // stale copies at src/pro/). Harmless on pure-OSS clones
      // because the glob has nothing to match there.
      '../../pro/frontend/src/pro/**/__tests__/**/*.test.ts',
    ],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Vitest 4 removed `test.poolOptions` — config moved to top-level
    // `forks` / `threads` / etc. See the deprecation banner the runner
    // emits: "DEPRECATED test.poolOptions was removed in Vitest 4. All
    // previous poolOptions are now top-level options."
    //
    // Each forked worker also needs its heap cap raised because the
    // suite leaks state across the 117 test files (ngspice WASM ~30 MB
    // per init, MixedModeScheduler singleton, zustand stores). Even
    // sharded (60 files / shard) the leak overflows Node's 4 GB
    // default; 8 GB plus sharding fits the runner's 16 GB budget.
    forks: {
      singleFork: false,
      execArgv: ['--max-old-space-size=8192'],
    },
    coverage: {
      provider: 'v8',
      include: [
        'src/simulation/**/*.ts',
        'src/utils/exampleTo*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/__tests__/**',
        'src/simulation/spice/wasm/**',
      ],
      reporter: ['text', 'lcov', 'html'],
    },
  },
});
