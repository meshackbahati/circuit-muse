/**
 * POC test for the Phase 1a interactive ngspice client.
 *
 * What this proves:
 *   - The vendored WASM build loads in a Web Worker
 *   - `loadNetlist` + `command('tran ...')` work end-to-end
 *   - `readVec` returns the right shape of data
 *   - `alter` updates a source and a second `tran` reflects the change
 *
 * What this does NOT test (Phase 1b):
 *   - bg_run / bg_halt / bg_resume — single-threaded WASM doesn't
 *     support useful background mode (see NgSpiceInteractive.ts docstring)
 *   - Mid-simulation event injection — the workaround is short-tran
 *     interleaved with alter, which is what this test exercises.
 *
 * Skipped by default because it requires a live Worker + ~24 MB WASM
 * download, which is too slow / heavy for the regular `npm test` flow.
 * Run explicitly with:
 *     npx vitest run src/__tests__/ngspice-interactive.test.ts \
 *         --reporter verbose
 *
 * In CI we'd run this as a separate "spice-integration" suite with a
 * longer timeout.
 */

import { describe, it, expect } from 'vitest';

// JSDOM doesn't ship a real Worker — these tests need a node env with a
// Worker polyfill OR a browser-like vitest runner.  Skip if Worker is
// unavailable.
const hasWorker = typeof Worker !== 'undefined';

describe.skipIf(!hasWorker)('NgSpiceInteractive — Phase 1a POC', () => {
  it('loads the WASM and runs a simple .op analysis', async () => {
    const { NgSpiceInteractive } = await import(
      '../simulation/spice/wasm/NgSpiceInteractive'
    );
    const ng = new NgSpiceInteractive();
    try {
      await ng.init();
      await ng.loadNetlist(`
* simple voltage divider
Vsrc in 0 DC 5
R1 in mid 1k
R2 mid 0 1k
.op
.end
      `.trim());
      const result = await ng.command('op');
      expect(result.rc).toBe(0);

      const vmid = await ng.readVec('v(mid)');
      // Voltage divider: mid should be ~2.5V (5V split across 1k:1k).
      expect(vmid.real[0]).toBeCloseTo(2.5, 2);
    } finally {
      ng.dispose();
    }
  }, 30_000);

  it('handles a transient analysis and reads the time-series', async () => {
    const { NgSpiceInteractive } = await import(
      '../simulation/spice/wasm/NgSpiceInteractive'
    );
    const ng = new NgSpiceInteractive();
    try {
      await ng.init();
      await ng.loadNetlist(`
* RC step response
Vsrc in 0 DC 5
R1 in cap 1k
C1 cap 0 1u
.tran 100us 5ms uic
.end
      `.trim());
      await ng.command('tran');

      const vcap = await ng.readVec('v(cap)');
      expect(vcap.real.length).toBeGreaterThan(10);

      // Final sample should be near 5V (well past 5τ = 5ms).
      const finalV = vcap.real[vcap.real.length - 1];
      expect(finalV).toBeGreaterThan(4.5);
      expect(finalV).toBeLessThan(5.1);
    } finally {
      ng.dispose();
    }
  }, 30_000);

  it('alters a source between transient phases (mixed-mode workaround)', async () => {
    const { NgSpiceInteractive } = await import(
      '../simulation/spice/wasm/NgSpiceInteractive'
    );
    const ng = new NgSpiceInteractive();
    try {
      await ng.init();
      await ng.loadNetlist(`
Vsrc in 0 DC 5
R1 in cap 1k
C1 cap 0 1u
.tran 100us 5ms uic
.end
      `.trim());
      // Run with Vsrc=5V
      await ng.command('tran');
      const v1 = await ng.readVec('v(cap)');
      const final1 = v1.real[v1.real.length - 1];
      expect(final1).toBeGreaterThan(4.5);

      // Drop the source to 1V and run again — fresh transient, so v(cap)
      // starts from initial conditions and asymptotes toward 1V.
      await ng.alter('Vsrc', 1);
      await ng.command('tran');
      const v2 = await ng.readVec('v(cap)');
      const final2 = v2.real[v2.real.length - 1];
      expect(final2).toBeGreaterThan(0.9);
      expect(final2).toBeLessThan(1.1);
    } finally {
      ng.dispose();
    }
  }, 60_000);
});
