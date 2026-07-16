/**
 * Library compile integration test (Phase 1d-tests I — nightly).
 *
 * For every gallery example that declares external Arduino
 * `libraries`, install them via arduino-cli + compile the example's
 * sketch.  Detects:
 *   • Library API drift in upstream releases (a new Adafruit GFX
 *     major breaks every dependent sketch).
 *   • Missing libraries in the index.
 *   • Sketch syntax regressions across our codebase.
 *
 * Gated behind `RUN_LIBRARY_TESTS=1` so the default `npm test` skips
 * the entire file — arduino-cli isn't usually available in dev
 * environments and the compile loop takes ~10 min.  The nightly
 * workflow `.github/workflows/library-compile.yml` sets the env var.
 *
 * Fidelity rule: imports the example arrays from the real source-of-
 * truth modules.  Adding a new example with `libraries` automatically
 * extends this test.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { analogExamples } from '../data/examples-analog';
import { digitalExamples } from '../data/examples-digital';
import { hundredDaysExamples } from '../data/examples-100-days';
import { epaperExamples } from '../data/examples-displays-epaper';
import { picowWifiExamples } from '../data/examples-picow-wifi';
import { circuitExamples } from '../data/examples-circuits';
import type { ExampleProject } from '../data/examples';
import { BOARD_KIND_FQBN, type BoardKind } from '../types/board';

const RUN_LIBRARY_TESTS = process.env.RUN_LIBRARY_TESTS === '1';

const ALL_EXAMPLES: ExampleProject[] = [
  ...analogExamples,
  ...digitalExamples,
  ...hundredDaysExamples,
  ...epaperExamples,
  ...picowWifiExamples,
  ...circuitExamples,
];

interface CompilableExample {
  example: ExampleProject;
  fqbn: string;
  libraries: string[];
}

/**
 * Filter to examples that:
 *   • Have a `code` field (Arduino sketch)
 *   • Have a non-empty `libraries` array (otherwise no value-add over
 *     a vanilla compile that already runs in dev)
 *   • Map to a board with a known FQBN (no Pi 3B — different toolchain)
 */
function eligibleExamples(): CompilableExample[] {
  const out: CompilableExample[] = [];
  for (const ex of ALL_EXAMPLES) {
    if (!ex.code) continue;
    if (!ex.libraries || ex.libraries.length === 0) continue;
    const boardKind: BoardKind = (ex.boardType ?? 'arduino-uno') as BoardKind;
    const fqbn = BOARD_KIND_FQBN[boardKind];
    if (!fqbn) continue;
    out.push({ example: ex, fqbn, libraries: ex.libraries });
  }
  return out;
}

const COMPILABLE = eligibleExamples();

describe.skipIf(!RUN_LIBRARY_TESTS)(
  `arduino-cli library compile (${COMPILABLE.length} examples)`,
  () => {
    it.each(COMPILABLE.map((c) => [c.example.id, c] as const))(
      '%s compiles with its declared libraries',
      { timeout: 300_000 },
      (_id, compilable) => {
        const { example, fqbn, libraries } = compilable;
        // Install libs (idempotent — arduino-cli skips already-installed).
        for (const lib of libraries) {
          try {
            execSync(`arduino-cli lib install "${lib}"`, {
              stdio: 'pipe',
              encoding: 'utf8',
              timeout: 60_000,
            });
          } catch (err) {
            throw new Error(
              `[${example.id}] arduino-cli lib install "${lib}" failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
        // Sketch dir + .ino file.
        const dir = mkdtempSync(path.join(tmpdir(), `velxio-${example.id}-`));
        const inoPath = path.join(dir, `${path.basename(dir)}.ino`);
        writeFileSync(inoPath, example.code ?? '', 'utf8');
        try {
          execSync(`arduino-cli compile --fqbn ${fqbn} "${dir}"`, {
            stdio: 'pipe',
            encoding: 'utf8',
            timeout: 240_000,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`[${example.id}] arduino-cli compile failed:\n${msg}`);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
        expect(true).toBe(true);
      },
    );
  },
);

// Placeholder when disabled so the test runner shows "skipped" rather
// than "no tests".
describe.skipIf(RUN_LIBRARY_TESTS)('library-compile (set RUN_LIBRARY_TESTS=1 to enable)', () => {
  it('placeholder', () => {
    expect(RUN_LIBRARY_TESTS).toBe(false);
  });
});
