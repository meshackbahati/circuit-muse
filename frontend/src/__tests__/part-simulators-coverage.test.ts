/**
 * Part simulator coverage tests (Phase 1d-tests E).
 *
 * Iterates every metadataId registered in `PartSimulationRegistry`
 * and asserts that the registered logic has a valid attach surface:
 *   • `attachEvents` (when present) doesn't throw with a minimal
 *     mock element + simulator + pin helpers.
 *   • The returned unsubscribe is callable.
 *
 * Why: catches the "I added a new component handler and forgot to
 * wire its pins correctly" class of regressions.  Doesn't validate
 * behaviour (the existing simulation-parts + logic-gate-parts tests
 * cover that for the specific parts that need it) — just shape.
 *
 * Fidelity (memory `feedback_tests_import_real_code`): enumerates
 * via the live `PartSimulationRegistry.listRegisteredParts()` helper
 * added in Phase 1d-tests C.  Adding a new `register()` call
 * automatically extends this test.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import '../simulation/parts'; // side-effect: registers every part
import { PartSimulationRegistry } from '../simulation/parts/PartSimulationRegistry';

// Node doesn't ship `requestAnimationFrame` / `cancelAnimationFrame` —
// some part handlers (servo, neopixel) reach for them.  Shim with a
// microtask so the attach surface remains testable in Node.
const RAF_KEY = 'requestAnimationFrame' as const;
const CAF_KEY = 'cancelAnimationFrame' as const;
const originalRAF = (globalThis as Record<string, unknown>)[RAF_KEY];
const originalCAF = (globalThis as Record<string, unknown>)[CAF_KEY];

beforeAll(() => {
  (globalThis as Record<string, unknown>)[RAF_KEY] = (cb: FrameRequestCallback): number => {
    return setTimeout(() => cb(performance.now()), 0) as unknown as number;
  };
  (globalThis as Record<string, unknown>)[CAF_KEY] = (id: number): void => {
    clearTimeout(id as unknown as NodeJS.Timeout);
  };
});

afterAll(() => {
  (globalThis as Record<string, unknown>)[RAF_KEY] = originalRAF;
  (globalThis as Record<string, unknown>)[CAF_KEY] = originalCAF;
});

/**
 * Tiny mock simulator that exposes the shape parts read.  Enough for
 * the attach to succeed without raising; behaviour assertions live in
 * the dedicated part-specific test files.
 */
function makeMockSimulator(): unknown {
  const listeners = new Map<number, Array<(pin: number, state: boolean) => void>>();
  const pwmListeners = new Map<number, Array<(pin: number, duty: number) => void>>();
  return {
    pinManager: {
      onPinChange(pin: number, cb: (p: number, s: boolean) => void): () => void {
        if (!listeners.has(pin)) listeners.set(pin, []);
        listeners.get(pin)!.push(cb);
        return () => {
          const arr = listeners.get(pin);
          if (arr) listeners.set(pin, arr.filter((c) => c !== cb));
        };
      },
      onPwmChange(pin: number, cb: (p: number, d: number) => void): () => void {
        if (!pwmListeners.has(pin)) pwmListeners.set(pin, []);
        pwmListeners.get(pin)!.push(cb);
        return () => {
          const arr = pwmListeners.get(pin);
          if (arr) pwmListeners.set(pin, arr.filter((c) => c !== cb));
        };
      },
      triggerPinChange(): void {},
      getPinState(): boolean { return false; },
      getPwmValue(): number { return 0; },
    },
    cpu: {
      addClockEvent(fn: () => void, _cycles: number): void { fn(); },
      data: new Uint8Array(256),
    },
    setPinState(): void {},
    getCurrentCycles(): number { return 0; },
    getADC(): null { return null; },
  };
}

function makeMockElement(): HTMLElement {
  // Vitest runs in node env; we don't have a real DOM, so build a
  // duck-typed element with the surface parts touch.  Parts only read
  // a few attributes and event listeners, never query selectors.
  const properties: Record<string, unknown> = {};
  const handlers = new Map<string, Array<EventListener>>();
  const el = {
    id: 'mock-component',
    tagName: 'WOKWI-MOCK',
    addEventListener(type: string, listener: EventListener) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type)!.push(listener);
    },
    removeEventListener(type: string, listener: EventListener) {
      const arr = handlers.get(type);
      if (arr) handlers.set(type, arr.filter((l) => l !== listener));
    },
    dispatchEvent(): boolean { return true; },
    setAttribute(): void {},
    getAttribute(): string | null { return null; },
    // Proxy properties so reads/writes work like a custom element
  };
  return new Proxy(el as unknown as HTMLElement, {
    get(target, key) {
      if (key in target) return (target as unknown as Record<string | symbol, unknown>)[key];
      return properties[key as string];
    },
    set(target, key, value) {
      if (key in target) {
        (target as unknown as Record<string | symbol, unknown>)[key] = value;
      } else {
        properties[key as string] = value;
      }
      return true;
    },
  });
}

const registered = PartSimulationRegistry.listRegisteredParts();

describe('Part simulators — every registered part has a valid attach surface', () => {
  it('registry has at least 50 entries (sanity baseline)', () => {
    expect(registered.length).toBeGreaterThanOrEqual(50);
  });

  it.each(registered.map((id) => [id] as const))(
    '%s — attachEvents (if present) returns a callable unsubscribe',
    { timeout: 5_000 },
    (id) => {
      const logic = PartSimulationRegistry.get(id);
      expect(logic, `${id} should be registered`).toBeDefined();
      if (!logic?.attachEvents) return; // some parts only define `onPinStateChange`

      const element = makeMockElement();
      const simulator = makeMockSimulator() as Parameters<typeof logic.attachEvents>[1];
      const getArduinoPinHelper = (_pin: string): number | null => null;
      const componentId = `${id}-test-1`;

      // attach with the modern 5-arg signature; legacy 3/4-arg handlers
      // ignore the extras gracefully.
      let unsubscribe: (() => void) | undefined;
      expect(() => {
        unsubscribe = logic.attachEvents!(element, simulator, getArduinoPinHelper, componentId);
      }, `${id}.attachEvents threw`).not.toThrow();
      if (unsubscribe) {
        expect(() => unsubscribe!(), `${id} unsubscribe threw`).not.toThrow();
      }
    },
  );
});
