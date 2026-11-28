/**
 * In-app schematic wires. Pins on the same signal net must be visibly joined,
 * and no route may pass through a part (a straight line across two parts made
 * TRIG look connected to 3V3).
 */
import { describe, expect, it } from 'vitest';
import { exampleProjects, getExampleById } from '../data/examples';
import { buildSchematicNetlist } from '../schematic/netlist';
import { layoutSchematic, netWires } from '../schematic/layout';
import { exampleToSchematicInput } from './schematic-helpers';

function inside(x: number, y: number, b: { x1: number; y1: number; x2: number; y2: number }) {
  return x > b.x1 + 1e-6 && x < b.x2 - 1e-6 && y > b.y1 + 1e-6 && y < b.y2 - 1e-6;
}

describe('schematic wires', () => {
  it('joins every pin of a multi-pin signal net to one channel', () => {
    const layout = layoutSchematic(buildSchematicNetlist(exampleToSchematicInput(getExampleById('esp32-hcsr04')! as any)));
    const wires = netWires(layout);
    const labelsByNet = new Map<string, number>();
    for (const l of layout.labels) labelsByNet.set(l.net, (labelsByNet.get(l.net) ?? 0) + 1);
    for (const [net, count] of labelsByNet) {
      if (count < 2) continue;
      const trunks = wires.filter((w) => w.net === net && w.trunk);
      const drops = wires.filter((w) => w.net === net && !w.trunk);
      expect(trunks, net).toHaveLength(1);
      expect(drops, net).toHaveLength(count);
      const y = trunks[0].points[0][1];
      for (const d of drops) expect(d.points[d.points.length - 1][1]).toBe(y);
    }
    // TRIG and ECHO are each joined to the board.
    expect(wires.some((w) => w.trunk && /18/.test(w.net))).toBe(true);
    expect(wires.some((w) => w.trunk && /19/.test(w.net))).toBe(true);
  });

  it('never routes a wire segment through a part, on any example', () => {
    for (const ex of exampleProjects) {
      const layout = layoutSchematic(buildSchematicNetlist(exampleToSchematicInput(ex as any)));
      for (const w of netWires(layout)) {
        for (let i = 1; i < w.points.length; i++) {
          const [x1, y1] = w.points[i - 1];
          const [x2, y2] = w.points[i];
          // Sample the segment; endpoints sit on pins/channels, so skip them.
          for (const t of [0.25, 0.5, 0.75]) {
            const x = x1 + (x2 - x1) * t;
            const y = y1 + (y2 - y1) * t;
            for (const pp of layout.parts) {
              // A part's bounds include its own stubs and label area (labels are
              // hidden when wires show); a wire is checked against other parts.
              // The router treats its own part as an obstacle for every drop.
              if (!w.trunk && inside(w.points[0][0], w.points[0][1], pp.bounds)) continue;
              expect(inside(x, y, pp.bounds), `${ex.id} ${w.net} crosses ${pp.part.ref}`).toBe(false);
            }
          }
        }
      }
    }
  }, 120_000);
});
