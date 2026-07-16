/**
 * GPIO Matrix-aware signal router (frontend mirror).
 *
 * The ESP32 SoC's IO_MUX + GPIO Matrix decouples *signal sources*
 * (LEDC channels, RMT channels, UART TX, SPI MOSI, ...) from
 * physical *GPIO pins* via a 40-entry routing table. The backend
 * worker observes writes to that table and broadcasts a
 * `gpio_routing` event for each change; this class is the frontend's
 * replicated view, used to route peripheral events (e.g.
 * `ledc_duty {channel, duty_pct}`) to the correct pin(s).
 *
 * Replaces `PinManager.broadcastPwm` + the per-channel memo
 * workaround that previously masked the multi-servo blink bug
 * (see commit 77bf897). With the router in place the frontend
 * always knows which pin a signal source drives — no broadcasting,
 * no guessing.
 *
 * 1-to-1 port of `backend/app/services/signal_router.py`. Tests in
 * `__tests__/SignalRouter.test.ts` are the mirror of
 * `test/backend/unit/test_signal_router.py`.
 */

export class SignalRouter {
  // gpio_pin → signal_id
  private readonly matrix = new Map<number, number>();
  // signal_id → set of gpio_pins (reverse index)
  private readonly sources = new Map<number, Set<number>>();

  // ── Mutators ────────────────────────────────────────────────────────

  /**
   * Record that `gpioPin` is now driven by `signalId`.  If the pin
   * previously routed from a different signal, it is removed from
   * that signal's set first — the reverse index stays a true
   * partition of the matrix.
   */
  updateRouting(gpioPin: number, signalId: number): void {
    const old = this.matrix.get(gpioPin);
    if (old === signalId) return; // idempotent
    if (old !== undefined) {
      this.sources.get(old)?.delete(gpioPin);
      if (this.sources.get(old)?.size === 0) {
        this.sources.delete(old);
      }
    }
    this.matrix.set(gpioPin, signalId);
    let set = this.sources.get(signalId);
    if (!set) {
      set = new Set();
      this.sources.set(signalId, set);
    }
    set.add(gpioPin);
  }

  /**
   * Remove `gpioPin` from the matrix entirely. Equivalent to the
   * firmware resetting `gpio_out_sel[gpioPin]` back to the default
   * 'GPIO direct out' sentinel.  Idempotent.
   */
  clearRouting(gpioPin: number): void {
    const old = this.matrix.get(gpioPin);
    if (old === undefined) return;
    this.matrix.delete(gpioPin);
    this.sources.get(old)?.delete(gpioPin);
    if (this.sources.get(old)?.size === 0) {
      this.sources.delete(old);
    }
  }

  /**
   * Drop the entire matrix (e.g. on board reset / simulation stop).
   */
  reset(): void {
    this.matrix.clear();
    this.sources.clear();
  }

  // ── Readers ─────────────────────────────────────────────────────────

  /**
   * Return every gpio_pin currently driven by `signalId`. The
   * returned array is a snapshot — safe to iterate while the router
   * mutates (unlike a live view into the reverse index).
   */
  pinsForSignal(signalId: number): number[] {
    const set = this.sources.get(signalId);
    if (!set) return [];
    return Array.from(set).sort((a, b) => a - b);
  }

  /**
   * Return the signal id currently routed to `gpioPin`, or undefined
   * when the pin is unmapped (GPIO direct-out).
   */
  signalForGpio(gpioPin: number): number | undefined {
    return this.matrix.get(gpioPin);
  }

  /**
   * Iterate the full matrix as [gpioPin, signalId] entries. Useful
   * for snapshot-style debugging.
   */
  *routes(): Iterable<[number, number]> {
    for (const entry of this.matrix.entries()) {
      yield entry;
    }
  }

  get size(): number {
    return this.matrix.size;
  }
}
