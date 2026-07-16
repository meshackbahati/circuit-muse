/**
 * Phase 1b unit tests for PinResolver:
 *   - isActiveDevice predicate against the full active-device list
 *   - createSpiceResolvedPinResolver threshold conversion behavior
 *   - SpiceVoltageSource subscription wiring
 *
 * Doesn't exercise actual SPICE because Phase 1b is the skeleton.
 * Phase 1b continued will add tests against MixedModeScheduler with a
 * real (mocked) NgSpiceInteractive.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  isActiveDevice,
  createSpiceResolvedPinResolver,
  type SpiceVoltageSource,
} from '../simulation/PinResolver';

function mockSource(opts: { initialVoltage?: number | null } = {}): {
  source: SpiceVoltageSource;
  fire: (state: 'HIGH' | 'LOW' | 'FLOATING' | 'CONFLICT', voltage: number) => void;
  subscribers: Array<{ componentId: string; pinName: string; cb: (state: string, v: number) => void }>;
} {
  const subscribers: Array<{ componentId: string; pinName: string; cb: (state: string, v: number) => void }> = [];
  let voltage = opts.initialVoltage ?? null;
  const source: SpiceVoltageSource = {
    subscribe(componentId, componentPinName, cb) {
      const entry = { componentId, pinName: componentPinName, cb: cb as (s: string, v: number) => void };
      subscribers.push(entry);
      return () => {
        const idx = subscribers.indexOf(entry);
        if (idx >= 0) subscribers.splice(idx, 1);
      };
    },
    getCurrentVoltage() {
      return voltage;
    },
  };
  return {
    source,
    subscribers,
    fire(state, v) {
      voltage = v;
      for (const s of subscribers) s.cb(state, v);
    },
  };
}

describe('isActiveDevice', () => {
  it('reports true for every BJT/MOSFET/op-amp/diode part-number', () => {
    expect(isActiveDevice('bjt-2n2222')).toBe(true);
    expect(isActiveDevice('bjt-bc547')).toBe(true);
    expect(isActiveDevice('mosfet-2n7000')).toBe(true);
    expect(isActiveDevice('mosfet-irf540')).toBe(true);
    expect(isActiveDevice('opamp-lm358')).toBe(true);
    expect(isActiveDevice('opamp-ideal')).toBe(true);
    expect(isActiveDevice('diode-1n4148')).toBe(true);
    expect(isActiveDevice('led')).toBe(true);
    expect(isActiveDevice('relay')).toBe(true);
    expect(isActiveDevice('7805')).toBe(true);
    expect(isActiveDevice('lm317')).toBe(true);
  });

  it('reports false for passives and digital ICs', () => {
    expect(isActiveDevice('resistor')).toBe(false);
    expect(isActiveDevice('resistor-220')).toBe(false);
    expect(isActiveDevice('capacitor')).toBe(false);
    expect(isActiveDevice('cap-1u')).toBe(false);
    expect(isActiveDevice('inductor')).toBe(false);
    // Digital ICs are NOT routed through SPICE — they have their own
    // pre-decoded handlers
    expect(isActiveDevice('ic-74hc14')).toBe(false);
    expect(isActiveDevice('74hc595')).toBe(false);
  });
});

describe('createSpiceResolvedPinResolver', () => {
  it('reports FLOATING when the voltage source has no value yet', () => {
    const { source } = mockSource({ initialVoltage: null });
    const r = createSpiceResolvedPinResolver('bjt-1', 'C', source, {
      thresholdHigh: 2.5,
      thresholdLow: 2.5,
      vcc: 5,
    });
    expect(r.getCurrentState()).toBe('FLOATING');
    expect(r.getCurrentVoltage()).toBeNull();
  });

  it('reports HIGH when voltage is above thresholdHigh', () => {
    const { source } = mockSource({ initialVoltage: 4.5 });
    const r = createSpiceResolvedPinResolver('bjt-1', 'C', source, {
      thresholdHigh: 2.5,
      thresholdLow: 2.5,
      vcc: 5,
    });
    expect(r.getCurrentState()).toBe('HIGH');
    expect(r.getCurrentVoltage()).toBeCloseTo(4.5);
  });

  it('reports LOW when voltage is below thresholdLow', () => {
    const { source } = mockSource({ initialVoltage: 0.3 });
    const r = createSpiceResolvedPinResolver('bjt-1', 'C', source, {
      thresholdHigh: 2.5,
      thresholdLow: 2.5,
      vcc: 5,
    });
    expect(r.getCurrentState()).toBe('LOW');
    expect(r.getCurrentVoltage()).toBeCloseTo(0.3);
  });

  it('emits state changes via onChange when the voltage crosses a threshold', () => {
    const { source, fire } = mockSource({ initialVoltage: 0 });
    const r = createSpiceResolvedPinResolver('bjt-1', 'C', source, {
      thresholdHigh: 2.5,
      thresholdLow: 2.5,
      vcc: 5,
    });
    const cb = vi.fn();
    r.onChange(cb);

    fire('LOW', 0.5);
    expect(cb).not.toHaveBeenCalled(); // still LOW, no transition

    fire('HIGH', 4.5);
    expect(cb).toHaveBeenCalledWith('HIGH', 4.5);

    fire('HIGH', 3.0);
    expect(cb).toHaveBeenCalledTimes(1); // already HIGH, no new transition

    fire('LOW', 0.5);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith('LOW', 0.5);
  });

  it('respects the hysteresis dead band (different thresholds)', () => {
    const { source, fire } = mockSource({ initialVoltage: 0 });
    const r = createSpiceResolvedPinResolver('schmitt-1', 'A', source, {
      thresholdHigh: 3.0,
      thresholdLow: 1.5,
      vcc: 5,
    });
    const cb = vi.fn();
    r.onChange(cb);

    fire('LOW', 2.0);  // in the dead band — stays LOW
    expect(cb).not.toHaveBeenCalled();

    fire('HIGH', 3.5);  // crosses upper threshold → HIGH
    expect(cb).toHaveBeenCalledWith('HIGH', 3.5);
    cb.mockClear();

    fire('HIGH', 2.0);  // back in dead band — stays HIGH (hysteresis)
    expect(cb).not.toHaveBeenCalled();

    fire('LOW', 1.0);  // crosses lower threshold → LOW
    expect(cb).toHaveBeenCalledWith('LOW', 1.0);
  });

  it('returns an unsubscribe handle that detaches from the source', () => {
    const { source, subscribers, fire } = mockSource({ initialVoltage: 0 });
    const r = createSpiceResolvedPinResolver('bjt-1', 'C', source, {
      thresholdHigh: 2.5,
      thresholdLow: 2.5,
      vcc: 5,
    });
    const cb = vi.fn();
    const cancel = r.onChange(cb);

    expect(subscribers.length).toBe(1);
    cancel();
    expect(subscribers.length).toBe(0);

    fire('HIGH', 4.5);
    expect(cb).not.toHaveBeenCalled();
  });
});
