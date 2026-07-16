/**
 * Shared helpers for cross-board interconnect tests.
 *
 * NOTE: vi.mock factories must be hoist-safe so the simulator class
 * mocks live INLINE in each test file. This module hosts only the
 * non-hoisted helpers (wire builders, store reset).
 */

import type { Wire } from '../../types/wire';

// ── Wire builder ─────────────────────────────────────────────────────────────

export interface WireSpec {
  id?: string;
  fromBoard: string;
  fromPin: string;
  toBoard: string;
  toPin: string;
  color?: string;
}

export function buildWire(spec: WireSpec, idx = 0): Wire {
  return {
    id: spec.id ?? `w-${idx}`,
    start: { componentId: spec.fromBoard, pinName: spec.fromPin, x: 0, y: 0 },
    end: { componentId: spec.toBoard, pinName: spec.toPin, x: 0, y: 0 },
    waypoints: [],
    color: spec.color ?? '#00ff00',
  };
}

export function setWires(useSimulatorStore: any, specs: WireSpec[]): void {
  const wires = specs.map((s, i) => buildWire(s, i));
  useSimulatorStore.setState({ wires });
}

export function resetStore(useSimulatorStore: any): void {
  useSimulatorStore.setState(useSimulatorStore.getInitialState?.() ?? {});
}

/**
 * Clear cached pin states on every currently-bound PinManager. Pass
 * the `getBoardPinManager` accessor exported from the store and the
 * current board list. Required between tests so that the same-state
 * short-circuit in PinManager.triggerPinChange doesn't suppress fresh
 * events.
 *
 * Uses hardResetPinStates (clear cache + classifications), not the
 * stopBoard-flavored resetPinStates (classifications only) which
 * leaves cached pin states intact so the display can resume after a
 * pause.
 */
export function clearAllPinManagerState(
  useSimulatorStore: any,
  getBoardPinManager: (id: string) => any,
): void {
  const state = useSimulatorStore.getState();
  for (const b of state.boards ?? []) {
    const pm = getBoardPinManager(b.id);
    if (pm?.hardResetPinStates) {
      pm.hardResetPinStates();
    } else {
      pm?.resetPinStates?.();
    }
  }
}

/**
 * Force a full re-bind of every current board in the store with the
 * Interconnect singleton — call this after `resetStore` so that the
 * router's `boards` map matches the freshly-reset store state.
 *
 * Without this the Interconnect can carry stale (boardId → kind)
 * bindings across tests and quietly skip routing because `bindBoard`
 * is idempotent.
 */
export function rebindInterconnect(
  useSimulatorStore: any,
  ic: {
    resetInterconnect: () => void;
    bindBoard: (id: string, kind: string) => void;
    updateWires: (wires: readonly any[]) => void;
  },
): void {
  ic.resetInterconnect();
  const { boards, wires } = useSimulatorStore.getState();
  for (const b of boards) ic.bindBoard(b.id, b.boardKind);
  ic.updateWires(wires);
}
