import { useCallback } from 'react';
import { invoke } from '../../desktop/tauriBridge';

const isDesktop = typeof window !== 'undefined' && !!(window as any).__TAURI__;

export const CustomTitleBar: React.FC = () => {
  const run = async (command: string, fallback?: () => void) => {
    try {
      await invoke(command);
    } catch (error) {
      console.warn(`[CustomTitleBar] ${command} failed`, error);
      fallback?.();
    }
  };

  const close = useCallback(() => run('plugin:window|close'), []);
  const minimize = useCallback(() => run('plugin:window|minimize'), []);
  const toggleMaximize = useCallback(() => run('plugin:window|toggle_maximize'), []);
  const drag = useCallback(() => run('plugin:window|startDragging'), []);

  // Hooks must run in the same order on every render. The web build still
  // mounts this component, so the early return has to come after the hooks.
  if (!isDesktop) return null;

  return (
    <div
      className="custom-titlebar"
      data-tauri-drag-region
      onClick={drag}
      onDoubleClick={toggleMaximize}
      title="Drag the title bar to move the window"
    >
      <span className="custom-titlebar-label">CircuitMuse</span>
      <div className="custom-titlebar-controls">
        <button
          type="button"
          className="custom-titlebar-btn"
          onClick={minimize}
          title="Minimize"
          aria-label="Minimize"
          onMouseDown={(event) => event.stopPropagation()}
        >
          {'\u2212'}
        </button>
        <button
          type="button"
          className="custom-titlebar-btn"
          onClick={toggleMaximize}
          title="Maximize or restore"
          aria-label="Maximize or restore"
          onMouseDown={(event) => event.stopPropagation()}
        >
          {'\u25A1'}
        </button>
        <button
          type="button"
          className="custom-titlebar-btn close"
          onClick={close}
          title="Close"
          aria-label="Close"
          onMouseDown={(event) => event.stopPropagation()}
        >
          ×
        </button>
      </div>
      <span className="custom-titlebar-drag-hint" />
    </div>
  );
};
