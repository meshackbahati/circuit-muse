/**
 * WireModeBanner
 *
 * Shown along the bottom of the canvas while a wire is in progress. The
 * Cancel button uses native touch handlers because the simulator canvas binds
 * its own `touchend` listener with `preventDefault()` — which would otherwise
 * suppress the synthetic click on this button on mobile, leaving users
 * unable to abort wire creation.
 *
 * Same trick as SelectionActionBar.tsx: stop native propagation on the
 * banner's container so the canvas listener never sees the event, and bind
 * native `touchend` on the button to fire the action directly.
 */

import React, { useEffect, useRef } from 'react';

interface WireModeBannerProps {
  message: string;
  onCancel: () => void;
}

export const WireModeBanner: React.FC<WireModeBannerProps> = ({ message, onCancel }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Block native touch events from bubbling into the canvas's own listener.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    el.addEventListener('touchstart', stop, { passive: false });
    el.addEventListener('touchmove', stop, { passive: false });
    el.addEventListener('touchend', stop, { passive: false });
    el.addEventListener('mousedown', stop);
    return () => {
      el.removeEventListener('touchstart', stop);
      el.removeEventListener('touchmove', stop);
      el.removeEventListener('touchend', stop);
      el.removeEventListener('mousedown', stop);
    };
  }, []);

  // Fire the cancel action on touchend directly — synthetic click is
  // unreliable when the canvas's own touchend handler runs preventDefault.
  useEffect(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const onTouch = (e: TouchEvent) => {
      e.stopPropagation();
      e.preventDefault();
      onCancel();
    };
    btn.addEventListener('touchend', onTouch, { passive: false });
    return () => btn.removeEventListener('touchend', onTouch);
  }, [onCancel]);

  return (
    <div ref={containerRef} className="wire-mode-banner" style={{ touchAction: 'none' }}>
      <span>{message}</span>
      <button ref={buttonRef} type="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
};
