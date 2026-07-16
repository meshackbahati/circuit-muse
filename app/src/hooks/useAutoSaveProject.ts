/**
 * Auto-save hook — skeleton.
 *
 * The actual save logic (debouncing, dirty detection, owner eligibility,
 * PUT to /api/projects/{id}) is supplied by an installed implementation.
 * OSS without an overlay registers no implementation, and the hook stays
 * idle forever — exactly the behavior we want once project persistence
 * moves to the private overlay (Phase 3 of the OSS split).
 *
 * The skeleton always runs the same useState + useEffect, so registering
 * an implementation later cannot change the hook count and break React.
 * Implementations are expected to be installed once at module load via
 * installAutoSaveImpl() — see ./autoSaveImpl.ts for the default wiring.
 */

import { useEffect, useState } from 'react';

export type AutoSaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface AutoSaveState {
  status: AutoSaveStatus;
  lastSavedAt: number | null;
  errorMessage: string | null;
}

/** Implementation contract: receive a setter, return an unsubscribe. */
export type AutoSaveImpl = (emit: (state: AutoSaveState) => void) => () => void;

const IDLE: AutoSaveState = { status: 'idle', lastSavedAt: null, errorMessage: null };

let installedImpl: AutoSaveImpl | null = null;

export function installAutoSaveImpl(impl: AutoSaveImpl | null): void {
  installedImpl = impl;
}

export function useAutoSaveProject(): AutoSaveState {
  const [state, setState] = useState<AutoSaveState>(IDLE);

  useEffect(() => {
    if (!installedImpl) return;
    return installedImpl(setState);
    // Mount-only — impl is installed at module load, swapping at runtime is unsupported.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
