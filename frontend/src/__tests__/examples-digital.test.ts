/**
 * Digital examples — SPICE netlist + truth-table validation.
 *
 * For each board-less digital example:
 *   1. It's exported as boardFilter:'digital' (so the gallery groups it).
 *   2. Its wires reference only components that actually exist.
 *   3. buildNetlist produces a non-empty netlist with a ground node.
 *   4. Every component metadataId used is actually mapped to SPICE.
 *   5. Every gate / flip-flop INPUT pin is wired — no floating inputs.
 *      This is the test that catches "loose wires" before they ship.
 *   6. A representative subset is actually solved by ngspice and the
 *      output LED voltages are checked against the expected truth table.
 */
import { describe, it, expect } from 'vitest';
import { digitalExamples } from '../data/examples-digital';
import { buildNetlist } from '../simulation/spice/NetlistBuilder';
import { mappedMetadataIds } from '../simulation/spice/componentToSpice';
import { runNetlist } from './helpers/testSolver';
import { exampleProjects } from '../data/examples';
import type { ExampleProject } from '../data/examples';

function toSpiceComponents(example: (typeof digitalExamples)[number]) {
  return example.components.map((c) => ({
    id: c.id,
    metadataId: c.type.replace(/^(wokwi|velxio)-/, ''),
    properties: c.properties ?? {},
  }));
}

function toSpiceWires(example: (typeof digitalExamples)[number]) {
  return example.wires.map((w) => ({
    id: w.id,
    start: { componentId: w.start.componentId, pinName: w.start.pinName },
    end: { componentId: w.end.componentId, pinName: w.end.pinName },
  }));
}

describe('digitalExamples — shape', () => {
  it('exports at least 15 board-less digital circuits', () => {
    expect(digitalExamples.length).toBeGreaterThanOrEqual(15);
  });

  it('every example uses boardFilter: "digital" and category: "circuits"', () => {
    for (const ex of digitalExamples) {
      expect((ex as any).boardFilter, `${ex.id} boardFilter`).toBe('digital');
      expect(ex.category, `${ex.id} category`).toBe('circuits');
    }
  });

  it('every digital example id is unique and ends up in exampleProjects', () => {
    const allIds = new Set(exampleProjects.map((e) => e.id));
    const missing = digitalExamples.map((e) => e.id).filter((id) => !allIds.has(id));
    expect(missing).toEqual([]);
  });

  it('no example lists a board in its components[]', () => {
    const BOARD_PREFIXES = [
      'wokwi-arduino-',
      'wokwi-esp32',
      'wokwi-raspberry-',
      'wokwi-nano-rp',
      'velxio-esp32',
      'velxio-raspberry-',
      'velxio-pi-pico-w',
      'wokwi-attiny',
    ];
    for (const ex of digitalExamples) {
      const boards = ex.components.filter((c) => BOARD_PREFIXES.some((p) => c.type.startsWith(p)));
      expect(
        boards.map((b) => b.id),
        `${ex.id}`,
      ).toEqual([]);
    }
  });

  it('no example sets a boardType (digital circuits are board-less)', () => {
    for (const ex of digitalExamples) {
      expect(ex.boardType, `${ex.id}`).toBeUndefined();
    }
  });

  it('every component type has a SPICE mapping (flip-flops are digital-engine-only)', () => {
    const mapped = new Set(mappedMetadataIds());
    const unmapped = new Set<string>();
    for (const ex of digitalExamples) {
      for (const c of ex.components) {
        const id = c.type.replace(/^(wokwi|velxio)-/, '');
        // Flip-flops have no SPICE mapper by design (no edge detection at DC);
        // they are evaluated by the digital gate engine, not ngspice.
        if (id.startsWith('flip-flop')) continue;
        if (!mapped.has(id)) unmapped.add(`${ex.id}:${c.id}(${id})`);
      }
    }
    expect(Array.from(unmapped)).toEqual([]);
  });

  it('every wire endpoint references a component that exists', () => {
    for (const ex of digitalExamples) {
      const ids = new Set(ex.components.map((c) => c.id));
      for (const w of ex.wires) {
        expect(ids.has(w.start.componentId), `${ex.id}:${w.id}.start(${w.start.componentId})`).toBe(
          true,
        );
        expect(ids.has(w.end.componentId), `${ex.id}:${w.id}.end(${w.end.componentId})`).toBe(true);
      }
    }
  });

  it('every example has at least one signal-generator (5V rail + SPICE ground)', () => {
    for (const ex of digitalExamples) {
      const hasSig = ex.components.some((c) => c.type === 'wokwi-signal-generator');
      expect(hasSig, `${ex.id} has no signal-generator (no 5V / ground reference)`).toBe(true);
    }
  });

  it('every example has at least one logic gate or flip-flop', () => {
    for (const ex of digitalExamples) {
      const logic = ex.components.filter(
        (c) => c.type.startsWith('velxio-logic-gate-') || c.type.startsWith('velxio-flip-flop-'),
      );
      expect(logic.length, `${ex.id} has no logic gate or flip-flop`).toBeGreaterThanOrEqual(1);
    }
  });
});

/** A sequential example contains a flip-flop — it is evaluated by the digital
 *  gate engine, not ngspice, so it is exempt from the SPICE netlist checks. */
const isSequential = (ex: (typeof digitalExamples)[number]) =>
  ex.components.some((c) => c.type.startsWith('velxio-flip-flop-'));

describe('digitalExamples — netlist generation', () => {
  it('each example produces a non-empty netlist with a ground net', () => {
    for (const ex of digitalExamples) {
      if (isSequential(ex)) continue; // flip-flop circuits have no SPICE netlist
      const { netlist } = buildNetlist({
        components: toSpiceComponents(ex),
        wires: toSpiceWires(ex),
        boards: [],
        analysis: { kind: 'op' },
      });
      expect(netlist.length, `${ex.id} netlist empty`).toBeGreaterThan(20);
      expect(netlist, `${ex.id} missing .end`).toContain('.end');
      // Each signal-generator must drop a V-source whose second node is 0.
      const sigs = ex.components.filter((c) => c.type === 'wokwi-signal-generator');
      for (const sig of sigs) {
        const re = new RegExp(`^V_${sig.id}\\s+\\S+\\s+0\\b`, 'm');
        expect(netlist, `${ex.id}: ${sig.id} GND not canonicalised to 0`).toMatch(re);
      }
    }
  });

  it('every gate emits a B-source card with a 1 MΩ load', () => {
    for (const ex of digitalExamples) {
      const { netlist } = buildNetlist({
        components: toSpiceComponents(ex),
        wires: toSpiceWires(ex),
        boards: [],
        analysis: { kind: 'op' },
      });
      const gates = ex.components.filter((c) => c.type.startsWith('velxio-logic-gate-'));
      for (const g of gates) {
        const bre = new RegExp(`^B_${g.id}\\b`, 'm');
        const rre = new RegExp(`^R_${g.id}_load\\b`, 'm');
        expect(netlist, `${ex.id}: gate ${g.id} missing B-source`).toMatch(bre);
        expect(netlist, `${ex.id}: gate ${g.id} missing load resistor`).toMatch(rre);
      }
    }
  });
});

// ─── Structural: every gate input pin must be wired ───────────────────────
// "Loose wires" usually mean a gate's A/B/C/D input is left dangling — the
// SPICE B-source then references an undriven net and the solve goes
// non-physical. This test enumerates every gate in every example and
// asserts the pins are connected.
const GATE_INPUT_PINS: Record<string, string[]> = {
  'logic-gate-not': ['A'],
  'logic-gate-and': ['A', 'B'],
  'logic-gate-or': ['A', 'B'],
  'logic-gate-nand': ['A', 'B'],
  'logic-gate-nor': ['A', 'B'],
  'logic-gate-xor': ['A', 'B'],
  'logic-gate-xnor': ['A', 'B'],
  'logic-gate-and-3': ['A', 'B', 'C'],
  'logic-gate-or-3': ['A', 'B', 'C'],
  'logic-gate-nand-3': ['A', 'B', 'C'],
  'logic-gate-nor-3': ['A', 'B', 'C'],
  'logic-gate-and-4': ['A', 'B', 'C', 'D'],
  'logic-gate-or-4': ['A', 'B', 'C', 'D'],
  'logic-gate-nand-4': ['A', 'B', 'C', 'D'],
  'logic-gate-nor-4': ['A', 'B', 'C', 'D'],
};

describe('digitalExamples — no loose wires', () => {
  it('every gate input pin is connected to at least one wire', () => {
    const failures: string[] = [];
    for (const ex of digitalExamples) {
      for (const c of ex.components) {
        const metaId = c.type.replace(/^(wokwi|velxio)-/, '');
        const inputPins = GATE_INPUT_PINS[metaId];
        if (!inputPins) continue;
        for (const pin of inputPins) {
          const wired = ex.wires.some(
            (w) =>
              (w.start.componentId === c.id && w.start.pinName === pin) ||
              (w.end.componentId === c.id && w.end.pinName === pin),
          );
          if (!wired) failures.push(`${ex.id}: ${c.id}.${pin} (${metaId}) is floating`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('every gate output pin (Y) feeds at least one wire', () => {
    // A gate whose Y is not consumed isn't catastrophic (SPICE handles it
    // because of the 1 MΩ load), but it usually indicates a wiring mistake
    // — the gate was placed and forgotten. Surface it as a separate failure
    // category so the maintainer can tell which kind of mistake it is.
    const failures: string[] = [];
    for (const ex of digitalExamples) {
      for (const c of ex.components) {
        const metaId = c.type.replace(/^(wokwi|velxio)-/, '');
        if (!GATE_INPUT_PINS[metaId]) continue;
        const wired = ex.wires.some(
          (w) =>
            (w.start.componentId === c.id && w.start.pinName === 'Y') ||
            (w.end.componentId === c.id && w.end.pinName === 'Y'),
        );
        if (!wired) failures.push(`${ex.id}: ${c.id}.Y (${metaId}) output is unused`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('every LED has both A and C wired', () => {
    const failures: string[] = [];
    for (const ex of digitalExamples) {
      const leds = ex.components.filter((c) => c.type === 'wokwi-led');
      for (const l of leds) {
        for (const pin of ['A', 'C']) {
          const wired = ex.wires.some(
            (w) =>
              (w.start.componentId === l.id && w.start.pinName === pin) ||
              (w.end.componentId === l.id && w.end.pinName === pin),
          );
          if (!wired) failures.push(`${ex.id}: led ${l.id}.${pin} is floating`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('every slide switch routes pin 2 (output) to something', () => {
    // SPICE only models pin 1 ↔ pin 2 of a slide-switch. If pin 2 is
    // floating, toggling the switch produces no visible effect.
    const failures: string[] = [];
    for (const ex of digitalExamples) {
      const sws = ex.components.filter((c) => c.type === 'wokwi-slide-switch');
      for (const s of sws) {
        const wired = ex.wires.some(
          (w) =>
            (w.start.componentId === s.id && w.start.pinName === '2') ||
            (w.end.componentId === s.id && w.end.pinName === '2'),
        );
        if (!wired) failures.push(`${ex.id}: switch ${s.id}.2 (output) is floating`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('every wire endpoint references a real pin on its component', () => {
    // Hard-coded valid pin names per component metadataId. If we ever rename
    // a pin upstream, this test will flag every example that refers to the
    // old name — useful as both a unit test and a refactor net.
    const VALID_PINS: Record<string, string[]> = {
      'signal-generator': ['SIG', 'GND'],
      led: ['A', 'C'],
      resistor: ['1', '2'],
      'slide-switch': ['1', '2', '3'],
      pushbutton: ['1.l', '2.l', '1.r', '2.r'],
      'logic-gate-not': ['A', 'Y'],
      'logic-gate-and': ['A', 'B', 'Y'],
      'logic-gate-or': ['A', 'B', 'Y'],
      'logic-gate-nand': ['A', 'B', 'Y'],
      'logic-gate-nor': ['A', 'B', 'Y'],
      'logic-gate-xor': ['A', 'B', 'Y'],
      'logic-gate-xnor': ['A', 'B', 'Y'],
      'logic-gate-and-3': ['A', 'B', 'C', 'Y'],
      'logic-gate-or-3': ['A', 'B', 'C', 'Y'],
      'logic-gate-nand-3': ['A', 'B', 'C', 'Y'],
      'logic-gate-nor-3': ['A', 'B', 'C', 'Y'],
      'logic-gate-and-4': ['A', 'B', 'C', 'D', 'Y'],
      'logic-gate-or-4': ['A', 'B', 'C', 'D', 'Y'],
      'logic-gate-nand-4': ['A', 'B', 'C', 'D', 'Y'],
      'logic-gate-nor-4': ['A', 'B', 'C', 'D', 'Y'],
    };
    const failures: string[] = [];
    for (const ex of digitalExamples) {
      const byId = new Map(ex.components.map((c) => [c.id, c]));
      for (const wire of ex.wires) {
        for (const ep of [wire.start, wire.end]) {
          const c = byId.get(ep.componentId);
          if (!c) continue; // already caught by a previous test
          const metaId = c.type.replace(/^(wokwi|velxio)-/, '');
          const valid = VALID_PINS[metaId];
          if (!valid) continue; // skip components we haven't catalogued
          if (!valid.includes(ep.pinName)) {
            failures.push(
              `${ex.id}: wire ${wire.id} references ${ep.componentId}.${ep.pinName} (not a valid ${metaId} pin)`,
            );
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('no wire shorts two switch outputs together', () => {
    // A wire connecting two slide-switch pin-2 outputs would create a
    // contention point — both switches drive the same node and SPICE picks
    // a compromise voltage. Catch this anti-pattern early.
    const failures: string[] = [];
    for (const ex of digitalExamples) {
      const switchIds = new Set(
        ex.components.filter((c) => c.type === 'wokwi-slide-switch').map((c) => c.id),
      );
      for (const w of ex.wires) {
        const a = w.start;
        const b = w.end;
        if (
          a.pinName === '2' &&
          b.pinName === '2' &&
          switchIds.has(a.componentId) &&
          switchIds.has(b.componentId) &&
          a.componentId !== b.componentId
        ) {
          failures.push(`${ex.id}: wire ${w.id} shorts ${a.componentId}.2 to ${b.componentId}.2`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('no wire drives a slide-switch terminal from a gate output', () => {
    // A gate Y connected to switch pin 1 / 2 / 3 would let the gate override
    // the user's switch state — meaningless and confusing in a teaching
    // example. (Pull-down resistors are wired to switch pin 2 from the
    // GROUND side, never from a gate output.)
    const failures: string[] = [];
    for (const ex of digitalExamples) {
      const byId = new Map(ex.components.map((c) => [c.id, c]));
      for (const w of ex.wires) {
        const startC = byId.get(w.start.componentId);
        const endC = byId.get(w.end.componentId);
        const startIsGateY =
          startC?.type.startsWith('velxio-logic-gate-') && w.start.pinName === 'Y';
        const endIsGateY =
          endC?.type.startsWith('velxio-logic-gate-') && w.end.pinName === 'Y';
        const startIsSwitch = startC?.type === 'wokwi-slide-switch';
        const endIsSwitch = endC?.type === 'wokwi-slide-switch';
        if ((startIsGateY && endIsSwitch) || (endIsGateY && startIsSwitch)) {
          failures.push(
            `${ex.id}: wire ${w.id} drives a switch terminal from a gate Y output`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('every signal-generator has its SIG and GND pins wired', () => {
    // The power source has only two pins. If either is unwired the SPICE
    // ground reference (or the 5 V rail) is missing.
    const failures: string[] = [];
    for (const ex of digitalExamples) {
      const sgs = ex.components.filter((c) => c.type === 'wokwi-signal-generator');
      for (const s of sgs) {
        for (const pin of ['SIG', 'GND']) {
          const wired = ex.wires.some(
            (w) =>
              (w.start.componentId === s.id && w.start.pinName === pin) ||
              (w.end.componentId === s.id && w.end.pinName === pin),
          );
          if (!wired) failures.push(`${ex.id}: signal-generator ${s.id}.${pin} floating`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('every resistor has both terminals wired', () => {
    const failures: string[] = [];
    for (const ex of digitalExamples) {
      const rs = ex.components.filter((c) => c.type === 'wokwi-resistor');
      for (const r of rs) {
        for (const pin of ['1', '2']) {
          const wired = ex.wires.some(
            (w) =>
              (w.start.componentId === r.id && w.start.pinName === pin) ||
              (w.end.componentId === r.id && w.end.pinName === pin),
          );
          if (!wired) failures.push(`${ex.id}: resistor ${r.id}.${pin} floating`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

// ─── Live SPICE solves — verify the netlist actually converges ──────────────
// We don't run a full truth table per circuit (that'd be hundreds of solves
// per CI run). Instead, every example is solved with all switches OPEN
// (low) and all switches CLOSED (high) — if either fails, the circuit is
// structurally broken.
function withSwitchValues(ex: ExampleProject, value: 0 | 1): ExampleProject {
  return {
    ...ex,
    components: ex.components.map((c) =>
      c.type === 'wokwi-slide-switch'
        ? { ...c, properties: { ...c.properties, value } }
        : c,
    ),
  };
}

async function solveExample(ex: ExampleProject) {
  const { netlist } = buildNetlist({
    components: toSpiceComponents(ex),
    wires: toSpiceWires(ex),
    boards: [],
    analysis: { kind: 'op' },
  });
  return runNetlist(netlist);
}

describe('digitalExamples — live ngspice convergence', () => {
  for (const ex of digitalExamples) {
    it(
      `${ex.id} solves with switches all-LOW and all-HIGH`,
      { timeout: 30_000 },
      async () => {
        const low = await solveExample(withSwitchValues(ex, 0));
        expect(
          low.variableNames.length,
          `${ex.id} (all LOW): no variables returned`,
        ).toBeGreaterThan(0);
        const high = await solveExample(withSwitchValues(ex, 1));
        expect(
          high.variableNames.length,
          `${ex.id} (all HIGH): no variables returned`,
        ).toBeGreaterThan(0);
      },
    );
  }
});

// ─── Truth-table archetypes ────────────────────────────────────────────────
// For each gate-archetype, sweep its switches through every input
// combination and check that the gate output drives the expected LED.
// `gateOutputV` extracts the SPICE node attached to a gate's Y pin by
// parsing the gate's `B_<id>` card — the first token after the name is the
// positive node, which is the Y net.
async function gateOutputV(
  ex: ExampleProject,
  gateId: string,
  switchSettings: Record<string, 0 | 1>,
): Promise<number> {
  const patched: ExampleProject = {
    ...ex,
    components: ex.components.map((c) => {
      if (c.type !== 'wokwi-slide-switch') return c;
      const v = switchSettings[c.id];
      if (v === undefined) return c;
      return { ...c, properties: { ...c.properties, value: v } };
    }),
  };
  const { netlist } = buildNetlist({
    components: toSpiceComponents(patched),
    wires: toSpiceWires(patched),
    boards: [],
    analysis: { kind: 'op' },
  });
  // Gates emit `B_<id> <yNode> 0 V = ...` — pick out yNode.
  const bRe = new RegExp(`^B_${gateId}\\s+(\\S+)\\s+`, 'm');
  const m = netlist.match(bRe);
  if (!m) throw new Error(`No B-source for gate ${gateId} in netlist`);
  const yNet = m[1];
  const result = await runNetlist(netlist);
  return result.dcValue(`v(${yNet})`);
}

function isHIGH(v: number) {
  return v > 4.0;
}
function isLOW(v: number) {
  return v < 1.0;
}

describe('digitalExamples — truth table spot checks', () => {
  it(
    'AND gate: only HIGH when both inputs HIGH',
    { timeout: 30_000 },
    async () => {
      const ex = digitalExamples.find((e) => e.id === 'digital-and-two-switches')!;
      expect(ex, 'AND example present').toBeDefined();
      const cases: Array<[0 | 1, 0 | 1, boolean]> = [
        [0, 0, false],
        [1, 0, false],
        [0, 1, false],
        [1, 1, true],
      ];
      for (const [a, b, expected] of cases) {
        const v = await gateOutputV(ex, 'u1', { s1: a, s2: b });
        if (expected) expect(isHIGH(v), `AND(${a},${b}) → ${v}V (want HIGH)`).toBe(true);
        else expect(isLOW(v), `AND(${a},${b}) → ${v}V (want LOW)`).toBe(true);
      }
    },
  );

  it(
    'XOR gate: HIGH when inputs differ',
    { timeout: 30_000 },
    async () => {
      const ex = digitalExamples.find((e) => e.id === 'digital-xor-difference')!;
      expect(ex, 'XOR example present').toBeDefined();
      const cases: Array<[0 | 1, 0 | 1, boolean]> = [
        [0, 0, false],
        [1, 0, true],
        [0, 1, true],
        [1, 1, false],
      ];
      for (const [a, b, expected] of cases) {
        const v = await gateOutputV(ex, 'u1', { s1: a, s2: b });
        if (expected) expect(isHIGH(v), `XOR(${a},${b}) → ${v}V (want HIGH)`).toBe(true);
        else expect(isLOW(v), `XOR(${a},${b}) → ${v}V (want LOW)`).toBe(true);
      }
    },
  );

  it(
    'NAND-built XOR: matches XOR truth table',
    { timeout: 30_000 },
    async () => {
      const ex = digitalExamples.find((e) => e.id === 'digital-xor-from-nands')!;
      expect(ex, 'NAND-only XOR present').toBeDefined();
      const cases: Array<[0 | 1, 0 | 1, boolean]> = [
        [0, 0, false],
        [1, 0, true],
        [0, 1, true],
        [1, 1, false],
      ];
      for (const [a, b, expected] of cases) {
        const v = await gateOutputV(ex, 'n4', { sA: a, sB: b });
        if (expected) expect(isHIGH(v), `NAND-XOR(${a},${b}) → ${v}V (want HIGH)`).toBe(true);
        else expect(isLOW(v), `NAND-XOR(${a},${b}) → ${v}V (want LOW)`).toBe(true);
      }
    },
  );

  it(
    'Half adder: SUM = A XOR B, CARRY = A AND B',
    { timeout: 30_000 },
    async () => {
      const ex = digitalExamples.find((e) => e.id === 'digital-half-adder')!;
      expect(ex, 'half adder present').toBeDefined();
      const cases: Array<[0 | 1, 0 | 1, boolean, boolean]> = [
        [0, 0, false, false],
        [1, 0, true, false],
        [0, 1, true, false],
        [1, 1, false, true],
      ];
      for (const [a, b, sum, car] of cases) {
        const vS = await gateOutputV(ex, 'gSum', { sA: a, sB: b });
        const vC = await gateOutputV(ex, 'gC', { sA: a, sB: b });
        if (sum) expect(isHIGH(vS), `HA(${a},${b}).SUM → ${vS}V (want HIGH)`).toBe(true);
        else expect(isLOW(vS), `HA(${a},${b}).SUM → ${vS}V (want LOW)`).toBe(true);
        if (car) expect(isHIGH(vC), `HA(${a},${b}).CARRY → ${vC}V (want HIGH)`).toBe(true);
        else expect(isLOW(vC), `HA(${a},${b}).CARRY → ${vC}V (want LOW)`).toBe(true);
      }
    },
  );

  it(
    'Full adder: SUM and Cout match A+B+Cin',
    { timeout: 30_000 },
    async () => {
      const ex = digitalExamples.find((e) => e.id === 'digital-full-adder')!;
      expect(ex, 'full adder present').toBeDefined();
      for (let a = 0 as 0 | 1; a <= 1; a = (a + 1) as 0 | 1) {
        for (let b = 0 as 0 | 1; b <= 1; b = (b + 1) as 0 | 1) {
          for (let ci = 0 as 0 | 1; ci <= 1; ci = (ci + 1) as 0 | 1) {
            const total = a + b + ci;
            const expSum = total & 1;
            const expCo = total >> 1;
            const vS = await gateOutputV(ex, 'x2', { sA: a, sB: b, sCi: ci });
            const vC = await gateOutputV(ex, 'orC', { sA: a, sB: b, sCi: ci });
            if (expSum)
              expect(isHIGH(vS), `FA(${a},${b},${ci}).SUM → ${vS}V (want HIGH)`).toBe(true);
            else expect(isLOW(vS), `FA(${a},${b},${ci}).SUM → ${vS}V (want LOW)`).toBe(true);
            if (expCo)
              expect(isHIGH(vC), `FA(${a},${b},${ci}).Cout → ${vC}V (want HIGH)`).toBe(true);
            else expect(isLOW(vC), `FA(${a},${b},${ci}).Cout → ${vC}V (want LOW)`).toBe(true);
          }
        }
      }
    },
  );

  it(
    'Majority voter: HIGH iff ≥ 2 of 3 inputs HIGH',
    { timeout: 30_000 },
    async () => {
      const ex = digitalExamples.find((e) => e.id === 'digital-majority-voter')!;
      expect(ex, 'majority voter present').toBeDefined();
      for (let a = 0 as 0 | 1; a <= 1; a = (a + 1) as 0 | 1) {
        for (let b = 0 as 0 | 1; b <= 1; b = (b + 1) as 0 | 1) {
          for (let c = 0 as 0 | 1; c <= 1; c = (c + 1) as 0 | 1) {
            const expected = a + b + c >= 2;
            const v = await gateOutputV(ex, 'or3', { sA: a, sB: b, sC: c });
            if (expected) expect(isHIGH(v), `MAJ(${a},${b},${c}) → ${v}V (want HIGH)`).toBe(true);
            else expect(isLOW(v), `MAJ(${a},${b},${c}) → ${v}V (want LOW)`).toBe(true);
          }
        }
      }
    },
  );

  it(
    '2-to-1 MUX: SEL routes D0 or D1 to Y',
    { timeout: 30_000 },
    async () => {
      const ex = digitalExamples.find((e) => e.id === 'digital-mux-2to1')!;
      expect(ex, '2-to-1 MUX present').toBeDefined();
      // SEL = 0 → Y = D0;  SEL = 1 → Y = D1
      const cases: Array<[0 | 1, 0 | 1, 0 | 1, boolean]> = [
        [0, 0, 0, false],
        [0, 1, 0, true],
        [0, 0, 1, false],
        [0, 1, 1, true],
        [1, 0, 0, false],
        [1, 1, 0, false],
        [1, 0, 1, true],
        [1, 1, 1, true],
      ];
      for (const [sel, d0, d1, expected] of cases) {
        const v = await gateOutputV(ex, 'orY', { sSel: sel, sD0: d0, sD1: d1 });
        if (expected)
          expect(isHIGH(v), `MUX(sel=${sel},d0=${d0},d1=${d1}) → ${v}V HIGH`).toBe(true);
        else expect(isLOW(v), `MUX(sel=${sel},d0=${d0},d1=${d1}) → ${v}V LOW`).toBe(true);
      }
    },
  );

  it(
    '2-to-4 decoder: exactly one output HIGH per input combination',
    { timeout: 30_000 },
    async () => {
      const ex = digitalExamples.find((e) => e.id === 'digital-decoder-2to4')!;
      expect(ex, '2-to-4 decoder present').toBeDefined();
      const outs = ['a0', 'a1', 'a2', 'a3']; // Y0..Y3 gates
      for (let a = 0 as 0 | 1; a <= 1; a = (a + 1) as 0 | 1) {
        for (let b = 0 as 0 | 1; b <= 1; b = (b + 1) as 0 | 1) {
          const expectedIdx = (b << 1) | a;
          for (let i = 0; i < 4; i++) {
            const v = await gateOutputV(ex, outs[i], { sA: a, sB: b });
            if (i === expectedIdx)
              expect(isHIGH(v), `dec(A=${a},B=${b}) Y${i} → ${v}V (want HIGH)`).toBe(true);
            else expect(isLOW(v), `dec(A=${a},B=${b}) Y${i} → ${v}V (want LOW)`).toBe(true);
          }
        }
      }
    },
  );

  it(
    'Hamming(7,4): p1 = D0 XOR D1 XOR D3 (spot check)',
    { timeout: 30_000 },
    async () => {
      const ex = digitalExamples.find((e) => e.id === 'digital-hamming-encoder-74')!;
      expect(ex, 'Hamming encoder present').toBeDefined();
      // Spot-check four points of the 16-row truth table for p1.
      const cases: Array<[0 | 1, 0 | 1, 0 | 1, 0 | 1, boolean]> = [
        [0, 0, 0, 0, false],
        [1, 0, 0, 0, true],
        [0, 1, 0, 0, true],
        [1, 1, 0, 1, true],
      ];
      for (const [d0, d1, d2, d3, expected] of cases) {
        const v = await gateOutputV(ex, 'hmP1b', { hmD0: d0, hmD1: d1, hmD2: d2, hmD3: d3 });
        if (expected)
          expect(isHIGH(v), `p1(D=${d3}${d2}${d1}${d0}) → ${v}V (want HIGH)`).toBe(true);
        else expect(isLOW(v), `p1(D=${d3}${d2}${d1}${d0}) → ${v}V (want LOW)`).toBe(true);
      }
    },
  );
});

// ─── Truth-table verification for the BIG advanced examples ────────────────
// These were only smoke-tested for SPICE convergence before. We now run a
// handful of input combinations through each large network and confirm the
// gate outputs match the textbook truth table. Each test is bounded to a
// few cases so the SPICE solve count per CI run stays reasonable.
describe('digitalExamples — advanced truth tables', () => {
  it(
    '4-bit ripple-carry adder: sum bits match A+B+Cin',
    { timeout: 60_000 },
    async () => {
      const ex = digitalExamples.find((e) => e.id === 'digital-ripple-adder-4bit')!;
      expect(ex, 'ripple adder present').toBeDefined();
      type Bit = 0 | 1;
      const cases: Array<{ A: number; B: number; Ci: Bit }> = [
        { A: 0b0000, B: 0b0000, Ci: 0 },
        { A: 0b0001, B: 0b0001, Ci: 0 }, // 1+1=2
        { A: 0b0011, B: 0b0101, Ci: 0 }, // 3+5=8
        { A: 0b0111, B: 0b1000, Ci: 0 }, // 7+8=15
        { A: 0b1111, B: 0b0001, Ci: 0 }, // 15+1=16 → Cout
      ];
      for (const tc of cases) {
        const total = tc.A + tc.B + tc.Ci;
        const switches: Record<string, Bit> = { sCin: tc.Ci };
        for (let i = 0; i < 4; i++) {
          switches[`sA${i}`] = ((tc.A >> i) & 1) as Bit;
          switches[`sB${i}`] = ((tc.B >> i) & 1) as Bit;
        }
        for (let i = 0; i < 4; i++) {
          const v = await gateOutputV(ex, `x2_${i}`, switches);
          const want = (total >> i) & 1;
          if (want)
            expect(isHIGH(v), `RCA(${tc.A}+${tc.B}+${tc.Ci}).S${i} → ${v}V (want HIGH)`).toBe(true);
          else
            expect(isLOW(v), `RCA(${tc.A}+${tc.B}+${tc.Ci}).S${i} → ${v}V (want LOW)`).toBe(true);
        }
        const cout = (total >> 4) & 1;
        const vC = await gateOutputV(ex, 'orC_3', switches);
        if (cout)
          expect(isHIGH(vC), `RCA(${tc.A}+${tc.B}).Cout → ${vC}V (want HIGH)`).toBe(true);
        else expect(isLOW(vC), `RCA(${tc.A}+${tc.B}).Cout → ${vC}V (want LOW)`).toBe(true);
      }
    },
  );

  it(
    '2-bit × 2-bit multiplier: product bits match A × B',
    { timeout: 30_000 },
    async () => {
      const ex = digitalExamples.find((e) => e.id === 'digital-multiplier-2x2')!;
      expect(ex, 'multiplier present').toBeDefined();
      type Bit = 0 | 1;
      const cases: Array<{ A: number; B: number }> = [
        { A: 0, B: 0 },
        { A: 2, B: 3 }, // 6
        { A: 3, B: 3 }, // 9
        { A: 3, B: 2 }, // 6
      ];
      for (const { A, B } of cases) {
        const product = A * B;
        const switches: Record<string, Bit> = {
          sA0: (A & 1) as Bit,
          sA1: ((A >> 1) & 1) as Bit,
          sB0: (B & 1) as Bit,
          sB1: ((B >> 1) & 1) as Bit,
        };
        const probes: Array<[string, number]> = [
          ['pA0B0', 0],
          ['p1Sum', 1],
          ['p2Sum', 2],
          ['p3Car', 3],
        ];
        for (const [gate, bit] of probes) {
          const v = await gateOutputV(ex, gate, switches);
          const want = (product >> bit) & 1;
          if (want)
            expect(isHIGH(v), `${A}×${B}=${product}, P${bit} → ${v}V (want HIGH)`).toBe(true);
          else
            expect(isLOW(v), `${A}×${B}=${product}, P${bit} → ${v}V (want LOW)`).toBe(true);
        }
      }
    },
  );

  it(
    '4-bit popcount: bit count of X3..X0 matches output',
    { timeout: 30_000 },
    async () => {
      const ex = digitalExamples.find((e) => e.id === 'digital-popcount-4bit')!;
      expect(ex, 'popcount present').toBeDefined();
      type Bit = 0 | 1;
      const cases: Array<{ in: number; count: number }> = [
        { in: 0b0000, count: 0 },
        { in: 0b0001, count: 1 },
        { in: 0b0101, count: 2 },
        { in: 0b0111, count: 3 },
        { in: 0b1111, count: 4 },
      ];
      const probes: Array<[string, number]> = [
        ['pcSC', 0],
        ['pcFA_x2', 1],
        ['pcFA_or', 2],
      ];
      for (const { in: inVal, count } of cases) {
        const switches: Record<string, Bit> = {};
        for (let i = 0; i < 4; i++) switches[`pcX${i}`] = ((inVal >> i) & 1) as Bit;
        for (const [gate, bit] of probes) {
          const v = await gateOutputV(ex, gate, switches);
          const want = (count >> bit) & 1;
          if (want)
            expect(isHIGH(v), `popcount(${inVal.toString(2)})=${count}, bit${bit} → ${v}V HIGH`).toBe(true);
          else
            expect(isLOW(v), `popcount(${inVal.toString(2)})=${count}, bit${bit} → ${v}V LOW`).toBe(true);
        }
      }
    },
  );

  it(
    '3-to-8 decoder: exactly Y_i is HIGH for input i',
    { timeout: 60_000 },
    async () => {
      const ex = digitalExamples.find((e) => e.id === 'digital-decoder-3to8')!;
      expect(ex, '3-to-8 decoder present').toBeDefined();
      type Bit = 0 | 1;
      for (let n = 0; n < 8; n++) {
        const switches: Record<string, Bit> = {
          dec3A0: (n & 1) as Bit,
          dec3A1: ((n >> 1) & 1) as Bit,
          dec3A2: ((n >> 2) & 1) as Bit,
        };
        for (let i = 0; i < 8; i++) {
          const v = await gateOutputV(ex, `dec3Y${i}`, switches);
          if (i === n)
            expect(isHIGH(v), `dec(in=${n}) Y${i} → ${v}V (want HIGH)`).toBe(true);
          else expect(isLOW(v), `dec(in=${n}) Y${i} → ${v}V (want LOW)`).toBe(true);
        }
      }
    },
  );

  it(
    '4-bit magnitude comparator: A>B / A=B / A<B',
    { timeout: 30_000 },
    async () => {
      const ex = digitalExamples.find((e) => e.id === 'digital-comparator-4bit')!;
      expect(ex, '4-bit comparator present').toBeDefined();
      type Bit = 0 | 1;
      const cases: Array<{ A: number; B: number; gt: boolean; eq: boolean; lt: boolean }> = [
        { A: 0, B: 0, gt: false, eq: true, lt: false },
        { A: 5, B: 3, gt: true, eq: false, lt: false },
        { A: 3, B: 5, gt: false, eq: false, lt: true },
        { A: 15, B: 0, gt: true, eq: false, lt: false },
        { A: 0, B: 15, gt: false, eq: false, lt: true },
        { A: 10, B: 10, gt: false, eq: true, lt: false },
      ];
      for (const { A, B, gt, eq, lt } of cases) {
        const switches: Record<string, Bit> = {};
        for (let i = 0; i < 4; i++) {
          switches[`cmpA${i}`] = ((A >> i) & 1) as Bit;
          switches[`cmpB${i}`] = ((B >> i) & 1) as Bit;
        }
        const vGt = await gateOutputV(ex, 'cmpGtAll', switches);
        const vEq = await gateOutputV(ex, 'cmpEqAll', switches);
        const vLt = await gateOutputV(ex, 'cmpLt', switches);
        if (gt) expect(isHIGH(vGt), `cmp(${A}>${B}) → ${vGt}V HIGH`).toBe(true);
        else expect(isLOW(vGt), `cmp(${A}>${B}) → ${vGt}V LOW`).toBe(true);
        if (eq) expect(isHIGH(vEq), `cmp(${A}=${B}) → ${vEq}V HIGH`).toBe(true);
        else expect(isLOW(vEq), `cmp(${A}=${B}) → ${vEq}V LOW`).toBe(true);
        if (lt) expect(isHIGH(vLt), `cmp(${A}<${B}) → ${vLt}V HIGH`).toBe(true);
        else expect(isLOW(vLt), `cmp(${A}<${B}) → ${vLt}V LOW`).toBe(true);
      }
    },
  );

  it(
    '4-bit adder/subtractor: M=0 adds, M=1 subtracts (two\'s complement)',
    { timeout: 30_000 },
    async () => {
      const ex = digitalExamples.find((e) => e.id === 'digital-adder-subtractor-4bit')!;
      expect(ex, 'adder/subtractor present').toBeDefined();
      type Bit = 0 | 1;
      // Addition: 5+3=8 ; 7+8=15
      // Subtraction: 5-3=2 ; 8-5=3 (two's complement gives 4-bit + Cout=1)
      const cases: Array<{ A: number; B: number; M: Bit; result: number }> = [
        { A: 5, B: 3, M: 0, result: 8 },
        { A: 7, B: 8, M: 0, result: 15 },
        { A: 5, B: 3, M: 1, result: 2 },
        { A: 8, B: 5, M: 1, result: 3 },
      ];
      for (const { A, B, M, result } of cases) {
        const switches: Record<string, Bit> = { asM: M };
        for (let i = 0; i < 4; i++) {
          switches[`asA${i}`] = ((A >> i) & 1) as Bit;
          switches[`asB${i}`] = ((B >> i) & 1) as Bit;
        }
        for (let i = 0; i < 4; i++) {
          const v = await gateOutputV(ex, `asX2_${i}`, switches);
          const want = (result >> i) & 1;
          const op = M ? `${A}-${B}=${result}` : `${A}+${B}=${result}`;
          if (want)
            expect(isHIGH(v), `${op}, bit ${i} → ${v}V HIGH`).toBe(true);
          else expect(isLOW(v), `${op}, bit ${i} → ${v}V LOW`).toBe(true);
        }
      }
    },
  );

  it(
    '1-bit ALU slice: mode select drives AND / OR / XOR / ADD',
    { timeout: 30_000 },
    async () => {
      const ex = digitalExamples.find((e) => e.id === 'digital-alu-slice-1bit')!;
      expect(ex, 'ALU slice present').toBeDefined();
      type Bit = 0 | 1;
      const switches = (a: Bit, b: Bit, ci: Bit, m0: Bit, m1: Bit): Record<string, Bit> => ({
        aluA: a,
        aluB: b,
        aluCi: ci,
        aluM0: m0,
        aluM1: m1,
      });
      // M1 M0 = 00 → AND
      let v = await gateOutputV(ex, 'aluY', switches(1, 1, 0, 0, 0));
      expect(isHIGH(v), `ALU AND(1,1) → ${v}V HIGH`).toBe(true);
      v = await gateOutputV(ex, 'aluY', switches(1, 0, 0, 0, 0));
      expect(isLOW(v), `ALU AND(1,0) → ${v}V LOW`).toBe(true);
      // M1 M0 = 01 → OR
      v = await gateOutputV(ex, 'aluY', switches(0, 1, 0, 1, 0));
      expect(isHIGH(v), `ALU OR(0,1) → ${v}V HIGH`).toBe(true);
      v = await gateOutputV(ex, 'aluY', switches(0, 0, 0, 1, 0));
      expect(isLOW(v), `ALU OR(0,0) → ${v}V LOW`).toBe(true);
      // M1 M0 = 10 → XOR
      v = await gateOutputV(ex, 'aluY', switches(1, 0, 0, 0, 1));
      expect(isHIGH(v), `ALU XOR(1,0) → ${v}V HIGH`).toBe(true);
      v = await gateOutputV(ex, 'aluY', switches(1, 1, 0, 0, 1));
      expect(isLOW(v), `ALU XOR(1,1) → ${v}V LOW`).toBe(true);
      // M1 M0 = 11 → ADD; 1+1+0 = 10 → sum bit LOW, Cout HIGH
      v = await gateOutputV(ex, 'aluY', switches(1, 1, 0, 1, 1));
      expect(isLOW(v), `ALU ADD(1+1).sum → ${v}V LOW`).toBe(true);
      const vCo = await gateOutputV(ex, 'aluCout', switches(1, 1, 0, 1, 1));
      expect(isHIGH(vCo), `ALU ADD(1+1).Cout → ${vCo}V HIGH`).toBe(true);
    },
  );

  it(
    '4-bit carry-lookahead adder: matches the ripple-carry truth table',
    { timeout: 60_000 },
    async () => {
      const ex = digitalExamples.find((e) => e.id === 'digital-carry-lookahead-adder-4bit')!;
      expect(ex, 'CLA present').toBeDefined();
      type Bit = 0 | 1;
      const cases: Array<{ A: number; B: number; Ci: Bit }> = [
        { A: 0b0000, B: 0b0000, Ci: 0 },
        { A: 0b0110, B: 0b0011, Ci: 0 }, // 6+3=9
        { A: 0b1010, B: 0b0101, Ci: 1 }, // 10+5+1=16 → Cout
        { A: 0b1111, B: 0b1111, Ci: 0 }, // 15+15=30 = 0b11110
      ];
      for (const { A, B, Ci } of cases) {
        const total = A + B + Ci;
        const switches: Record<string, Bit> = { claC0: Ci };
        for (let i = 0; i < 4; i++) {
          switches[`claA${i}`] = ((A >> i) & 1) as Bit;
          switches[`claB${i}`] = ((B >> i) & 1) as Bit;
        }
        for (let i = 0; i < 4; i++) {
          const v = await gateOutputV(ex, `claS${i}`, switches);
          const want = (total >> i) & 1;
          if (want)
            expect(isHIGH(v), `CLA(${A}+${B}+${Ci}).S${i} → ${v}V HIGH`).toBe(true);
          else
            expect(isLOW(v), `CLA(${A}+${B}+${Ci}).S${i} → ${v}V LOW`).toBe(true);
        }
        const cout = (total >> 4) & 1;
        const vC = await gateOutputV(ex, 'claC4', switches);
        if (cout) expect(isHIGH(vC), `CLA Cout → ${vC}V HIGH`).toBe(true);
        else expect(isLOW(vC), `CLA Cout → ${vC}V LOW`).toBe(true);
      }
    },
  );

  it(
    '8-to-3 priority encoder: Y outputs encode the active input',
    { timeout: 30_000 },
    async () => {
      const ex = digitalExamples.find((e) => e.id === 'digital-priority-encoder-8to3')!;
      expect(ex, 'priority encoder present').toBeDefined();
      type Bit = 0 | 1;
      // Single-input-active cases — the encoded value equals the input index.
      const cases = [1, 3, 5, 7];
      for (const idx of cases) {
        const switches: Record<string, Bit> = {};
        for (let i = 0; i < 8; i++) switches[`pe${i}`] = (i === idx ? 1 : 0) as Bit;
        const vY0 = await gateOutputV(ex, 'peY0', switches);
        const vY1 = await gateOutputV(ex, 'peY1', switches);
        const vY2 = await gateOutputV(ex, 'peY2', switches);
        const wantY0 = idx & 1;
        const wantY1 = (idx >> 1) & 1;
        const wantY2 = (idx >> 2) & 1;
        if (wantY0) expect(isHIGH(vY0), `PE(in=${idx}).Y0 → ${vY0}V HIGH`).toBe(true);
        else expect(isLOW(vY0), `PE(in=${idx}).Y0 → ${vY0}V LOW`).toBe(true);
        if (wantY1) expect(isHIGH(vY1), `PE(in=${idx}).Y1 → ${vY1}V HIGH`).toBe(true);
        else expect(isLOW(vY1), `PE(in=${idx}).Y1 → ${vY1}V LOW`).toBe(true);
        if (wantY2) expect(isHIGH(vY2), `PE(in=${idx}).Y2 → ${vY2}V HIGH`).toBe(true);
        else expect(isLOW(vY2), `PE(in=${idx}).Y2 → ${vY2}V LOW`).toBe(true);
      }
    },
  );

  it(
    'Hamming(7,4) encoder: complete parity check on all 16 patterns (sampled)',
    { timeout: 30_000 },
    async () => {
      const ex = digitalExamples.find((e) => e.id === 'digital-hamming-encoder-74')!;
      expect(ex, 'Hamming encoder present').toBeDefined();
      type Bit = 0 | 1;
      // Sample 6 of the 16 input vectors. p1, p2, p4 must each equal the
      // XOR of their respective data-bit subsets.
      const samples = [0b0000, 0b0001, 0b0010, 0b0111, 0b1001, 0b1111];
      for (const data of samples) {
        const d: [Bit, Bit, Bit, Bit] = [
          (data & 1) as Bit,
          ((data >> 1) & 1) as Bit,
          ((data >> 2) & 1) as Bit,
          ((data >> 3) & 1) as Bit,
        ];
        const switches: Record<string, Bit> = {
          hmD0: d[0],
          hmD1: d[1],
          hmD2: d[2],
          hmD3: d[3],
        };
        const expP1 = (d[0] ^ d[1] ^ d[3]) as Bit;
        const expP2 = (d[0] ^ d[2] ^ d[3]) as Bit;
        const expP4 = (d[1] ^ d[2] ^ d[3]) as Bit;
        const vP1 = await gateOutputV(ex, 'hmP1b', switches);
        const vP2 = await gateOutputV(ex, 'hmP2b', switches);
        const vP4 = await gateOutputV(ex, 'hmP4b', switches);
        if (expP1) expect(isHIGH(vP1), `p1(D=${data.toString(2)}) → ${vP1}V HIGH`).toBe(true);
        else expect(isLOW(vP1), `p1(D=${data.toString(2)}) → ${vP1}V LOW`).toBe(true);
        if (expP2) expect(isHIGH(vP2), `p2(D=${data.toString(2)}) → ${vP2}V HIGH`).toBe(true);
        else expect(isLOW(vP2), `p2(D=${data.toString(2)}) → ${vP2}V LOW`).toBe(true);
        if (expP4) expect(isHIGH(vP4), `p4(D=${data.toString(2)}) → ${vP4}V HIGH`).toBe(true);
        else expect(isLOW(vP4), `p4(D=${data.toString(2)}) → ${vP4}V LOW`).toBe(true);
      }
    },
  );
});
