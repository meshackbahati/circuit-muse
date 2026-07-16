/**
 * digital-gate-engine Phase 3 (core) — the digital/analog boundary handoff.
 *
 * A mixed circuit: a switch drives a NOT gate whose output feeds an ANALOG
 * device (a BJT, here a stand-in), and another analog node feeds a second NOT
 * gate. buildMixedNetwork evaluates the gate (digital) side on the settle kernel
 * and exposes the boundary nets where the two motors hand off:
 *   - digital -> analog: readBoundary() gives the gate-driven level to seed an
 *     ngspice voltage source.
 *   - analog -> digital: setBoundaryInput() pushes ngspice's solved+thresholded
 *     node level onto the net so downstream gates re-evaluate.
 *
 * Verifiable with NO ngspice (the analog side is supplied here). Wiring it to
 * the live solver is the follow-up — the node ngspice loader is broken by a
 * pre-existing path bug, so that step is browser-verified.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resetBusNets } from '../simulation/customChips/busNets';
import { buildMixedNetwork, type DigitalComponent, type DigitalWire } from '../simulation/digital/digitalGateEngine';

beforeEach(() => resetBusNets());

// switch -> NOT(g1) -> [BJT a1] -> NOT(g2) -> out
const components: DigitalComponent[] = [
  { id: 'src', metadataId: 'signal-generator' },
  { id: 'sw1', metadataId: 'slide-switch', properties: { value: 0 } },
  { id: 'g1', metadataId: 'logic-gate-not' },
  { id: 'a1', metadataId: 'bjt-npn' }, // analog (non-primitive)
  { id: 'g2', metadataId: 'logic-gate-not' },
];
const W = (a: string, ap: string, b: string, bp: string): DigitalWire => ({ start: { componentId: a, pinName: ap }, end: { componentId: b, pinName: bp } });
const wires: DigitalWire[] = [
  W('src', 'SIG', 'sw1', '1'),
  W('sw1', '2', 'g1', 'A'),
  W('g1', 'Y', 'a1', 'B'), // boundary OUT (digital drives, analog reads)
  W('a1', 'C', 'g2', 'A'), // boundary IN  (analog drives, digital reads)
];

describe('digital-gate-engine Phase 3 — mixed boundary', () => {
  it('identifies exactly the two nets that bridge digital and analog', () => {
    const net = buildMixedNetwork(components, wires);
    expect(net.ok).toBe(true);
    const outBoundary = net.netOf('g1', 'Y');
    const inBoundary = net.netOf('a1', 'C');
    expect(outBoundary).toBeDefined();
    expect(inBoundary).toBeDefined();
    expect(new Set(net.boundaryNets)).toEqual(new Set([outBoundary, inBoundary]));
  });

  it('digital -> analog: the gate-driven boundary level tracks the switch', () => {
    const net = buildMixedNetwork(components, wires);
    const out = net.netOf('g1', 'Y')!;
    net.setSwitch('sw1', 1); // NOT(1) = 0
    expect(net.readBoundary(out), 'sw=1 -> NOT -> 0').toBe(0);
    net.setSwitch('sw1', 0); // NOT(0) = 1
    expect(net.readBoundary(out), 'sw=0 -> NOT -> 1').toBe(1);
  });

  it('analog -> digital: pushing a boundary level re-evaluates the gate', () => {
    const net = buildMixedNetwork(components, wires);
    const inNet = net.netOf('a1', 'C')!;
    const out = net.netOf('g2', 'Y')!;
    net.setBoundaryInput(inNet, 1); // NOT(1) = 0
    expect(net.readNet(out), 'analog 1 -> NOT -> 0').toBe(0);
    net.setBoundaryInput(inNet, 0); // NOT(0) = 1
    expect(net.readNet(out), 'analog 0 -> NOT -> 1').toBe(1);
  });

  it('a digital->analog->digital chain converges like a coupler iteration', () => {
    // Coupler loop: read the digital-driven boundary, "solve" the analog (here an
    // ideal wire: collector follows base), push it back, read the final output.
    const net = buildMixedNetwork(components, wires);
    const outB = net.netOf('g1', 'Y')!;
    const inB = net.netOf('a1', 'C')!;
    const finalOut = net.netOf('g2', 'Y')!;
    for (const sw of [0, 1, 0, 1] as const) {
      net.setSwitch('sw1', sw);
      const analogIn = net.readBoundary(outB); // g1 = NOT(sw)
      net.setBoundaryInput(inB, analogIn);     // ideal analog: C = B
      // g2 = NOT(analogIn) = NOT(NOT(sw)) = sw
      expect(net.readNet(finalOut), `chain sw=${sw}`).toBe(sw);
    }
  });
});
