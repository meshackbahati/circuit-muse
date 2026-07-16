/**
 * Zustand store for the editor's compile output.
 *
 * Lives outside <EditorPage> so other components (notably the velxio-pro
 * agent overlay, mounted into a different React tree via slotMounter) can
 * subscribe without prop-drilling.  The overlay reads `logs` to build a
 * "diagnose this compile failure with AI" prompt; without the store it
 * would have no way to reach the upstream component state.  Board target
 * is read from `useEditorStore` by the overlay independently.
 */

import { create } from 'zustand';

import type { CompilationLog } from '../utils/compilationLogger';

/** React-style setter — accepts either a new value OR an updater fn so
 *  callers that used `useState`'s `setX(prev => ...)` form can be
 *  swapped in without rewriting the call sites. */
type LogsSetter = (
  next: CompilationLog[] | ((prev: CompilationLog[]) => CompilationLog[]),
) => void;

interface CompileLogsState {
  logs: CompilationLog[];
  setLogs: LogsSetter;
  appendLogs: (logs: CompilationLog[]) => void;
  clear: () => void;
}

export const useCompileLogsStore = create<CompileLogsState>((set, get) => ({
  logs: [],
  setLogs: (next) => {
    if (typeof next === 'function') {
      set({ logs: (next as (prev: CompilationLog[]) => CompilationLog[])(get().logs) });
    } else {
      set({ logs: next });
    }
  },
  appendLogs: (entries) =>
    set((s) => ({ logs: [...s.logs, ...entries] })),
  clear: () => set({ logs: [] }),
}));
