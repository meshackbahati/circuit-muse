/**
 * digital-gate-engine Phase 1 — the engine evaluates the REAL gallery examples.
 *
 * Loads the actual component+wire data from `examples-digital.ts` (the same data
 * the canvas renders) into `buildDigitalNetwork` and checks the result LEDs
 * against truth tables — with NO ngspice. De-risks the app integration: if the
 * engine lights the right LEDs straight from example data here, Phase 2 only has
 * to bridge it to the store + DOM.
 *
 * Climbs simple -> complex, ending on /example/digital-adder-subtractor-4bit —
 * the circuit whose result LEDs never light on the SPICE B-source path live.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resetBusNets } from '../simulation/customChips/busNets';
import { buildDigitalNetwork, type DigitalComponent, type DigitalWire } from '../simulation/digital/digitalGateEngine';
import { digitalExamples } from '../data/examples-digital';

beforeEach(() => resetBusNets());

type Ex = { id: string; components: DigitalComponent[]; wires: DigitalWire[] };
const byId = (id: string): Ex => {
  const ex = (digitalExamples as unknown as Ex[]).find((e) => e.id === id);
  if (!ex) throw new Error(`example ${id} not found`);
  return ex;
};
const switchIds = (ex: Ex) => ex.components.filter((c) => c.type === 'wokwi-slide-switch').map((c) => c.id);
const ledIds = (ex: Ex) => ex.components.filter((c) => c.type === 'wokwi-led').map((c) => c.id);

describe('digital-gate-engine Phase 1 — real examples on the engine', () => {
  it('builds without bailing (all primitives recognised) for a sample of examples', () => {
    for (const id of ['digital-and-two-switches', 'digital-xor-difference', 'digital-full-adder', 'digital-adder-subtractor-4bit']) {
      const ex = byId(id);
      const net = buildDigitalNetwork(ex.components, ex.wires);
      expect(net.ok, `${id} should be all-digital`).toBe(true);
      resetBusNets();
    }
  });

  it('digital-and-two-switches: LED = s1 AND s2', () => {
    const ex = byId('digital-and-two-switches');
    const [s1, s2] = switchIds(ex);
    const [led] = ledIds(ex);
    for (const a of [0, 1] as const) {
      for (const b of [0, 1] as const) {
        const net = buildDigitalNetwork(ex.components, ex.wires);
        net.setSwitch(s1, a);
        net.setSwitch(s2, b);
        expect(net.readLed(led), `AND(${a},${b})`).toBe((a & b) as 0 | 1);
        resetBusNets();
      }
    }
  });

  it('digital-or-any-switch: LED = s1 OR s2', () => {
    const ex = byId('digital-or-any-switch');
    const [s1, s2] = switchIds(ex);
    const [led] = ledIds(ex);
    for (const a of [0, 1] as const) {
      for (const b of [0, 1] as const) {
        const net = buildDigitalNetwork(ex.components, ex.wires);
        net.setSwitch(s1, a);
        net.setSwitch(s2, b);
        expect(net.readLed(led), `OR(${a},${b})`).toBe((a | b) as 0 | 1);
        resetBusNets();
      }
    }
  });

  it('digital-xor-difference: LED = s1 XOR s2', () => {
    const ex = byId('digital-xor-difference');
    const [s1, s2] = switchIds(ex);
    const [led] = ledIds(ex);
    for (const a of [0, 1] as const) {
      for (const b of [0, 1] as const) {
        const net = buildDigitalNetwork(ex.components, ex.wires);
        net.setSwitch(s1, a);
        net.setSwitch(s2, b);
        expect(net.readLed(led), `XOR(${a},${b})`).toBe((a ^ b) as 0 | 1);
        resetBusNets();
      }
    }
  });

  it('digital-not-inverter: LED = NOT s (incl. the no-input-high case)', () => {
    const ex = byId('digital-not-inverter');
    const [s] = switchIds(ex);
    const [led] = ledIds(ex);
    for (const a of [0, 1] as const) {
      const net = buildDigitalNetwork(ex.components, ex.wires);
      net.setSwitch(s, a);
      expect(net.readLed(led), `NOT(${a})`).toBe((a ? 0 : 1) as 0 | 1);
      resetBusNets();
    }
  });

  it('digital-adder-subtractor-4bit: the result LEDs the SPICE path never lights', () => {
    const ex = byId('digital-adder-subtractor-4bit');
    const A = [0, 1, 2, 3].map((i) => `asA${i}`);
    const B = [0, 1, 2, 3].map((i) => `asB${i}`);
    const S = [0, 1, 2, 3].map((i) => `asLS${i}`);
    const M = 'asM', CO = 'asLCo';

    const run = (a: number, b: number, m: 0 | 1) => {
      const net = buildDigitalNetwork(ex.components, ex.wires);
      net.setSwitch(M, m);
      for (let i = 0; i < 4; i++) {
        net.setSwitch(A[i], ((a >> i) & 1) as 0 | 1);
        net.setSwitch(B[i], ((b >> i) & 1) as 0 | 1);
      }
      const sum = S.reduce((acc, s, i) => acc + (net.readLed(s) << i), 0);
      const cout = net.readLed(CO);
      resetBusNets();
      return { sum, cout };
    };

    const vectors: Array<[number, number, 0 | 1, number, 0 | 1, string]> = [
      [3, 2, 0, 5, 0, 'ADD 3+2'],
      [7, 6, 0, 13, 0, 'ADD 7+6'],
      [15, 1, 0, 0, 1, 'ADD 15+1 carry'],
      [9, 4, 0, 13, 0, 'ADD 9+4'],
      [5, 2, 1, 3, 1, 'SUB 5-2'],
      [9, 9, 1, 0, 1, 'SUB 9-9'],
      [2, 5, 1, 13, 0, 'SUB 2-5'],
    ];
    for (const [a, b, m, sum, cout, label] of vectors) {
      const r = run(a, b, m);
      expect(r.sum, `${label} sum`).toBe(sum);
      expect(r.cout, `${label} carry`).toBe(cout);
    }
  });

  it('digital-ripple-counter-4bit: clocking the switch counts up in binary', () => {
    const ex = byId('digital-ripple-counter-4bit');
    const net = buildDigitalNetwork(ex.components, ex.wires);
    expect(net.ok).toBe(true);
    const read = () => [0, 1, 2, 3].reduce((acc, i) => acc + (net.readLed(`cnt_led${i}`) << i), 0);
    expect(read(), 'starts at 0').toBe(0);
    // Each LOW->HIGH on the clock switch advances the count. Wrap at 16.
    for (let n = 1; n <= 17; n++) {
      net.setSwitch('cnt_clk', 1);
      net.setSwitch('cnt_clk', 0);
      expect(read(), `after ${n} clocks`).toBe(n % 16);
    }
  });
});
