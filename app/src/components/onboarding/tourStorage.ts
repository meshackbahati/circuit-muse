// Kept separate from GuidedTour so the editor can check the flag without
// loading the tour itself.
export const TOUR_DONE_KEY = 'circuit-muse_tour_done';
/** Bump when tour steps are added; earlier finishers get a "What's new" tour. */
export const TOUR_VERSION = 2;

function seenVersion(): number {
  try {
    const raw = localStorage.getItem(TOUR_DONE_KEY);
    if (!raw) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch {
    return TOUR_VERSION; // No storage: do not show the tour on every launch.
  }
}

/** True when the current tour, or its new steps, have been seen. */
export function isTourDone(): boolean {
  return seenVersion() >= TOUR_VERSION;
}

/** Version the viewer last finished; 0 means never. */
export function lastSeenTourVersion(): number {
  return seenVersion();
}

export function markTourDone(): void {
  try {
    localStorage.setItem(TOUR_DONE_KEY, String(TOUR_VERSION));
  } catch {
    // Storage can be unavailable; nothing else to do.
  }
}
