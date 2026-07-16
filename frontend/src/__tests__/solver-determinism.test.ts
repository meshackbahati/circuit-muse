/**
 * Solver determinism tests (Phase 1d-tests F).
 *
 * For a curated set of representative examples, run `solveInput` three
 * times in a row and assert that every `nodeVoltage` is bit-identical
 * across the runs (within 1e-12 numerical tolerance).
 *
 * Why this matters: ngspice should be deterministic given the same
 * netlist + same convergence options.  If a future change adds a
 * stateful side-effect (random init, residual state from a prior
 * solve, time-of-day in the netlist), this test catches it.  Without
 * determinism, the snapshot tests would flake.
 *
 * Imports the same examples + helpers as the gallery smoke — adding
 * another canonical example to the list below extends coverage.
 */
import { describe, it, expect } from 'vitest';
import { analogExamples } from '../data/examples-analog';
import { digitalExamples } from '../data/examples-digital';
import { exampleToBuildNetlistInput } from '../utils/exampleToBuildNetlistInput';
import { solveInput } from './helpers/solveInput';
import type { ExampleProject } from '../data/examples';

/**
 * Canonical examples — one per archetype the solver should never
 * regress on.  Adding to this list is cheap; removing requires a
 * conscious decision.
 */
const CANONICAL_IDS = [
  // From analog gallery
  'an-voltage-divider',
  'an-rc-low-pass',
  'an-half-wave-rectifier',
  'an-bjt-switch',
  'an-opamp-follower',
  // From digital gallery — picks one of each gate family
  'digital-and-two-switches',
  'digital-or-any-switch',
  'digital-not-inverter',
];

function findExample(id: string): ExampleProject | undefined {
  return [...analogExamples, ...digitalExamples].find((ex) => ex.id === id);
}

function deepEqualWithTolerance(
  a: Record<string, number>,
  b: Record<string, number>,
  tol = 1e-12,
): { ok: boolean; mismatch?: { key: string; a: number; b: number } } {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) {
    return {
      ok: false,
      mismatch: { key: '<key set differs>', a: keysA.length, b: keysB.length },
    };
  }
  for (let i = 0; i < keysA.length; i++) {
    if (keysA[i] !== keysB[i]) {
      return {
        ok: false,
        mismatch: { key: keysA[i]!, a: a[keysA[i]!]!, b: b[keysB[i]!]!},
      };
    }
  }
  for (const key of keysA) {
    const va = a[key]!;
    const vb = b[key]!;
    if (Math.abs(va - vb) > tol) {
      return { ok: false, mismatch: { key, a: va, b: vb } };
    }
  }
  return { ok: true };
}

describe('Solver determinism — same netlist → same vectors across runs', () => {
  for (const id of CANONICAL_IDS) {
    const example = findExample(id);
    if (!example) {
      it.skip(`${id} (not found in canonical examples — list out of sync)`, () => {});
      continue;
    }
    it(`${id} converges to the same nodeVoltages across 3 consecutive solves`, { timeout: 30_000 }, async () => {
      const input = exampleToBuildNetlistInput(example);
      const run1 = await solveInput(input);
      const run2 = await solveInput(input);
      const run3 = await solveInput(input);

      const cmp12 = deepEqualWithTolerance(run1.nodeVoltages, run2.nodeVoltages);
      const cmp23 = deepEqualWithTolerance(run2.nodeVoltages, run3.nodeVoltages);

      if (!cmp12.ok) {
        throw new Error(
          `[${id}] run1 != run2 at "${cmp12.mismatch?.key}": ${cmp12.mismatch?.a} vs ${cmp12.mismatch?.b}`,
        );
      }
      if (!cmp23.ok) {
        throw new Error(
          `[${id}] run2 != run3 at "${cmp23.mismatch?.key}": ${cmp23.mismatch?.a} vs ${cmp23.mismatch?.b}`,
        );
      }
      // Pin the analysisMode + converged flag too — the underlying
      // analysis pick shouldn't flap.
      expect(run1.analysisMode).toBe(run3.analysisMode);
      expect(run1.converged).toBe(run3.converged);
    });
  }

  it('solveInput state does not leak between unrelated examples', { timeout: 30_000 }, async () => {
    // Solve example A, then B, then A again — assert A's two solves
    // produced the same result despite B in between.  Catches
    // singleton-state bugs in the NgSpiceNodeAdapter.
    const a = findExample('an-voltage-divider')!;
    const b = findExample('an-bjt-switch')!;
    const a1 = await solveInput(exampleToBuildNetlistInput(a));
    await solveInput(exampleToBuildNetlistInput(b));
    const a2 = await solveInput(exampleToBuildNetlistInput(a));
    const cmp = deepEqualWithTolerance(a1.nodeVoltages, a2.nodeVoltages);
    if (!cmp.ok) {
      throw new Error(
        `state leaked: ${cmp.mismatch?.key} = ${cmp.mismatch?.a} → ${cmp.mismatch?.b}`,
      );
    }
  });
});
