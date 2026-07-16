/**
 * FakeSolverAdapter — in-memory SolverPort for unit tests.
 *
 * Records every call so tests can assert against the call log, and
 * returns canned vector values per a configurable map.  No SPICE
 * engine, no WASM, no Worker — fast enough to run thousands of times
 * in a single test file.
 *
 * Two ways to script it:
 *
 *   1. Static voltages
 *      const fake = new FakeSolverAdapter({
 *        vectors: { 'v(net_drain)': 4.97, 'v(net_gate)': 0.1 },
 *      });
 *
 *   2. Dynamic — supplier function recomputed on every solve
 *      const fake = new FakeSolverAdapter({
 *        vectors: () => ({ 'v(out)': vinTracker.current }),
 *      });
 *      ...
 *      fake.onAlter = (name, value) => {
 *        if (name === 'V_uno_9') vinTracker.current = value;
 *      };
 */
import type {
  SolverPort,
  SolveAnalysis,
  SolveResult,
  SolveOptions,
  SolveVector,
} from '../ports/SolverPort';

type VectorMap = Record<string, number | Float64Array>;

interface FakeSolverConfig {
  /** Static map OR a supplier called on every solve. */
  vectors?: VectorMap | (() => VectorMap);
  /** Optional time axis for .tran results. */
  timeAxis?: Float64Array;
  /** Optional latency for `solve` in ms (for testing race conditions). */
  solveDelayMs?: number;
}

export class FakeSolverAdapter implements SolverPort {
  /** Call log — tests assert against this. */
  public calls: {
    init: number;
    loadCircuit: string[];
    solve: Array<{ analysis: SolveAnalysis; vectorsOfInterest: readonly string[] }>;
    alterSource: Array<[string, number]>;
    dispose: number;
  } = { init: 0, loadCircuit: [], solve: [], alterSource: [], dispose: 0 };

  /** Hook for tests that want to react to an alter (e.g. update canned vectors). */
  public onAlter: ((name: string, dcValue: number) => void) | null = null;

  constructor(private readonly config: FakeSolverConfig = {}) {}

  async init(): Promise<void> {
    this.calls.init++;
  }

  async loadCircuit(netlist: string): Promise<void> {
    this.calls.loadCircuit.push(netlist);
  }

  async solve(analysis: SolveAnalysis, options: SolveOptions): Promise<SolveResult> {
    this.calls.solve.push({ analysis, vectorsOfInterest: options.vectorsOfInterest });
    if (this.config.solveDelayMs) {
      await new Promise((r) => setTimeout(r, this.config.solveDelayMs));
    }
    const raw = typeof this.config.vectors === 'function' ? this.config.vectors() : this.config.vectors ?? {};
    const vectors = new Map<string, SolveVector>();
    for (const requested of options.vectorsOfInterest) {
      const key = requested.toLowerCase();
      if (!(key in raw)) continue;
      const value = raw[key];
      const real = typeof value === 'number' ? new Float64Array([value]) : value;
      vectors.set(key, { name: key, real, imag: null });
    }
    return {
      analysis,
      vectors,
      timeAxis: this.config.timeAxis ?? new Float64Array(0),
      solveMs: 0,
      warnings: [],
    };
  }

  async alterSource(name: string, dcValue: number): Promise<void> {
    this.calls.alterSource.push([name, dcValue]);
    if (this.onAlter) this.onAlter(name, dcValue);
  }

  dispose(): void {
    this.calls.dispose++;
  }

  /** Test helper — reset all call counters without disposing. */
  resetCalls(): void {
    this.calls = { init: 0, loadCircuit: [], solve: [], alterSource: [], dispose: 0 };
  }
}
