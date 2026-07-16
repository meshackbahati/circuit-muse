/**
 * digital-gate-engine Phase 0 — a gate network settles correctly on the
 * multichip-bus kernel, with NO ngspice (project/digital-gate-engine/).
 *
 * Proves the event-driven settle kernel built for chip-to-chip buses
 * (customChips/{busLogic,busNets,busKernel} + PinManager) evaluates a discrete
 * logic-gate network exactly: switches drive nets, gates subscribe to their
 * input nets and drive their output, and busKernel.settle() ripples the whole
 * combinational network to its fixed point. Builds up simple -> complex, ending
 * with the exact 4-bit adder/subtractor that the SPICE B-source path fails to
 * light live (00-problem-analysis.md).
 *
 * This is the D-001 go/no-go gate: if the kernel can ripple a carry through a
 * deep gate chain, the whole "gates on the digital engine" approach is sound.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PinManager } from '../simulation/PinManager';
import { setBusDrive, resetBusNets } from '../simulation/customChips/busNets';
import { Strength, type Drive } from '../simulation/customChips/busLogic';

const strong = (value: 0 | 1): Drive => ({ value, strength: Strength.STRONG });

// Boolean primitives (match parts/LogicGateParts.ts semantics; XOR = parity).
const AND = (b: boolean[]) => b.every(Boolean);
const OR = (b: boolean[]) => b.some(Boolean);
const NAND = (b: boolean[]) => !AND(b);
const NOR = (b: boolean[]) => !OR(b);
const XOR = (b: boolean[]) => b.filter(Boolean).length % 2 === 1;
const XNOR = (b: boolean[]) => !XOR(b);
const NOT = (b: boolean[]) => !b[0];

/**
 * A digital network on the settle kernel. Nets are integer keys (the same keys
 * PinManager + busNets use for chip-to-chip nets). A switch is a STRONG driver;
 * a gate subscribes to its input nets, recomputes on any change, and drives its
 * output STRONG. Reading a net returns its resolved level.
 */
class Network {
  readonly pm = new PinManager();
  private nextKey = 1;

  net(): number {
    return this.nextKey++;
  }

  /** Drive a net from an input switch (STRONG). */
  setSwitch(net: number, value: 0 | 1, id = `sw${net}`): void {
    setBusDrive(this.pm, net, `${id}::o`, strong(value));
  }

  /** Read a net's resolved logic level (what an LED on it would show). */
  read(net: number): 0 | 1 {
    return this.pm.getPinState(net) ? 1 : 0;
  }

  /** A combinational gate: inputs[] -> output, recomputed event-driven. */
  gate(id: string, inputs: number[], output: number, fn: (b: boolean[]) => boolean): void {
    const state = inputs.map((n) => this.pm.getPinState(n));
    const update = () => setBusDrive(this.pm, output, `${id}::Y`, strong(fn(state) ? 1 : 0));
    inputs.forEach((n, i) =>
      this.pm.onPinChange(n, (_p: number, s: boolean) => {
        state[i] = s;
        update();
      }),
    );
    update(); // drive-on-mount so the network has a defined initial steady state
  }

  /** One full adder: returns {sum, cout} nets. */
  fullAdder(tag: string, a: number, b: number, cin: number): { sum: number; cout: number } {
    const axb = this.net();
    const sum = this.net();
    const ab = this.net();
    const cab = this.net();
    const cout = this.net();
    this.gate(`${tag}_axb`, [a, b], axb, XOR);
    this.gate(`${tag}_sum`, [axb, cin], sum, XOR);
    this.gate(`${tag}_ab`, [a, b], ab, AND);
    this.gate(`${tag}_cab`, [cin, axb], cab, AND);
    this.gate(`${tag}_cout`, [ab, cab], cout, OR);
    return { sum, cout };
  }
}

beforeEach(() => resetBusNets());

describe('digital-gate-engine Phase 0 — single gates settle on the kernel', () => {
  const cases: Array<[string, (b: boolean[]) => boolean, Array<[number, number, number]>]> = [
    ['AND', AND, [[0, 0, 0], [0, 1, 0], [1, 0, 0], [1, 1, 1]]],
    ['OR', OR, [[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 1]]],
    ['NAND', NAND, [[0, 0, 1], [0, 1, 1], [1, 0, 1], [1, 1, 0]]],
    ['NOR', NOR, [[0, 0, 1], [0, 1, 0], [1, 0, 0], [1, 1, 0]]],
    ['XOR', XOR, [[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 0]]],
    ['XNOR', XNOR, [[0, 0, 1], [0, 1, 0], [1, 0, 0], [1, 1, 1]]],
  ];

  it.each(cases)('%s truth table', (_name, fn, table) => {
    for (const [a, b, y] of table) {
      const net = new Network();
      const A = net.net(), B = net.net(), Y = net.net();
      net.gate('g', [A, B], Y, fn);
      net.setSwitch(A, a as 0 | 1);
      net.setSwitch(B, b as 0 | 1);
      expect(net.read(Y), `${_name}(${a},${b})`).toBe(y);
      resetBusNets();
    }
  });

  it('NOT inverter (incl. the all-zero-input high output)', () => {
    for (const [a, y] of [[0, 1], [1, 0]] as Array<[0 | 1, 0 | 1]>) {
      const net = new Network();
      const A = net.net(), Y = net.net();
      net.gate('inv', [A], Y, NOT);
      // Read BEFORE driving: NOT(0)=1 must come from the drive-on-mount.
      expect(net.read(Y), `NOT(${a}) initial`).toBe(1);
      net.setSwitch(A, a);
      expect(net.read(Y), `NOT(${a})`).toBe(y);
      resetBusNets();
    }
  });
});

describe('digital-gate-engine Phase 0 — combinational blocks', () => {
  it('half adder: S = A XOR B, C = A AND B', () => {
    for (const [a, b] of [[0, 0], [0, 1], [1, 0], [1, 1]] as Array<[0 | 1, 0 | 1]>) {
      const net = new Network();
      const A = net.net(), B = net.net(), S = net.net(), C = net.net();
      net.gate('s', [A, B], S, XOR);
      net.gate('c', [A, B], C, AND);
      net.setSwitch(A, a);
      net.setSwitch(B, b);
      expect([net.read(S), net.read(C)], `HA(${a},${b})`).toEqual([a ^ b, a & b]);
      resetBusNets();
    }
  });

  it('full adder: all 8 input combinations', () => {
    for (let v = 0; v < 8; v++) {
      const a = (v & 1) as 0 | 1, b = ((v >> 1) & 1) as 0 | 1, cin = ((v >> 2) & 1) as 0 | 1;
      const net = new Network();
      const A = net.net(), B = net.net(), CIN = net.net();
      const { sum, cout } = net.fullAdder('fa', A, B, CIN);
      net.setSwitch(A, a);
      net.setSwitch(B, b);
      net.setSwitch(CIN, cin);
      const total = a + b + cin;
      expect([net.read(sum), net.read(cout)], `FA(${a},${b},${cin})`).toEqual([total & 1, total >> 1]);
      resetBusNets();
    }
  });
});

describe('digital-gate-engine Phase 0 — 4-bit ripple adder/subtractor (the failing example)', () => {
  // Builds the exact topology of /example/digital-adder-subtractor-4bit:
  // each B bit XOR M, M -> FA0 carry-in, ripple chain; result = sum bits + carry.
  const build = (N = 4) => {
    const net = new Network();
    const A = Array.from({ length: N }, () => net.net());
    const B = Array.from({ length: N }, () => net.net());
    const M = net.net();
    let carry = M; // M feeds FA0 carry-in (two's-complement subtract)
    const S: number[] = [];
    for (let i = 0; i < N; i++) {
      const bxm = net.net();
      net.gate(`bxm${i}`, [B[i], M], bxm, XOR); // B_i XOR M
      const { sum, cout } = net.fullAdder(`fa${i}`, A[i], bxm, carry);
      S.push(sum);
      carry = cout;
    }
    const apply = (a: number, b: number, m: 0 | 1) => {
      net.setSwitch(M, m);
      for (let i = 0; i < N; i++) {
        net.setSwitch(A[i], ((a >> i) & 1) as 0 | 1);
        net.setSwitch(B[i], ((b >> i) & 1) as 0 | 1);
      }
    };
    const result = () => S.reduce((acc, s, i) => acc + (net.read(s) << i), 0);
    const carryOut = () => net.read(carry);
    return { apply, result, carryOut };
  };

  const vectors: Array<{ a: number; b: number; m: 0 | 1; sum: number; cout: 0 | 1; label: string }> = [
    { a: 3, b: 2, m: 0, sum: 5, cout: 0, label: 'ADD 3+2' },
    { a: 7, b: 6, m: 0, sum: 13, cout: 0, label: 'ADD 7+6' },
    { a: 15, b: 1, m: 0, sum: 0, cout: 1, label: 'ADD 15+1 (carry)' },
    { a: 9, b: 4, m: 0, sum: 13, cout: 0, label: 'ADD 9+4' },
    { a: 5, b: 2, m: 1, sum: 3, cout: 1, label: 'SUB 5-2' },
    { a: 9, b: 9, m: 1, sum: 0, cout: 1, label: 'SUB 9-9' },
    { a: 2, b: 5, m: 1, sum: 13, cout: 0, label: 'SUB 2-5 (borrow, 1101=-3)' },
  ];

  it.each(vectors)('$label -> $sum (carry $cout)', ({ a, b, m, sum, cout }) => {
    const adder = build(4);
    adder.apply(a, b, m);
    expect(adder.result()).toBe(sum);
    expect(adder.carryOut()).toBe(cout);
  });

  it('exhaustive ADD: every A,B in 0..15 gives (A+B) mod 16 + carry', () => {
    for (let a = 0; a < 16; a++) {
      for (let b = 0; b < 16; b++) {
        const adder = build(4);
        adder.apply(a, b, 0);
        const total = a + b;
        expect(adder.result(), `ADD ${a}+${b} sum`).toBe(total & 15);
        expect(adder.carryOut(), `ADD ${a}+${b} carry`).toBe(((total >> 4) & 1) as 0 | 1);
        resetBusNets();
      }
    }
  });
});

describe('digital-gate-engine Phase 0 — more example topologies (fan-out, select, wide, deep)', () => {
  it('2-to-1 mux: Y = S ? B : A (all 8 inputs)', () => {
    for (let v = 0; v < 8; v++) {
      const s = (v & 1) as 0 | 1, a = ((v >> 1) & 1) as 0 | 1, b = ((v >> 2) & 1) as 0 | 1;
      const net = new Network();
      const S = net.net(), A = net.net(), B = net.net();
      const nS = net.net(), t0 = net.net(), t1 = net.net(), Y = net.net();
      net.gate('ns', [S], nS, NOT);
      net.gate('t0', [nS, A], t0, AND);
      net.gate('t1', [S, B], t1, AND);
      net.gate('y', [t0, t1], Y, OR);
      net.setSwitch(S, s); net.setSwitch(A, a); net.setSwitch(B, b);
      expect(net.read(Y), `MUX s=${s} a=${a} b=${b}`).toBe(s ? b : a);
      resetBusNets();
    }
  });

  it('2-to-4 decoder: one-hot output (fan-out from 2 inputs)', () => {
    for (let v = 0; v < 4; v++) {
      const s0 = (v & 1) as 0 | 1, s1 = ((v >> 1) & 1) as 0 | 1;
      const net = new Network();
      const S0 = net.net(), S1 = net.net(), nS0 = net.net(), nS1 = net.net();
      const D = [net.net(), net.net(), net.net(), net.net()];
      net.gate('n0', [S0], nS0, NOT);
      net.gate('n1', [S1], nS1, NOT);
      net.gate('d0', [nS1, nS0], D[0], AND);
      net.gate('d1', [nS1, S0], D[1], AND);
      net.gate('d2', [S1, nS0], D[2], AND);
      net.gate('d3', [S1, S0], D[3], AND);
      net.setSwitch(S0, s0); net.setSwitch(S1, s1);
      expect(D.map((d) => net.read(d)), `DECODE ${v}`).toEqual([0, 1, 2, 3].map((i) => (i === v ? 1 : 0)));
      resetBusNets();
    }
  });

  it('4-bit equality comparator: EQ = AND of (A_i XNOR B_i) — wide AND', () => {
    const samples: Array<[number, number]> = [[0, 0], [5, 5], [15, 15], [5, 7], [9, 1], [15, 14]];
    for (const [a, b] of samples) {
      const net = new Network();
      const e: number[] = [];
      for (let i = 0; i < 4; i++) {
        const Ai = net.net(), Bi = net.net(), Ei = net.net();
        net.gate(`xnor${i}`, [Ai, Bi], Ei, XNOR);
        net.setSwitch(Ai, ((a >> i) & 1) as 0 | 1);
        net.setSwitch(Bi, ((b >> i) & 1) as 0 | 1);
        e.push(Ei);
      }
      const EQ = net.net();
      net.gate('eq', e, EQ, AND); // 4-input AND
      expect(net.read(EQ), `EQ ${a}==${b}`).toBe(a === b ? 1 : 0);
      resetBusNets();
    }
  });

  it('4-bit parity: cascaded XOR chain (depth) — odd-1s detector', () => {
    for (let v = 0; v < 16; v++) {
      const net = new Network();
      const bits = [net.net(), net.net(), net.net(), net.net()];
      const p01 = net.net(), p012 = net.net(), p0123 = net.net();
      net.gate('p01', [bits[0], bits[1]], p01, XOR);
      net.gate('p012', [p01, bits[2]], p012, XOR);
      net.gate('p0123', [p012, bits[3]], p0123, XOR);
      bits.forEach((bnet, i) => net.setSwitch(bnet, ((v >> i) & 1) as 0 | 1));
      const ones = [0, 1, 2, 3].reduce((n, i) => n + ((v >> i) & 1), 0);
      expect(net.read(p0123), `PARITY ${v}`).toBe((ones & 1) as 0 | 1);
      resetBusNets();
    }
  });

  it('2x2 binary multiplier: partial products + half adders (mixed arithmetic)', () => {
    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 4; b++) {
        const net = new Network();
        const A0 = net.net(), A1 = net.net(), B0 = net.net(), B1 = net.net();
        const a0b0 = net.net(), a1b0 = net.net(), a0b1 = net.net(), a1b1 = net.net();
        net.gate('a0b0', [A0, B0], a0b0, AND);
        net.gate('a1b0', [A1, B0], a1b0, AND);
        net.gate('a0b1', [A0, B1], a0b1, AND);
        net.gate('a1b1', [A1, B1], a1b1, AND);
        const P0 = a0b0;
        const P1 = net.net(), c1 = net.net();
        net.gate('p1', [a1b0, a0b1], P1, XOR);
        net.gate('c1', [a1b0, a0b1], c1, AND);
        const P2 = net.net(), c2 = net.net();
        net.gate('p2', [a1b1, c1], P2, XOR);
        net.gate('c2', [a1b1, c1], c2, AND);
        const P3 = c2;
        net.setSwitch(A0, (a & 1) as 0 | 1); net.setSwitch(A1, ((a >> 1) & 1) as 0 | 1);
        net.setSwitch(B0, (b & 1) as 0 | 1); net.setSwitch(B1, ((b >> 1) & 1) as 0 | 1);
        const product = net.read(P0) + (net.read(P1) << 1) + (net.read(P2) << 2) + (net.read(P3) << 3);
        expect(product, `MUL ${a}*${b}`).toBe(a * b);
        resetBusNets();
      }
    }
  });
});
