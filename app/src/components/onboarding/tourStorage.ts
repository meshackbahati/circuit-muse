// Kept separate from GuidedTour so the editor can check the flag without
// loading the tour itself.
export const TOUR_DONE_KEY = 'circuit-muse_tour_done';

export function isTourDone(): boolean {
  try {
    return localStorage.getItem(TOUR_DONE_KEY) === '1';
  } catch {
    return true; // No storage: do not show the tour on every launch.
  }
}

export function markTourDone(): void {
  try {
    localStorage.setItem(TOUR_DONE_KEY, '1');
  } catch {
    // Storage can be unavailable; nothing else to do.
  }
}
