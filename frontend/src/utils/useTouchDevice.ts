/**
 * Touch-device detection.
 *
 * Why a hook (and a media query) instead of `navigator.maxTouchPoints > 0`?
 * On Windows 11 + Chromium/Firefox, laptops with touchscreen drivers report
 * `maxTouchPoints > 0` even when the user is on a mouse — that made
 * `PinOverlay` blow pin hit-targets up to 44 / zoom CSS pixels and cover the
 * whole board. `(pointer: coarse)` is true only when the *primary* pointer is
 * coarse (real mobile/tablet), which is what we actually want for sizing
 * touch-friendly UI.
 */

import { useEffect, useState } from 'react';

const COARSE_QUERY = '(pointer: coarse)';

/** Snapshot read for non-React call sites (event handlers, refs, module scope). */
export function isCoarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(COARSE_QUERY).matches;
}

/** React hook — re-renders if the user docks/undocks a tablet, plugs a mouse, etc. */
export function useIsCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState<boolean>(() => isCoarsePointer());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(COARSE_QUERY);
    const handler = (e: MediaQueryListEvent) => setCoarse(e.matches);
    // Safari < 14 only has addListener / removeListener
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }, []);

  return coarse;
}
