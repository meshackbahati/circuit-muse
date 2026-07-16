/**
 * electricalResolveHook — lets non-SPICE code request an electrical re-solve
 * without importing the service singleton (which would create a dependency
 * cycle: customChips -> spice service -> store -> components -> customChips).
 *
 * `start.ts` registers the service's `tick()` here on mount; a custom chip
 * calls `requestElectricalResolve()` when it toggles an output pin so the
 * netlist is rebuilt with the chip's new pin voltages and the LEDs / analog
 * parts on its net update. The service coalesces overlapping ticks, so this is
 * safe to call frequently.
 */

let hook: (() => void) | null = null;

export function setElectricalResolveHook(fn: (() => void) | null): void {
  hook = fn;
}

export function requestElectricalResolve(): void {
  if (!hook) return;
  try {
    hook();
  } catch {
    /* a failed solve must never break the chip's execution loop */
  }
}
