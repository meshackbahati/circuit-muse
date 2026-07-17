/**
 * connectMcuEdgesToService — bridges MCU pin transitions to the
 * CircuitSimulationService, completing the mixed-mode loop.
 *
 * Without this wiring, the service only re-solves on canvas changes —
 * MCU edges propagate via PinManager → component handlers directly,
 * but SPICE never sees them.  This module:
 *
 *   1. Subscribes to each board's PinManager for every pin referenced
 *      by a wire (i.e., pins that appear in the SPICE netlist).
 *   2. Coalesces edges per pin (last-state-wins inside a 16 ms
 *      window) so kHz toggles don't drown the solver.
 *   3. Calls `service.handleMcuEdge(boardId, pinName, state, vcc)`
 *      which alters the corresponding V source + re-resolves +
 *      publishes the new electrical snapshot.
 *
 * Why batching here and not in the service:
 *   - The service is solver-rate (limited by ngspice solve time).
 *   - PinManager events fire at MCU clock rate (16 MHz simulated).
 *   - Throttling at the source matches event rates; throttling at the
 *     service would still queue O(N) edges per ms.
 *
 * Lifecycle: mount alongside the service in EditorPage.  Re-subscribes
 * when boards change (board lifecycle = new PinManager instance).
 */
import {
  useSimulatorStore,
  getBoardPinManager,
} from '../../store/useSimulatorStore';
import { useElectricalStore } from '../../store/useElectricalStore';
import { BOARD_PIN_GROUPS } from './boardPinGroups';
import type { CircuitSimulationService } from './CircuitSimulationService';

/** How long edges per pin coalesce.  16 ms ≈ 60 fps, well below any
 *  human-perceptible MCU update rate and above the solver's per-edge
 *  cost (~5-15 ms for typical netlists). */
const COALESCE_WINDOW_MS = 16;

/**
 * Wire MCU pin transitions to the service.  Returns an unsubscribe
 * handle.  Idempotent — calling twice double-subscribes; callers
 * should hold a single instance per editor mount.
 */
export function connectMcuEdgesToService(service: CircuitSimulationService): () => void {
  // Per-board, per-pin subscriptions (Arduino pin number → unsubscribe).
  const boardSubs = new Map<string, Map<number, () => void>>();
  // Pending coalesced state per pin.
  const pending = new Map<string, { state: boolean; vcc: number; pinName: string; timer: ReturnType<typeof setTimeout> | null }>();

  function pinKey(boardId: string, pinName: string): string {
    return `${boardId}|${pinName}`;
  }

  function flushPin(boardId: string, pinName: string): void {
    const key = pinKey(boardId, pinName);
    const entry = pending.get(key);
    if (!entry) return;
    pending.delete(key);
    void service.handleMcuEdge(boardId, pinName, entry.state, entry.vcc);
  }

  function schedulePin(boardId: string, pinName: string, state: boolean, vcc: number): void {
    const key = pinKey(boardId, pinName);
    const existing = pending.get(key);
    if (existing) {
      existing.state = state; // last-state-wins
      return;
    }
    const timer = setTimeout(() => flushPin(boardId, pinName), COALESCE_WINDOW_MS);
    pending.set(key, { state, vcc, pinName, timer });
  }

  function arduinoPinToName(arduinoPin: number, boardKind: string): string | null {
    // Reverse of pinNameToArduinoPin in subscribeToStore.ts.  Both
    // need to live until subscribeToStore is deleted; trade-off
    // accepted for now since the mapping is per-board-family.
    if (boardKind === 'arduino-uno' || boardKind === 'arduino-nano' || boardKind === 'arduino-mega') {
      if (arduinoPin >= 14 && arduinoPin <= 21) return `A${arduinoPin - 14}`;
      return String(arduinoPin);
    }
    if (boardKind === 'raspberry-pi-pico' || boardKind === 'pi-pico-w') {
      return `GP${arduinoPin}`;
    }
    if (boardKind.startsWith('esp32')) {
      return `GPIO${arduinoPin}`;
    }
    return String(arduinoPin);
  }

  /**
   * Look up which pin names this board actually wires into the SPICE
   * netlist.  Reads from `pinNetMap` (populated after each solve) so
   * we subscribe to ~3-8 pins per board instead of all 64.
   *
   * Iteration #11: previously we subscribed to every Arduino pin 0..63
   * "since unused listeners are free" — true for AVR (8 pins) but
   * spammy for ESP32 (40+ GPIOs × multiple boards = thousands of
   * dead listeners).  Now scoped to pins the circuit references.
   */
  function pinsInCircuit(boardId: string): Set<string> {
    const { pinNetMap } = useElectricalStore.getState();
    const pins = new Set<string>();
    for (const key of pinNetMap.keys()) {
      const idx = key.indexOf(':');
      if (idx < 0) continue;
      if (key.slice(0, idx) === boardId) pins.add(key.slice(idx + 1));
    }
    return pins;
  }

  function subscribeBoard(boardId: string, boardKind: string): void {
    const pm = getBoardPinManager(boardId);
    if (!pm) return;
    const group = BOARD_PIN_GROUPS[boardKind as keyof typeof BOARD_PIN_GROUPS] ?? BOARD_PIN_GROUPS.default;
    const vcc = group.vcc;

    const pinSubs = new Map<number, () => void>();
    boardSubs.set(boardId, pinSubs);

    const wanted = pinsInCircuit(boardId);

    // Sweep 0..63 but only attach a listener when the pin name maps
    // to one of the wires in the current netlist.  Re-subscription
    // when the canvas changes happens via `syncBoardSubscriptions` on
    // store-level board diffs and on `pinNetMap` updates below.
    for (let pin = 0; pin < 64; pin++) {
      const pinName = arduinoPinToName(pin, boardKind);
      if (!pinName) continue;
      if (wanted.size > 0 && !wanted.has(pinName)) continue;
      const unsub = pm.onPinChange(pin, (_p, state) => {
        // Suppress digital edges when the pin has active PWM. The OCR-based
        // PWM duty is converted to a DC-averaged voltage in NetlistBuilder
        // (`state.duty * board.vcc`), giving smooth analog dimming. If we
        // also let the Timer1/Timer2-driven port toggles fire alterSource,
        // each PWM cycle's HIGH/LOW transition would race with the duty
        // average and force the V-source to bounce between 0 and vcc —
        // making `analogWrite(pin, 128)` look like a binary blink instead
        // of a steady 2.5 V (Fade-LED example regression).
        if (pm.getPwmValue(pin) > 0) return;
        schedulePin(boardId, pinName, state, vcc);
      });
      pinSubs.set(pin, unsub);

      // Re-tick when PWM duty changes so the duty-averaged V-source picks
      // up new analogWrite values. Without this, duty stays whatever it was
      // at first solve and `analogWrite()` in a loop never updates the
      // visible LED. Throttled to ~60 Hz to amortise the netlist-rebuild
      // cost (the firmware ramps brightness every 30 ms in the canonical
      // Fade-LED example, well within this budget).
      let pwmTickPending = false;
      const unsubPwm = pm.onPwmChange(pin, () => {
        if (pwmTickPending) return;
        pwmTickPending = true;
        setTimeout(() => {
          pwmTickPending = false;
          void service.tick();
        }, 16);
      });
      pinSubs.set(pin + 1000, unsubPwm); // key offset to avoid collision
    }
  }

  function unsubscribeBoard(boardId: string): void {
    const pinSubs = boardSubs.get(boardId);
    if (!pinSubs) return;
    for (const unsub of pinSubs.values()) unsub();
    boardSubs.delete(boardId);
  }

  function syncBoardSubscriptions(): void {
    const boards = useSimulatorStore.getState().boards;
    const wanted = new Set(boards.map((b) => b.id));
    for (const id of Array.from(boardSubs.keys())) {
      if (!wanted.has(id)) unsubscribeBoard(id);
    }
    for (const b of boards) {
      if (!boardSubs.has(b.id)) subscribeBoard(b.id, b.boardKind);
    }
  }

  syncBoardSubscriptions();

  const unsubBoards = useSimulatorStore.subscribe((state, prev) => {
    if (state.boards !== prev.boards) syncBoardSubscriptions();
  });

  // Re-subscribe when the pinNetMap changes — a new wire / removed
  // wire might add or drop pins that need listeners.  Drop ALL subs
  // and re-create from the new pinNetMap (cheap: a Map clear and
  // ~10 pm.onPinChange calls).
  const unsubElectrical = useElectricalStore.subscribe((state, prev) => {
    if (state.pinNetMap === prev.pinNetMap) return;
    const boards = useSimulatorStore.getState().boards;
    for (const id of Array.from(boardSubs.keys())) unsubscribeBoard(id);
    for (const b of boards) subscribeBoard(b.id, b.boardKind);
  });

  return () => {
    unsubBoards();
    unsubElectrical();
    for (const pinSubs of boardSubs.values()) {
      for (const unsub of pinSubs.values()) unsub();
    }
    boardSubs.clear();
    for (const entry of pending.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    pending.clear();
  };
}
