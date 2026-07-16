/**
 * NgSpiceNodeAdapter integration test — runs the SAME SolverPort
 * contract suite as solver-port-contract.test.ts but against the
 * real WASM running in the Vitest Node process.
 *
 * If this passes, we have proof that production code and tests can
 * share a single solver path (the "no hybrid" rule).
 *
 * Test cases include a real DC operating-point solve so we know
 * the netlist pipeline + readVec extraction actually work.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { NgSpiceNodeAdapter } from '../simulation/spice/adapters/NgSpiceNodeAdapter';

const adapter = new NgSpiceNodeAdapter();

afterAll(() => {
  adapter.dispose();
});

describe('NgSpiceNodeAdapter — SolverPort contract on real WASM', () => {
  it('init is idempotent', { timeout: 30_000 }, async () => {
    await adapter.init();
    await adapter.init();
    // No throw.
  });

  it(
    'loads + solves an .op on a simple divider, returns the expected v(net)',
    { timeout: 30_000 },
    async () => {
      const netlist = [
        '* simple divider',
        'V1 1 0 DC 5',
        'R1 1 mid 100',
        'R2 mid 0 100',
        '.end',
      ].join('\n');
      await adapter.loadCircuit(netlist);
      const result = await adapter.solve(
        { kind: 'op' },
        { vectorsOfInterest: ['v(1)', 'v(mid)'] },
      );
      expect(result.vectors.size).toBeGreaterThanOrEqual(2);
      expect(result.vectors.get('v(1)')?.real[0]).toBeCloseTo(5, 3);
      expect(result.vectors.get('v(mid)')?.real[0]).toBeCloseTo(2.5, 3);
    },
  );

  it(
    'omits missing vectors silently',
    { timeout: 30_000 },
    async () => {
      const result = await adapter.solve(
        { kind: 'op' },
        { vectorsOfInterest: ['v(1)', 'v(does_not_exist)'] },
      );
      expect(result.vectors.has('v(1)')).toBe(true);
      expect(result.vectors.has('v(does_not_exist)')).toBe(false);
    },
  );

  it(
    'alterSource updates a V source and the next solve sees the new value',
    { timeout: 30_000 },
    async () => {
      // Same divider as before — V1 is still loaded.
      await adapter.alterSource('V1', 10);
      const result = await adapter.solve(
        { kind: 'op' },
        { vectorsOfInterest: ['v(mid)'] },
      );
      expect(result.vectors.get('v(mid)')?.real[0]).toBeCloseTo(5, 3);
    },
  );

  it(
    'transient analysis returns a time axis + samples for an RC step',
    { timeout: 30_000 },
    async () => {
      // Single step at t=0 — uic forces V_cap(0)=0, then DC source
      // charges through R into C.  τ = R·C = 1k·1u = 1 ms.
      const netlist = [
        '* RC charge from a DC step',
        'V1 1 0 DC 5',
        'R1 1 mid 1k',
        'C1 mid 0 1u IC=0',
        '.end',
      ].join('\n');
      await adapter.loadCircuit(netlist);
      const result = await adapter.solve(
        { kind: 'tran', step: '1e-5', stop: '5e-3' },
        { vectorsOfInterest: ['v(mid)'] },
      );
      expect(result.timeAxis.length).toBeGreaterThan(10);
      expect(result.vectors.get('v(mid)')?.real.length).toBe(result.timeAxis.length);
      // After 5τ, vmid ≈ 0.993·5 ≈ 4.97 V.
      const lastV = result.vectors.get('v(mid)')?.real.at(-1) ?? 0;
      expect(lastV).toBeGreaterThan(4.5);
      expect(lastV).toBeLessThan(5.1);
    },
  );
});
