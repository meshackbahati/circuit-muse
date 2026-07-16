/**
 * useElectricalStore — Zustand slice for the WASM-ngspice mixed-mode
 * simulator's published results.
 *
 * SPICE runs through `CircuitSimulationService` (see
 * `simulation/spice/CircuitSimulationService.ts`).  The service calls
 * `setSolveResult()` after each solve to publish an atomic snapshot
 * into this store, which the 12 downstream consumers (LED handler,
 * Voltmeter, Ammeter, AnalogOverlay, ADC bridge, etc.) read.
 *
 * The store no longer owns the solver — it's a pure state container.
 * Pause is a UI control that stops re-solves on switch / property
 * changes (the engine still holds the last result so LEDs stay lit).
 */
import { create } from 'zustand';
import type { TimeWaveforms } from '../simulation/spice/types';

export interface ElectricalSnapshot {
  nodeVoltages: Record<string, number>;
  branchCurrents: Record<string, number>;
  pinNetMap: Map<string, string>;
  analysisMode: 'op' | 'tran' | 'ac';
  timeWaveforms?: TimeWaveforms;
  converged: boolean;
  error: string | null;
  lastSolveMs: number;
  submittedNetlist: string;
}

interface ElectricalState extends ElectricalSnapshot {
  /**
   * When true, the service skips re-solves on canvas changes — the
   * last snapshot stays live so LEDs hold their value, but switch
   * toggles don't propagate.  Used by the editor's Run / Stop UI.
   */
  paused: boolean;
  setPaused: (paused: boolean) => void;
  /** Atomic publish of a fresh solve snapshot (called by the service). */
  setSolveResult: (snapshot: ElectricalSnapshot) => void;
  /** Wipe everything — used when loading a new project. */
  reset: () => void;
}

const EMPTY: ElectricalSnapshot = {
  nodeVoltages: {},
  branchCurrents: {},
  pinNetMap: new Map(),
  analysisMode: 'op',
  timeWaveforms: undefined,
  converged: true,
  error: null,
  lastSolveMs: 0,
  submittedNetlist: '',
};

export const useElectricalStore = create<ElectricalState>((set) => ({
  ...EMPTY,
  paused: false,
  setPaused(paused) {
    set({ paused });
  },
  setSolveResult(snapshot) {
    set({ ...snapshot });
  },
  reset() {
    set({ ...EMPTY });
  },
}));
