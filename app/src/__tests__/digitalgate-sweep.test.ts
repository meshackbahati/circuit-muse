/**
 * digital-gate-engine Phase 3 (sweep) — every gallery digital example is handled
 * by the engine without crashing, and the all-digital ones resolve cleanly.
 *
 * For each of the 38 `examples-digital.ts` circuits: build the network from the
 * real data, and if it is all-digital, drive its switches through a few vectors
 * and confirm every LED resolves (no throw, no settle blow-up). Examples that
 * include a non-primitive (e.g. a 7-segment display) legitimately bail to
 * ngspice — those are reported, not failed. This is the gate for flipping the
 * `?digitalgates` default on.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resetBusNets } from '../simulation/customChips/busNets';
import { buildDigitalNetwork, isAllDigital, type DigitalComponent, type DigitalWire } from '../simulation/digital/digitalGateEngine';
import { digitalExamples } from '../data/examples-digital';

type Ex = { id: string; components: DigitalComponent[]; wires: DigitalWire[] };
const all = digitalExamples as unknown as Ex[];

beforeEach(() => resetBusNets());

describe('digital-gate-engine sweep — all gallery digital examples', () => {
  it('there are at least 35 digital examples to sweep', () => {
    expect(all.length).toBeGreaterThanOrEqual(35);
  });

  it('every example is either all-digital-and-handled or cleanly bails to ngspice', () => {
    const handled: string[] = [];
    const bailed: string[] = [];
    for (const ex of all) {
      const allDigital = isAllDigital(ex.components);
      const net = buildDigitalNetwork(ex.components, ex.wires);
      if (allDigital) {
        expect(net.ok, `${ex.id} is all-digital so should build`).toBe(true);
        handled.push(ex.id);
      } else {
        expect(net.ok, `${ex.id} has a non-primitive so must bail`).toBe(false);
        bailed.push(ex.id);
      }
      resetBusNets();
    }
    // The vast majority are pure gate circuits; only a couple (e.g. 7-seg) bail.
    expect(handled.length, `handled: ${handled.length}, bailed: ${bailed.join(', ')}`).toBeGreaterThanOrEqual(33);
    // eslint-disable-next-line no-console
    console.log(`[sweep] engine handles ${handled.length}/${all.length}; bails (ngspice): ${bailed.join(', ') || 'none'}`);
  });

  it('each handled example drives + reads every LED without throwing or oscillating', () => {
    const warn = console.warn;
    let oscillations = 0;
    console.warn = (...a: unknown[]) => { if (String(a[0]).includes('did not converge')) oscillations++; };
    try {
      for (const ex of all) {
        if (!isAllDigital(ex.components)) continue;
        const switchIds = ex.components.filter((c) => String(c.metadataId ?? c.type ?? '').includes('slide-switch')).map((c) => c.id);
        // a few input vectors: all-low, all-high, alternating
        for (const pattern of [() => 0 as const, () => 1 as const, (i: number) => (i % 2) as 0 | 1]) {
          const net = buildDigitalNetwork(ex.components, ex.wires);
          expect(net.ok).toBe(true);
          switchIds.forEach((id, i) => net.setSwitch(id, pattern(i)));
          for (const led of net.ledIds) {
            const v = net.readLed(led);
            expect(v === 0 || v === 1, `${ex.id} LED ${led} resolved`).toBe(true);
          }
          resetBusNets();
        }
      }
    } finally {
      console.warn = warn;
    }
    expect(oscillations, 'no combinational-loop oscillation in any example').toBe(0);
  });
});
