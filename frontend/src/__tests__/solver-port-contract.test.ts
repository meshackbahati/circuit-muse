/**
 * Contract tests for the SolverPort interface.
 *
 * Any adapter (real or fake) must satisfy these invariants.  Today
 * `FakeSolverAdapter` is the SUT; once `NgSpiceNodeAdapter` lands
 * (sub-step F1) it will run the same suite to confirm it honours the
 * port contract exactly the same way.
 *
 * Contract:
 *   - init() is idempotent
 *   - loadCircuit() can be called multiple times (replaces previous)
 *   - solve() returns a SolveResult with vectors keyed by lower-case name
 *   - solve() ignores requested vectors that aren't in the engine state
 *   - alterSource() doesn't return data
 *   - dispose() is the final call; subsequent uses are caller's bug
 */
import { describe, it, expect } from 'vitest';
import { FakeSolverAdapter } from '../simulation/spice/adapters/FakeSolverAdapter';

describe('SolverPort contract — FakeSolverAdapter', () => {
  it('init() is idempotent and counted per call', async () => {
    const fake = new FakeSolverAdapter();
    await fake.init();
    await fake.init();
    await fake.init();
    expect(fake.calls.init).toBe(3);
  });

  it('loadCircuit() records every submission', async () => {
    const fake = new FakeSolverAdapter();
    await fake.loadCircuit('first netlist');
    await fake.loadCircuit('second netlist');
    expect(fake.calls.loadCircuit).toEqual(['first netlist', 'second netlist']);
  });

  it('solve() returns SolveResult with requested vectors', async () => {
    const fake = new FakeSolverAdapter({
      vectors: { 'v(n0)': 4.97, 'v(n1)': 0.1, 'i(v_sense)': 0.005 },
    });
    const result = await fake.solve(
      { kind: 'op' },
      { vectorsOfInterest: ['v(n0)', 'v(n1)', 'i(v_sense)'] },
    );
    expect(result.analysis).toEqual({ kind: 'op' });
    expect(result.vectors.get('v(n0)')?.real[0]).toBeCloseTo(4.97);
    expect(result.vectors.get('v(n1)')?.real[0]).toBeCloseTo(0.1);
    expect(result.vectors.get('i(v_sense)')?.real[0]).toBeCloseTo(0.005);
    expect(result.warnings).toEqual([]);
  });

  it('solve() omits requested vectors that are missing from engine state', async () => {
    const fake = new FakeSolverAdapter({ vectors: { 'v(present)': 1.5 } });
    const result = await fake.solve(
      { kind: 'op' },
      { vectorsOfInterest: ['v(present)', 'v(missing)'] },
    );
    expect(result.vectors.has('v(present)')).toBe(true);
    expect(result.vectors.has('v(missing)')).toBe(false);
  });

  it('solve() normalises vector names to lower-case', async () => {
    const fake = new FakeSolverAdapter({ vectors: { 'v(out)': 3.3 } });
    const result = await fake.solve({ kind: 'op' }, { vectorsOfInterest: ['V(OUT)'] });
    expect(result.vectors.has('v(out)')).toBe(true);
    expect(result.vectors.has('V(OUT)')).toBe(false);
  });

  it('solve() honours dynamic vector supplier', async () => {
    let voltage = 1.0;
    const fake = new FakeSolverAdapter({
      vectors: () => ({ 'v(out)': voltage }),
    });
    const r1 = await fake.solve({ kind: 'op' }, { vectorsOfInterest: ['v(out)'] });
    expect(r1.vectors.get('v(out)')?.real[0]).toBeCloseTo(1.0);
    voltage = 4.5;
    const r2 = await fake.solve({ kind: 'op' }, { vectorsOfInterest: ['v(out)'] });
    expect(r2.vectors.get('v(out)')?.real[0]).toBeCloseTo(4.5);
  });

  it('alterSource() records calls and invokes onAlter hook', async () => {
    const fake = new FakeSolverAdapter();
    let lastAlter: [string, number] | null = null;
    fake.onAlter = (name, value) => {
      lastAlter = [name, value];
    };
    await fake.alterSource('V_uno_9', 5);
    expect(fake.calls.alterSource).toEqual([['V_uno_9', 5]]);
    expect(lastAlter).toEqual(['V_uno_9', 5]);
  });

  it('exposes a .tran-shaped result when requested', async () => {
    const fake = new FakeSolverAdapter({
      vectors: { 'v(out)': new Float64Array([0, 1, 2, 3, 4]) },
      timeAxis: new Float64Array([0, 1e-4, 2e-4, 3e-4, 4e-4]),
    });
    const result = await fake.solve(
      { kind: 'tran', step: '1e-4', stop: '4e-4' },
      { vectorsOfInterest: ['v(out)'] },
    );
    expect(result.timeAxis.length).toBe(5);
    expect(result.vectors.get('v(out)')?.real.length).toBe(5);
    expect(result.vectors.get('v(out)')?.real[3]).toBe(3);
  });

  it('solve records all calls with the analysis + vectorsOfInterest', async () => {
    const fake = new FakeSolverAdapter();
    await fake.solve({ kind: 'op' }, { vectorsOfInterest: ['v(a)'] });
    await fake.solve(
      { kind: 'tran', step: '1u', stop: '10m' },
      { vectorsOfInterest: ['v(b)', 'i(v1)'] },
    );
    expect(fake.calls.solve).toEqual([
      { analysis: { kind: 'op' }, vectorsOfInterest: ['v(a)'] },
      {
        analysis: { kind: 'tran', step: '1u', stop: '10m' },
        vectorsOfInterest: ['v(b)', 'i(v1)'],
      },
    ]);
  });

  it('respects solveDelayMs (race-condition tests can use this)', async () => {
    const fake = new FakeSolverAdapter({ solveDelayMs: 50 });
    const t0 = performance.now();
    await fake.solve({ kind: 'op' }, { vectorsOfInterest: [] });
    expect(performance.now() - t0).toBeGreaterThanOrEqual(45);
  });

  it('dispose() is counted; resetCalls() clears the log', async () => {
    const fake = new FakeSolverAdapter();
    fake.dispose();
    fake.dispose();
    expect(fake.calls.dispose).toBe(2);
    fake.resetCalls();
    expect(fake.calls.dispose).toBe(0);
    expect(fake.calls.init).toBe(0);
  });
});
