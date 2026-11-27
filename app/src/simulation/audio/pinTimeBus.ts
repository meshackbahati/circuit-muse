/**
 * Timed pin changes per board, for parts that need edge timing (sound).
 *
 * The simulators report every GPIO change with a timestamp in simulated
 * milliseconds (AVR from CPU cycles, RP2040 and ESP32-C3 from their clocks,
 * the ESP32 QEMU bridge from arrival time). The store already routes these to
 * the oscilloscope; it also publishes them here.
 */

export type PinTimeListener = (state: boolean, timeMs: number) => void;

const listeners = new Map<string, Set<PinTimeListener>>();

const key = (boardId: string, pin: number) => `${boardId}\u0000${pin}`;

export function subscribePinTime(boardId: string, pin: number, listener: PinTimeListener): () => void {
  const k = key(boardId, pin);
  let set = listeners.get(k);
  if (!set) {
    set = new Set();
    listeners.set(k, set);
  }
  set.add(listener);
  return () => {
    const current = listeners.get(k);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(k);
  };
}

export function publishPinTime(boardId: string, pin: number, state: boolean, timeMs: number): void {
  if (listeners.size === 0) return;
  const set = listeners.get(key(boardId, pin));
  if (!set) return;
  for (const listener of set) listener(state, timeMs);
}

/** For tests. */
export function clearPinTimeListeners(): void {
  listeners.clear();
}
