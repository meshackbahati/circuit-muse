/**
 * Production `runNetlist(netlist) → SpiceResult` utility, built on
 * the SolverPort + NgSpiceWorkerAdapter stack.  Replaces the legacy
 * `SpiceEngine.ts` (eecircuit-engine wrapper) — same API, single
 * solver path shared with the rest of the simulation subsystem.
 *
 * Phase 1c F3 of the mixed-mode migration.
 */
import type { SolverPort } from './ports/SolverPort';
import { NgSpiceWorkerAdapter } from './adapters/NgSpiceWorkerAdapter';

export interface ComplexNumber {
  real: number;
  img: number;
}
export type VectorValue = number | ComplexNumber;

export interface SpiceResult {
  variableNames: string[];
  vec(name: string): VectorValue[];
  dcValue(name: string): number;
  vAtLast(name: string): VectorValue;
  findVar(name: string): number;
}

let singleton: SolverPort | null = null;

/**
 * Pick the right SolverPort for the current environment.  Browser →
 * Web Worker.  Node (Vitest, scripts) → in-proc WASM via the Node
 * adapter.  The Node adapter is loaded with a dynamic import so the
 * production browser bundle doesn't pull `node:fs` / `node:vm`.
 */
async function getAdapter(): Promise<SolverPort> {
  if (singleton) return singleton;
  const hasWorker = typeof Worker !== 'undefined';
  if (hasWorker) {
    singleton = new NgSpiceWorkerAdapter();
  } else {
    // /* @vite-ignore */ keeps Vite from following the dynamic import
    // into the Node-only adapter chain (fs / url) during the browser
    // build.  Node test runs still resolve and load it.
    const specifier = './adapters/NgSpiceNodeAdapter';
    const mod = await import(/* @vite-ignore */ specifier);
    singleton = new mod.NgSpiceNodeAdapter();
  }
  return singleton;
}

function detectAnalysis(netlist: string):
  | { kind: 'op' }
  | { kind: 'tran'; step: string; stop: string }
  | { kind: 'ac'; sweep: 'dec' | 'oct' | 'lin'; points: number; fstart: number; fstop: number } {
  for (const line of netlist.split('\n')) {
    const trimmed = line.trim().toLowerCase();
    if (trimmed.startsWith('.op')) return { kind: 'op' };
    if (trimmed.startsWith('.tran ')) {
      const parts = trimmed.split(/\s+/);
      return { kind: 'tran', step: parts[1] ?? '1u', stop: parts[2] ?? '1m' };
    }
    if (trimmed.startsWith('.ac ')) {
      const parts = trimmed.split(/\s+/);
      return {
        kind: 'ac',
        sweep: (parts[1] as 'dec' | 'oct' | 'lin') ?? 'dec',
        points: parseInt(parts[2] ?? '20', 10),
        fstart: parseFloat(parts[3] ?? '1'),
        fstop: parseFloat(parts[4] ?? '1e6'),
      };
    }
  }
  return { kind: 'op' };
}

const SPECIAL_AXES = new Set(['time', 'frequency']);

function ngspiceNameFor(legacyName: string): string {
  const l = legacyName.toLowerCase();
  if (SPECIAL_AXES.has(l)) return l;
  const mV = l.match(/^v\((.+)\)$/);
  if (mV) return mV[1]!;
  const mI = l.match(/^i\((.+)\)$/);
  if (mI) return `${mI[1]!}#branch`;
  return l;
}

function legacyNameFor(ngName: string): string {
  const l = ngName.toLowerCase();
  if (SPECIAL_AXES.has(l)) return l;
  const m = l.match(/^(.+)#branch$/);
  if (m) return `i(${m[1]!})`;
  return `v(${l})`;
}

interface AdapterWithRead {
  readAllCurrentVectors(): Promise<{
    vectors: Map<string, import('./ports/SolverPort').SolveVector>;
    rawNames: string[];
  }> | {
    vectors: Map<string, import('./ports/SolverPort').SolveVector>;
    rawNames: string[];
  };
}

/**
 * Submit a netlist, run the embedded analysis directive, return
 * cooked results.  The vendored ngspice runs in a Web Worker so this
 * is asynchronous; subsequent calls reuse the same worker (warm boot).
 */
export async function runNetlist(netlist: string): Promise<SpiceResult> {
  const adapter = await getAdapter();
  await adapter.init();
  await adapter.loadCircuit(netlist);
  const analysis = detectAnalysis(netlist);
  // Single solve — populate the plot, then enumerate + read every
  // vector via `readAllCurrentVectors` so the pointers stay valid.
  // (Re-running the analysis to read vectors would create a new
  // plot and invalidate everything.)
  await adapter.solve(analysis, { vectorsOfInterest: [] });
  const all = await (adapter as unknown as AdapterWithRead).readAllCurrentVectors();
  const result = {
    analysis,
    vectors: all.vectors,
    timeAxis:
      analysis.kind === 'tran'
        ? all.vectors.get('time')?.real ?? new Float64Array(0)
        : new Float64Array(0),
    solveMs: 0,
    warnings: [] as string[],
  };
  const rawVecs = all.rawNames;

  const variableNames = Array.from(result.vectors.keys()).map(legacyNameFor);
  const getVec = (name: string): VectorValue[] => {
    const ngKey = ngspiceNameFor(name);
    const vec = result.vectors.get(ngKey) ?? result.vectors.get(name.toLowerCase());
    if (!vec) {
      throw new Error(
        `[runNetlist] Variable "${name}" not found. Available: ${variableNames.join(', ')}`,
      );
    }
    if (vec.imag) {
      const arr: VectorValue[] = [];
      for (let i = 0; i < vec.real.length; i++) {
        arr.push({ real: vec.real[i] ?? 0, img: vec.imag[i] ?? 0 });
      }
      return arr;
    }
    return Array.from(vec.real);
  };
  return {
    variableNames,
    findVar(name) {
      const l = name.toLowerCase();
      let idx = variableNames.indexOf(l);
      if (idx >= 0) return idx;
      idx = variableNames.indexOf(`v(${l})`);
      return idx;
    },
    vec: getVec,
    dcValue(name) {
      const v = getVec(name)[0];
      return typeof v === 'number' ? v : (v as { real: number }).real;
    },
    vAtLast(name) {
      const v = getVec(name);
      return v[v.length - 1]!;
    },
  };
}
