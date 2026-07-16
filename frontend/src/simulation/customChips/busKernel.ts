/**
 * Synchronous settle kernel for chip-to-chip bus nets — Phase 2 of the
 * multi-chip digital bus track (project/multichip-bus/).
 *
 * THE PROBLEM (root cause B, 00-problem-analysis.md section 3): a CPU bus cycle
 * runs synchronously inside one tickTimers call — drive address + strobe, then
 * `vx_pin_read` the data bus in the SAME C call. For that read to return the
 * byte the memory chip drove, the memory chip must have reacted BEFORE the read.
 * Phase 0/1 gave shared keys + driver resolution, but applying each net change
 * by firing PinManager listeners immediately recurses: chip A's write -> chip B's
 * watch -> chip B's write -> ... One JS frame per hop, so a deep glue chain is
 * deep recursion and a combinational loop (a ring oscillator) overflows the stack
 * and kills the tab.
 *
 * THE FIX (01-how-proteus-works.md section 2.4 + 4.2, Option B): a delta-cycle
 * settle loop. A net change is recorded, not applied recursively; `settle()`
 * drains the pending set in batches (deltas), applying each batch and letting the
 * driven chips re-dirty the next, until no net changes (fixed point) or the
 * iteration cap trips. Two-phase: a drive lands in `pending` and is APPLIED to
 * the PinManager on the next delta, so a chip evaluating mid-settle reads the
 * last-stable net values, never a half-updated net. Because the first drive of a
 * cycle settles to its fixed point synchronously before control returns to the
 * chip's C code, the subsequent in-cycle `vx_pin_read` sees settled data —
 * settle-before-read without a new chip-side API.
 */

interface PinManagerLike {
  triggerPinChange(pin: number, state: boolean, source?: 'mcu' | 'external'): void;
}

// Pending net level changes for the current settle pass: netKey -> resolved
// boolean. A Map coalesces multiple drives of one net within a delta to the
// latest value (glitch suppression within zero time).
const pending = new Map<number, boolean>();
let settling = false;
let pm: PinManagerLike | null = null;

// A combinational loop with no stable state (e.g. a zero-delay inverter ring)
// would settle forever; cap the delta count and report it instead of hanging.
const DELTA_CAP = 10000;

/**
 * Record that a bus net resolved to `level` and ensure the fabric settles.
 * Called by busNets after every re-resolution. If a settle is already in
 * progress (we are inside a watcher that drove another net), just enqueue —
 * the running loop will apply it on the next delta (this is what turns the
 * recursive cascade into a bounded iteration).
 */
export function publishNetLevel(pinManager: PinManagerLike, netKey: number, level: boolean): void {
  pm = pinManager;
  pending.set(netKey, level);
  if (!settling) settle();
}

function settle(): void {
  settling = true;
  let deltas = 0;
  try {
    while (pending.size > 0) {
      if (++deltas > DELTA_CAP) {
        console.warn(
          `[chipbus] settle did not converge after ${DELTA_CAP} delta cycles — ` +
            `combinational loop / oscillation? Bailing to keep the UI responsive.`,
        );
        pending.clear();
        break;
      }
      // PHASE A->B: snapshot this delta's changes and clear pending, THEN apply
      // them. Applying fires watchers whose drives re-resolve nets and enqueue
      // into the now-empty `pending` for the NEXT delta — so no chip observes a
      // net that is mid-update within its own evaluation.
      const batch = [...pending.entries()];
      pending.clear();
      for (const [netKey, level] of batch) {
        pm!.triggerPinChange(netKey, level);
      }
    }
  } finally {
    settling = false;
  }
}

/** Test seam: clear all settle state. */
export function resetBusKernel(): void {
  pending.clear();
  settling = false;
  pm = null;
}
