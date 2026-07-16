/**
 * Solver performance baseline (Phase 1d-tests G — opt-in).
 *
 * For the same canonical examples that `solver-determinism` locks,
 * measure `solveMs` 10 times each and assert the median solve fits
 * inside a pre-defined ceiling.  Detects perf regressions when
 * someone refactors `NetlistBuilder`, swaps a model, or upgrades
 * ngspice.
 *
 * Gated behind `CI_PERF=1` because:
 *   • Numerics are deterministic, but timings are CI-machine dependent.
 *     A GitHub-hosted runner can be 2-3× slower than a developer
 *     workstation; running this in every PR would flake.
 *   • 10× runs × 6 examples × ~50-500 ms each ≈ 30 s extra wall time.
 *
 * Enable on demand:
 *   CI_PERF=1 npx vitest run src/__tests__/solver-perf-baseline.test.ts
 *
 * Update ceilings in the table below after a deliberate solver
 * change.  The values are deliberately generous (2-3× expected) to
 * tolerate CI variance while still catching 10× regressions.
 */
import { describe, it, expect } from 'vitest';
import { analogExamples } from '../data/examples-analog';
import { digitalExamples } from '../data/examples-digital';
import { exampleToBuildNetlistInput } from '../utils/exampleToBuildNetlistInput';
import { solveInput } from './helpers/solveInput';
import type { ExampleProject } from '../data/examples';

const PERF_ENABLED = process.env.CI_PERF === '1';

/**
 * Per-example median-solve-time ceilings, ms.  Generous to tolerate
 * CI variance; tighten after empirical baselining on a real CI box.
 */
const CEILINGS_MS: Record<string, number> = {
  'an-voltage-divider': 100,
  'an-rc-low-pass': 100,
  'an-half-wave-rectifier': 2000, // .tran with sine generator → slower
  'an-bjt-switch': 200,
  'digital-and-two-switches': 100,
  'digital-not-inverter': 100,
};

function findExample(id: string): ExampleProject | undefined {
  return [...analogExamples, ...digitalExamples].find((ex) => ex.id === id);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid]!;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

describe.skipIf(!PERF_ENABLED)('Solver performance baseline (CI_PERF=1)', () => {
  for (const [id, ceiling] of Object.entries(CEILINGS_MS)) {
    const example = findExample(id);
    if (!example) {
      it.skip(`${id} (not found — ceiling list out of sync)`, () => {});
      continue;
    }
    it(`${id} — median solve ms ≤ ${ceiling}`, { timeout: 60_000 }, async () => {
      const input = exampleToBuildNetlistInput(example);
      const samples: number[] = [];
      for (let i = 0; i < 10; i++) {
        const r = await solveInput(input);
        samples.push(r.solveMs);
      }
      const med = median(samples);
      const all = samples.map((s) => s.toFixed(1)).join(', ');
      expect(
        med,
        `median=${med.toFixed(1)} ms exceeds ${ceiling} ms ceiling for ${id}. Samples: [${all}]`,
      ).toBeLessThanOrEqual(ceiling);
    });
  }
});

// When the suite is disabled (default), expose a trivial it() so the
// file still registers in test discovery and a CI dashboard can show
// "skipped" instead of an empty file.
describe.skipIf(PERF_ENABLED)('Solver performance baseline (disabled — set CI_PERF=1 to enable)', () => {
  it('placeholder', () => {
    expect(PERF_ENABLED).toBe(false);
  });
});
