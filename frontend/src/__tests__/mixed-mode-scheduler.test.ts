/**
 * MixedModeScheduler tests — exercises the cache + fan-out + solver
 * orchestration on top of a FakeSolverAdapter (no WASM).
 *
 * Layer covered:
 *   • voltage cache + subscriber routing
 *   • loadCircuit + resolveDc / resolveTran via the SolverPort
 *   • onMcuPinChange → alterSource → re-resolve loop
 *
 * Real ngspice integration is covered by the BJT-switch test;
 * SolverPort contract is covered by solver-port-contract.test.ts.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getMixedModeScheduler,
  __resetMixedModeScheduler,
  __setSchedulerSolverFactoryForTests,
} from '../simulation/spice/MixedModeScheduler';
import { FakeSolverAdapter } from '../simulation/spice/adapters/FakeSolverAdapter';

afterEach(() => {
  __resetMixedModeScheduler();
});

describe('MixedModeScheduler — voltage cache', () => {
  it('returns null until something is published', () => {
    const sched = getMixedModeScheduler();
    expect(sched.getCurrentVoltage('q1', 'C')).toBeNull();
  });

  it('returns the last published voltage per (component, pin)', () => {
    const sched = getMixedModeScheduler();
    sched.publishVoltage('q1', 'C', 4.5);
    sched.publishVoltage('q1', 'B', 1.2);
    sched.publishVoltage('q2', 'C', 0.3);
    expect(sched.getCurrentVoltage('q1', 'C')).toBe(4.5);
    expect(sched.getCurrentVoltage('q1', 'B')).toBe(1.2);
    expect(sched.getCurrentVoltage('q2', 'C')).toBe(0.3);
    sched.publishVoltage('q1', 'C', 2.7);
    expect(sched.getCurrentVoltage('q1', 'C')).toBe(2.7);
  });
});

describe('MixedModeScheduler — subscribe / publish routing', () => {
  it('fires the matching subscriber with the published voltage', () => {
    const sched = getMixedModeScheduler();
    const cb = vi.fn();
    sched.subscribe('q1', 'C', cb);
    sched.publishVoltage('q1', 'C', 4.7);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('UNKNOWN', 4.7);
  });

  it('does NOT fire subscribers watching a different pin', () => {
    const sched = getMixedModeScheduler();
    const cbMatching = vi.fn();
    const cbOtherPin = vi.fn();
    const cbOtherComp = vi.fn();
    sched.subscribe('q1', 'C', cbMatching);
    sched.subscribe('q1', 'B', cbOtherPin);
    sched.subscribe('q2', 'C', cbOtherComp);
    sched.publishVoltage('q1', 'C', 4.7);
    expect(cbMatching).toHaveBeenCalledTimes(1);
    expect(cbOtherPin).not.toHaveBeenCalled();
    expect(cbOtherComp).not.toHaveBeenCalled();
  });

  it('supports multiple subscribers on the same pin (fan-out)', () => {
    const sched = getMixedModeScheduler();
    const cbA = vi.fn();
    const cbB = vi.fn();
    sched.subscribe('q1', 'C', cbA);
    sched.subscribe('q1', 'C', cbB);
    sched.publishVoltage('q1', 'C', 4.7);
    expect(cbA).toHaveBeenCalledWith('UNKNOWN', 4.7);
    expect(cbB).toHaveBeenCalledWith('UNKNOWN', 4.7);
  });

  it('unsubscribe handle detaches the callback', () => {
    const sched = getMixedModeScheduler();
    const cb = vi.fn();
    const cancel = sched.subscribe('q1', 'C', cb);
    sched.publishVoltage('q1', 'C', 4.7);
    expect(cb).toHaveBeenCalledTimes(1);
    cancel();
    sched.publishVoltage('q1', 'C', 0.3);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('MixedModeScheduler — loadCircuit + resolveDc', () => {
  it('loadCircuit passes the netlist to the solver', async () => {
    const fake = new FakeSolverAdapter();
    __setSchedulerSolverFactoryForTests(() => fake);
    const sched = getMixedModeScheduler();

    const netlist = 'V1 1 0 DC 5\n.end\n';
    await sched.loadCircuit(netlist, new Map([['comp:p', '1']]));
    expect(fake.calls.loadCircuit).toEqual([netlist]);
    expect(fake.calls.init).toBe(1);
  });

  it('resolveDc requests the right vectors and publishes per pinNetMap', async () => {
    const fake = new FakeSolverAdapter({
      vectors: { 'v(net_drain)': 4.97, 'v(net_gate)': 0.5 },
    });
    __setSchedulerSolverFactoryForTests(() => fake);
    const sched = getMixedModeScheduler();

    await sched.loadCircuit(
      '* netlist',
      new Map([
        ['q1:D', 'net_drain'],
        ['q1:G', 'net_gate'],
        ['q1:S', '0'],
      ]),
    );

    const events: Array<{ pin: string; v: number }> = [];
    sched.subscribe('q1', 'D', (_state, v) => events.push({ pin: 'D', v }));
    sched.subscribe('q1', 'G', (_state, v) => events.push({ pin: 'G', v }));
    sched.subscribe('q1', 'S', (_state, v) => events.push({ pin: 'S', v }));

    await sched.resolveDc();

    expect(fake.calls.solve).toHaveLength(1);
    expect(fake.calls.solve[0]?.analysis).toEqual({ kind: 'op' });
    expect(new Set(fake.calls.solve[0]?.vectorsOfInterest)).toEqual(
      new Set(['v(net_drain)', 'v(net_gate)']),
    );
    // Ground pin doesn't go through the solver — short-circuited to 0V.
    expect(sched.getCurrentVoltage('q1', 'D')).toBeCloseTo(4.97);
    expect(sched.getCurrentVoltage('q1', 'G')).toBeCloseTo(0.5);
    expect(sched.getCurrentVoltage('q1', 'S')).toBe(0);
    expect(events).toEqual(
      expect.arrayContaining([
        { pin: 'D', v: expect.closeTo(4.97, 2) },
        { pin: 'G', v: expect.closeTo(0.5, 2) },
        { pin: 'S', v: 0 },
      ]),
    );
  });

  it('resolveDc tolerates pins whose net is not in the solver result', async () => {
    const fake = new FakeSolverAdapter({ vectors: { 'v(net_present)': 3.3 } });
    __setSchedulerSolverFactoryForTests(() => fake);
    const sched = getMixedModeScheduler();

    await sched.loadCircuit(
      '* netlist',
      new Map([
        ['comp:P', 'net_present'],
        ['comp:M', 'net_missing'],
      ]),
    );
    await sched.resolveDc();
    expect(sched.getCurrentVoltage('comp', 'P')).toBeCloseTo(3.3);
    expect(sched.getCurrentVoltage('comp', 'M')).toBeNull();
  });

  it('resolveDc without loadCircuit first throws a clear error', async () => {
    const sched = getMixedModeScheduler();
    await expect(sched.resolveDc()).rejects.toThrow(/loadCircuit first/i);
  });

  it('resolveTran issues .tran and publishes the steady-state sample per pin', async () => {
    const fake = new FakeSolverAdapter({
      vectors: { 'v(out)': new Float64Array([0, 1, 2, 3, 4.5]) },
      timeAxis: new Float64Array([0, 1e-4, 2e-4, 3e-4, 4e-4]),
    });
    __setSchedulerSolverFactoryForTests(() => fake);
    const sched = getMixedModeScheduler();
    await sched.loadCircuit('* netlist', new Map([['comp:OUT', 'out']]));
    await sched.resolveTran('1e-4', '4e-4');

    expect(fake.calls.solve[0]?.analysis).toEqual({
      kind: 'tran',
      step: '1e-4',
      stop: '4e-4',
    });
    // Steady-state = last sample = 4.5
    expect(sched.getCurrentVoltage('comp', 'OUT')).toBeCloseTo(4.5);
    // Full waveform reachable via getLastResult for downstream consumers.
    expect(sched.getLastResult()?.vectors.get('v(out)')?.real.length).toBe(5);
    expect(sched.getLastResult()?.timeAxis.length).toBe(5);
  });

  it('loadCircuit replaces the previous circuit and clears the voltage cache', async () => {
    const fake = new FakeSolverAdapter({ vectors: { 'v(net_a)': 1.1, 'v(net_b)': 2.2 } });
    __setSchedulerSolverFactoryForTests(() => fake);
    const sched = getMixedModeScheduler();

    await sched.loadCircuit('first', new Map([['x:p', 'net_a']]));
    await sched.resolveDc();
    expect(sched.getCurrentVoltage('x', 'p')).toBeCloseTo(1.1);

    await sched.loadCircuit('second', new Map([['y:q', 'net_b']]));
    expect(sched.getCurrentVoltage('x', 'p')).toBeNull();
    await sched.resolveDc();
    expect(sched.getCurrentVoltage('y', 'q')).toBeCloseTo(2.2);
  });
});

describe('MixedModeScheduler — onMcuPinChange', () => {
  it('alters the matching V source and republishes voltages', async () => {
    let drainV = 4.9;
    let gateV = 0;
    const fake = new FakeSolverAdapter({
      vectors: () => ({ 'v(net_drain)': drainV, 'v(net_gate)': gateV }),
    });
    fake.onAlter = (name, value) => {
      if (name === 'V_uno_9') {
        gateV = value;
        drainV = value >= 1.6 ? 0.05 : 4.9;
      }
    };
    __setSchedulerSolverFactoryForTests(() => fake);
    const sched = getMixedModeScheduler();
    await sched.loadCircuit(
      '* netlist',
      new Map([
        ['q1:D', 'net_drain'],
        ['q1:G', 'net_gate'],
      ]),
    );
    await sched.resolveDc();
    expect(sched.getCurrentVoltage('q1', 'D')).toBeCloseTo(4.9);
    expect(sched.getCurrentVoltage('q1', 'G')).toBeCloseTo(0);

    await sched.onMcuPinChange('uno', '9', true, 5);
    expect(fake.calls.alterSource).toEqual([['V_uno_9', 5]]);
    expect(sched.getCurrentVoltage('q1', 'G')).toBeCloseTo(5);
    expect(sched.getCurrentVoltage('q1', 'D')).toBeCloseTo(0.05);

    await sched.onMcuPinChange('uno', '9', false, 5);
    expect(sched.getCurrentVoltage('q1', 'G')).toBeCloseTo(0);
    expect(sched.getCurrentVoltage('q1', 'D')).toBeCloseTo(4.9);
  });

  it('is a no-op when no solver has been started', async () => {
    const sched = getMixedModeScheduler();
    await expect(sched.onMcuPinChange('uno', '9', true, 5)).resolves.toBeUndefined();
  });
});
