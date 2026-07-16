/**
 * Smoke test for every example in the velxio gallery.
 *
 * Item #1 of Phase 1d (post-migration cleanup).  After Phase 1c
 * swapped the SPICE engine from `eecircuit-engine` to the vendored
 * `ngspice-interactive`, examples that converged before may not
 * converge now (the LM358 follower is the canonical case).  This
 * test runs every example through the new solver and flags any
 * regression.
 *
 * Test fidelity rule (memory: feedback_tests_import_real_code):
 *   • Imports `analogExamples` / `digitalExamples` from the real
 *     `data/examples-*.ts` modules.  Adding a new example to the
 *     gallery automatically extends this test.
 *   • Uses `exampleToBuildNetlistInput` — the same helper that
 *     production `loadExample.ts` uses.  If the brand-prefix rule
 *     or the board-filter changes, both paths track it.
 *   • Uses `solveInput` (Phase 1c F2 helper) backed by the same
 *     ngspice WASM that production runs.
 *
 * What we assert per example:
 *   1. `buildNetlist` produces a non-empty netlist.
 *   2. The solver returns at least one vector (some converged state
 *      reached the plot).
 *   3. No NaN or Infinity in nodeVoltages.
 *
 * What we do NOT assert: specific voltage values.  Examples have
 * board pins driven by sketches and runtime state we don't replay
 * here — values are pre-deployment sanity, not behavioural locks.
 */
import { describe, it, expect } from 'vitest';
import { analogExamples } from '../data/examples-analog';
import { digitalExamples } from '../data/examples-digital';
import { exampleToBuildNetlistInput } from '../utils/exampleToBuildNetlistInput';
import { solveInput } from './helpers/solveInput';

interface SmokeOutcome {
  id: string;
  title: string;
  status: 'ok' | 'no-vectors' | 'invalid-numerics' | 'error';
  detail?: string;
}

async function smokeOne(
  example: typeof analogExamples[number],
): Promise<SmokeOutcome> {
  try {
    const input = exampleToBuildNetlistInput(example);
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
      return { id: example.id, title: example.title, status: 'invalid-numerics', detail: String(bad) };
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

describe('Gallery smoke — every analog example solves on the new engine', () => {
  it.each(analogExamples.map((ex) => [ex.id, ex] as const))(
    '%s',
    { timeout: 30_000 },
    async (_id, example) => {
      const outcome = await smokeOne(example);
      if (outcome.status !== 'ok') {
        // Throw a structured error so the test report shows what failed.
        throw new Error(
          `[${outcome.id}] "${outcome.title}" → ${outcome.status}${outcome.detail ? ': ' + outcome.detail : ''}`,
        );
      }
    },
  );
});

describe('Gallery smoke — every digital example solves on the new engine', () => {
  it.each(digitalExamples.map((ex) => [ex.id, ex] as const))(
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
