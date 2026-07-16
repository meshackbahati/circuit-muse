/**
 * Smoke test every example across every gallery bucket (Phase 1d-tests B).
 *
 * Extends the existing `examples-gallery-smoke.test.ts` (which covers
 * only analog + digital) to cover the four buckets that had ZERO test
 * coverage: 100-days, epaper, picow-wifi, circuits.
 *
 * Per example, asserts:
 *   • The `buildNetlist` pipeline produces a valid netlist (doesn't
 *     throw, has non-empty content).
 *   • If the example carries actual electrical components (filtering
 *     out firmware-only and pure-board canvases), the SPICE solve
 *     converges and returns at least one vector or branch current.
 *   • NodeVoltages are finite numbers (no NaN / Infinity).
 *
 * What we do NOT assert: behavioural specifics (values, MCU boot).
 * Per-board MCU boot is in `board-kinds-smoke.test.ts` (Phase 1d-tests
 * D); behavioural locks for canonical circuits live in dedicated
 * spice-* test files.
 *
 * Fidelity (memory `feedback_tests_import_real_code`): imports each
 * example array from its source module + uses the production
 * `exampleToBuildNetlistInput` helper.
 */
import { describe, it, expect } from 'vitest';
import { hundredDaysExamples } from '../data/examples-100-days';
import { epaperExamples } from '../data/examples-displays-epaper';
import { picowWifiExamples } from '../data/examples-picow-wifi';
import { circuitExamples } from '../data/examples-circuits';
import { exampleToBuildNetlistInput } from '../utils/exampleToBuildNetlistInput';
import { solveInput } from './helpers/solveInput';
import type { ExampleProject } from '../data/examples';

interface SmokeOutcome {
  id: string;
  title: string;
  status: 'ok' | 'no-vectors' | 'invalid-numerics' | 'error';
  detail?: string;
}

async function smokeOne(example: ExampleProject): Promise<SmokeOutcome> {
  try {
    const input = exampleToBuildNetlistInput(example);
    // Firmware-only examples (e.g. blink-on-arduino-only) have no
    // SPICE components after filtering boards.  Building the netlist
    // is still a valid sanity check; skip the solve.
    if (input.components.length === 0 && input.wires.length === 0) {
      return { id: example.id, title: example.title, status: 'ok', detail: 'no-SPICE-content' };
    }
    const result = await solveInput(input);
    const voltages = Object.values(result.nodeVoltages);
    if (voltages.length === 0 && Object.values(result.branchCurrents).length === 0) {
      return { id: example.id, title: example.title, status: 'no-vectors' };
    }
    const bad = voltages.find((v) => !Number.isFinite(v));
    if (bad !== undefined) {
      return {
        id: example.id,
        title: example.title,
        status: 'invalid-numerics',
        detail: String(bad),
      };
    }
    return { id: example.id, title: example.title, status: 'ok' };
  } catch (err) {
    return {
      id: example.id,
      title: example.title,
      status: 'error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function buildSuite(bucket: string, examples: ExampleProject[]): void {
  describe(`${bucket} gallery — ${examples.length} examples solve on real ngspice`, () => {
    it.each(examples.map((ex) => [ex.id, ex] as const))(
      '%s',
      { timeout: 30_000 },
      async (_id, example) => {
        const outcome = await smokeOne(example);
        if (outcome.status !== 'ok') {
          throw new Error(
            `[${outcome.id}] "${outcome.title}" → ${outcome.status}${outcome.detail ? ': ' + outcome.detail : ''}`,
          );
        }
      },
    );
  });
}

buildSuite('100-days', hundredDaysExamples);
buildSuite('epaper-displays', epaperExamples);
buildSuite('picow-wifi', picowWifiExamples);
buildSuite('circuits', circuitExamples);
