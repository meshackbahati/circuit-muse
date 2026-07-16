/**
 * NgSpiceWorkerAdapter — production SolverPort implementation.
 *
 * Wraps the vendored `NgSpiceInteractive` client (which itself wraps a
 * Web Worker that loads the ngspice-interactive WASM build).  The
 * adapter translates between the domain `SolverPort` types and the
 * client's message-passing semantics.
 *
 * Single responsibility: this file is the *only* place in the codebase
 * that knows about Web Workers, the ngspice command syntax, or vector
 * lookup details.  If we ever swap engines (XSpice fork, native build,
 * Falstad-style custom engine), the work is contained here.
 *
 * Concurrency: the underlying worker serialises commands itself, so
 * the adapter can fire many `readVec` calls in parallel during a
 * solve and they queue in the worker.  The adapter awaits all of them
 * before returning a `SolveResult`.
 */
import { NgSpiceInteractive } from '../wasm/NgSpiceInteractive';
import type {
  SolverPort,
  SolveAnalysis,
  SolveResult,
  SolveOptions,
  SolveVector,
} from '../ports/SolverPort';

/**
 * Build the ngspice command string for a given analysis.  All formats
 * follow chapter 17 of the ngspice manual.
 */
function analysisToCommand(analysis: SolveAnalysis): string {
  switch (analysis.kind) {
    case 'op':
      return 'op';
    case 'tran':
      // ngspice tran syntax: `tran <tstep> <tstop> [<tstart> [<tmax>] [uic]]`
      return `tran ${analysis.step} ${analysis.stop}`;
    case 'ac':
      // ngspice ac syntax: `ac <sweep> <points> <fstart> <fstop>`
      return `ac ${analysis.sweep} ${analysis.points} ${analysis.fstart} ${analysis.fstop}`;
  }
}

export class NgSpiceWorkerAdapter implements SolverPort {
  private readonly client: NgSpiceInteractive;
  private initialised = false;
  private initPromise: Promise<void> | null = null;

  constructor(client?: NgSpiceInteractive) {
    this.client = client ?? new NgSpiceInteractive();
  }

  async init(): Promise<void> {
    if (this.initialised) return;
    if (!this.initPromise) {
      this.initPromise = this.client.init().then(async () => {
        // Convergence helpers — relaxed gmin lets op-amp + diode
        // circuits bias correctly without each user netlist needing
        // its own `.option`.  Method=gear maxord=2 stabilises stiff
        // transient solves involving B-source clamps and reactive
        // networks.  Mirrors NgSpiceNodeAdapter.initialiseNgspice so
        // production and tests run with identical solver tolerances.
        try {
          await this.client.command('set noaskquit');
          await this.client.command(
            'option gmin=1e-10 gminsteps=20 sourcesteps=10 method=gear maxord=2',
          );
        } catch {
          // Ignore: the build always supports these options.  If the
          // command path is dead, the actual solve will fail loudly
          // later anyway.
        }
        this.initialised = true;
      });
    }
    return this.initPromise;
  }

  async loadCircuit(netlist: string): Promise<void> {
    await this.init();
    // Drop the previous circuit deck so leftover state doesn't leak
    // into the new solve.  Mirrors the Node adapter's loadCircuit.
    try {
      await this.client.command('remcirc');
    } catch {
      // No previous circuit — ignore.
    }
    await this.client.loadNetlist(netlist);
  }

  async solve(analysis: SolveAnalysis, options: SolveOptions): Promise<SolveResult> {
    await this.init();
    const t0 = performance.now();

    const cmdResult = await this.client.command(analysisToCommand(analysis));
    // ngspice writes convergence warnings to stderr; surface them so
    // the caller can decide to retry with relaxed options.
    const warnings = cmdResult.stderr.filter((l) => l.length > 0);

    // Parallel read of every requested vector.  The worker serialises
    // them internally, so this still costs O(N · 100µs) wall-time, but
    // it avoids the await-each-then-await-next ping-pong.
    const vectors = new Map<string, SolveVector>();
    const reads = await Promise.allSettled(
      options.vectorsOfInterest.map(async (name) => {
        const v = await this.client.readVec(name);
        return { requested: name, vec: v };
      }),
    );

    let timeAxis: Float64Array = new Float64Array(0);
    for (const r of reads) {
      if (r.status !== 'fulfilled') continue;
      const { requested, vec } = r.value;
      vectors.set(requested.toLowerCase(), {
        name: requested.toLowerCase(),
        real: vec.real,
        imag: vec.imag,
      });
    }

    // For .tran, fetch the time axis separately.  ngspice always names
    // it `time` regardless of analysis name.
    if (analysis.kind === 'tran') {
      try {
        const t = await this.client.readVec('time');
        timeAxis = t.real;
      } catch {
        // No time vector — shouldn't happen but tolerate it.
      }
    }

    const solveMs = performance.now() - t0;
    return { analysis, vectors, timeAxis, solveMs, warnings };
  }

  async alterSource(name: string, dcValue: number): Promise<void> {
    await this.init();
    await this.client.alter(name, dcValue);
  }

  /**
   * Enumerate vector names in the current plot.  Same surface as
   * `NgSpiceNodeAdapter.listCurrentVectors` so `runNetlist.ts` no
   * longer has to heuristic-parse netlist strings to guess what to
   * read.  Phase 1d #6.
   */
  async listCurrentVectors(): Promise<string[]> {
    await this.init();
    return this.client.listVectors();
  }

  /**
   * Read every vector in the current plot after an analysis has
   * already run.  Critical for `runNetlist`-style consumers that
   * want every vector — re-running the analysis to read them would
   * create a NEW plot and invalidate the pointers.
   */
  async readAllCurrentVectors(): Promise<{
    vectors: Map<string, import('../ports/SolverPort').SolveVector>;
    rawNames: string[];
  }> {
    await this.init();
    const rawNames = await this.client.listVectors();
    const vectors = new Map<string, import('../ports/SolverPort').SolveVector>();
    const reads = await Promise.allSettled(
      rawNames.map(async (name) => {
        const v = await this.client.readVec(name);
        return { requested: name, vec: v };
      }),
    );
    for (const r of reads) {
      if (r.status !== 'fulfilled') continue;
      const { requested, vec } = r.value;
      vectors.set(requested.toLowerCase(), {
        name: requested.toLowerCase(),
        real: vec.real,
        imag: vec.imag,
      });
    }
    return { vectors, rawNames };
  }

  dispose(): void {
    this.client.dispose();
    this.initialised = false;
    this.initPromise = null;
  }
}
