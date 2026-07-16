/**
 * Unit tests for the default PinResolver.
 *
 * These cover the Phase-0 deliverable: a PinResolver that wraps the
 * existing getArduinoPin trace + pinManager subscription. Behavior
 * must be identical to the legacy path; the abstraction just makes
 * the swap to a SPICE-resolved implementation possible in Phase 1.
 *
 * See project/sim-mixedmode/phase-00-pin-resolver.md
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createDefaultPinResolver,
  type PinResolverContext,
  type PinTracer,
} from '../simulation/PinResolver';

function makeCtx(overrides: Partial<PinResolverContext> = {}): PinResolverContext {
  return {
    components: [],
    boards: [],
    wires: [],
    ownerBoard: null,
    ownerBoardVcc: 5,
    subscribeArduinoPin: () => () => {},
    readArduinoPin: () => null,
    ...overrides,
  };
}

describe('PinResolver — default impl', () => {
  it('reports FLOATING when the pin is not wired to any board pin', () => {
    const tracer: PinTracer = () => null;
    const r = createDefaultPinResolver('led-1', 'A', makeCtx(), tracer);
    expect(r.getCurrentState()).toBe('FLOATING');
    expect(r.getCurrentVoltage()).toBeNull();
  });

  it('reports LOW with voltage 0 when the pin is tied to GND (tracer returns -1)', () => {
    const tracer: PinTracer = () => -1;
    const r = createDefaultPinResolver('led-1', 'C', makeCtx(), tracer);
    expect(r.getCurrentState()).toBe('LOW');
    expect(r.getCurrentVoltage()).toBe(0);
  });

  it('reads HIGH/LOW from readArduinoPin when wired to a GPIO', () => {
    const tracer: PinTracer = () => 13;
    let pinValue = false;
    const ctx = makeCtx({
      readArduinoPin: (pin) => (pin === 13 ? pinValue : null),
    });
    const r = createDefaultPinResolver('led-1', 'A', ctx, tracer);

    pinValue = false;
    expect(r.getCurrentState()).toBe('LOW');
    expect(r.getCurrentVoltage()).toBe(0);
  });

  it('synthesises voltage from owner board Vcc on HIGH', () => {
    const tracer: PinTracer = () => 13;
    const ctx = makeCtx({
      ownerBoardVcc: 3.3,
      readArduinoPin: () => true,
    });
    const r = createDefaultPinResolver('led-1', 'A', ctx, tracer);
    expect(r.getCurrentState()).toBe('HIGH');
    expect(r.getCurrentVoltage()).toBeCloseTo(3.3);
  });

  it('subscribes to pin changes via subscribeArduinoPin and fires callbacks', () => {
    const tracer: PinTracer = () => 7;
    const subscribers: Array<(pin: number, state: boolean) => void> = [];
    const unsub = vi.fn();
    const ctx = makeCtx({
      subscribeArduinoPin: (_pin, cb) => {
        subscribers.push(cb);
        return unsub;
      },
    });
    const r = createDefaultPinResolver('led-1', 'A', ctx, tracer);
    const onChange = vi.fn();
    const cancel = r.onChange(onChange);

    // Manually fire as if PinManager delivered an event
    subscribers[0]!(7, true);
    expect(onChange).toHaveBeenCalledWith('HIGH', 5);
    subscribers[0]!(7, false);
    expect(onChange).toHaveBeenCalledWith('LOW', 0);

    // Caller can unsubscribe cleanly
    cancel();
    expect(unsub).toHaveBeenCalled();
  });

  it('returns a no-op unsubscribe when the pin is unwired (tracer returns null)', () => {
    const tracer: PinTracer = () => null;
    const ctx = makeCtx({
      subscribeArduinoPin: vi.fn(),
    });
    const r = createDefaultPinResolver('led-1', 'A', ctx, tracer);
    const onChange = vi.fn();
    const cancel = r.onChange(onChange);
    expect(ctx.subscribeArduinoPin).not.toHaveBeenCalled();
    expect(typeof cancel).toBe('function');
    cancel(); // should not throw
  });

  it('emits an initial LOW event asynchronously when wired to GND', async () => {
    const tracer: PinTracer = () => -1;
    const r = createDefaultPinResolver('led-1', 'C', makeCtx(), tracer);
    const onChange = vi.fn();
    r.onChange(onChange);

    // Microtask queue flush — the resolver schedules the LOW event via
    // queueMicrotask so subscribers see initial state without blocking
    // construction.
    await Promise.resolve();
    expect(onChange).toHaveBeenCalledWith('LOW', 0);
  });

  it('updates getCurrentState immediately after a subscribed callback fires', () => {
    const tracer: PinTracer = () => 9;
    const subscribers: Array<(pin: number, state: boolean) => void> = [];
    const ctx = makeCtx({
      subscribeArduinoPin: (_pin, cb) => {
        subscribers.push(cb);
        return () => {};
      },
      readArduinoPin: () => false,
    });
    const r = createDefaultPinResolver('led-1', 'A', ctx, tracer);
    r.onChange(() => {});

    expect(r.getCurrentState()).toBe('LOW');
    subscribers[0]!(9, true);
    expect(r.getCurrentState()).toBe('HIGH');
    expect(r.getCurrentVoltage()).toBe(5);
  });
});
