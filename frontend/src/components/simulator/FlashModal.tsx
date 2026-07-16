/**
 * FlashModal — hardware flash UI for a single board on the canvas.
 *
 * Opened from the board context menu's "Flash to real board" item.
 * Walks the user through:
 *   1. Picking a USB serial port (auto-enumerated)
 *   2. Triggering the flash (streams arduino-cli output live)
 *   3. Showing success / error with the option to retry
 *
 * Pure desktop concern: web has no access to local serial ports
 * without WebSerial which is a separate sprint. The board context
 * menu hides the entry entirely in web builds; if the modal IS
 * mounted in web (defensive), it shows a "requires Velxio Desktop"
 * fallback.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardInstance } from '../../store/useSimulatorStore';
import { isTauri, listSerialPorts, type SerialPortInfo } from '../../desktop/tauriBridge';
import { streamFlash, type FlashEvent } from '../../services/flashService';

interface Props {
  board: BoardInstance;
  fqbn: string;
  onClose: () => void;
}

type ModalState =
  | { kind: 'loading-ports' }
  | { kind: 'picking'; ports: SerialPortInfo[]; selectedPath: string | null }
  | { kind: 'flashing'; port: string; log: string[]; progress: number }
  | { kind: 'success'; port: string; elapsedMs: number; log: string[] }
  | { kind: 'error'; port: string | null; message: string; log: string[] };

export const FlashModal = ({ board, fqbn, onClose }: Props) => {
  const [state, setState] = useState<ModalState>({ kind: 'loading-ports' });
  // Keep the latest log in a ref so the flash generator's setState
  // calls aren't accumulating stale array copies.
  const logRef = useRef<string[]>([]);

  // ── Initial port enumeration ─────────────────────────────────────
  useEffect(() => {
    if (!isTauri()) {
      setState({
        kind: 'error',
        port: null,
        message:
          'Hardware flashing requires Velxio Desktop. The web app cannot ' +
          'access local USB serial ports.',
        log: [],
      });
      return;
    }
    let cancelled = false;
    void (async () => {
      const ports = await listSerialPorts();
      if (cancelled) return;
      setState({
        kind: 'picking',
        ports,
        selectedPath: ports[0]?.path ?? null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshPorts = useCallback(async () => {
    setState({ kind: 'loading-ports' });
    const ports = await listSerialPorts();
    setState({
      kind: 'picking',
      ports,
      selectedPath: ports[0]?.path ?? null,
    });
  }, []);

  // ── Trigger the flash ────────────────────────────────────────────
  const doFlash = useCallback(
    async (port: string) => {
      if (!board.compiledProgram) {
        setState({
          kind: 'error',
          port,
          message:
            'No compiled program for this board. Compile the sketch first ' +
            '(Compile button in the toolbar).',
          log: [],
        });
        return;
      }
      logRef.current = [];
      setState({ kind: 'flashing', port, log: [], progress: 0 });

      const fmt = formatForFqbn(fqbn);
      try {
        for await (const ev of streamFlash({
          boardId: board.id,
          port,
          fqbn,
          programFormat: fmt,
          programData: board.compiledProgram,
        })) {
          if (ev.phase === 'done') {
            if (ev.success) {
              setState({
                kind: 'success',
                port,
                elapsedMs: ev.elapsed_ms,
                log: [...logRef.current],
              });
            } else {
              setState({
                kind: 'error',
                port,
                message: ev.error,
                log: [...logRef.current],
              });
            }
            return;
          }
          if ('line' in ev) {
            logRef.current = [...logRef.current, ev.line];
          }
          setState((prev) => {
            if (prev.kind !== 'flashing') return prev;
            return {
              ...prev,
              log: logRef.current,
              progress: ev.phase === 'writing' && ev.progress !== undefined
                ? ev.progress
                : prev.progress,
            };
          });
        }
      } catch (err) {
        setState({
          kind: 'error',
          port,
          message: err instanceof Error ? err.message : String(err),
          log: [...logRef.current],
        });
      }
    },
    [board.compiledProgram, board.id, fqbn],
  );

  // ── Render ──────────────────────────────────────────────────────
  const boardLabel = board.boardKind;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        zIndex: 9600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: 560,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 64px)',
          background: '#1a1d24',
          color: '#e6e6e9',
          border: '1px solid #2c2c33',
          borderRadius: 8,
          padding: 20,
          boxShadow: '0 12px 36px rgba(0,0,0,0.7)',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            Flash {boardLabel}
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={closeBtnStyle}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {state.kind === 'loading-ports' && (
          <div style={{ padding: '24px 0', textAlign: 'center', color: '#888' }}>
            Detecting USB serial ports...
          </div>
        )}

        {state.kind === 'picking' && (
          <PickerView
            board={board}
            ports={state.ports}
            selected={state.selectedPath}
            onSelect={(p) => setState({ ...state, selectedPath: p })}
            onRefresh={() => void refreshPorts()}
            onFlash={(p) => void doFlash(p)}
          />
        )}

        {(state.kind === 'flashing' ||
          state.kind === 'success' ||
          state.kind === 'error') && (
          <ProgressView
            state={state}
            onRetry={() => state.port && void doFlash(state.port)}
            onClose={onClose}
            onBackToPicker={() => void refreshPorts()}
          />
        )}
      </div>
    </div>
  );
};

// ── Picker subview ──────────────────────────────────────────────────

interface PickerProps {
  board: BoardInstance;
  ports: SerialPortInfo[];
  selected: string | null;
  onSelect: (path: string) => void;
  onRefresh: () => void;
  onFlash: (path: string) => void;
}

const PickerView = ({ board, ports, selected, onSelect, onRefresh, onFlash }: PickerProps) => {
  const hasCompiled = !!board.compiledProgram;

  if (ports.length === 0) {
    return (
      <div>
        <div style={{ padding: 16, background: '#0c0c11', borderRadius: 4, marginBottom: 12 }}>
          <div style={{ color: '#aaa', fontSize: 13, marginBottom: 8 }}>
            No USB serial ports detected.
          </div>
          <div style={{ color: '#777', fontSize: 12, lineHeight: 1.5 }}>
            Plug your board into a USB port and click Refresh. On Linux,
            you may need to add yourself to the dialout group:
            <pre style={{ marginTop: 6, fontSize: 11 }}>
              sudo usermod -a -G dialout $USER
            </pre>
            (log out + back in after running.)
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onRefresh} style={primaryBtnStyle}>
            Refresh
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: '#aaa' }}>
        Serial port
      </label>
      <select
        value={selected ?? ''}
        onChange={(e) => onSelect(e.target.value)}
        style={selectStyle}
      >
        {ports.map((p) => (
          <option key={p.path} value={p.path}>
            {portLabel(p)}
          </option>
        ))}
      </select>

      {!hasCompiled && (
        <div style={{ marginTop: 10, padding: 10, background: '#3a2e1a', color: '#ffb84d', borderRadius: 4, fontSize: 12 }}>
          No compiled program for this board yet. Click Compile in the toolbar first.
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
        <button type="button" onClick={onRefresh} style={secondaryBtnStyle}>
          Refresh ports
        </button>
        <button
          type="button"
          disabled={!selected || !hasCompiled}
          onClick={() => selected && onFlash(selected)}
          style={{ ...primaryBtnStyle, opacity: !selected || !hasCompiled ? 0.5 : 1 }}
        >
          Flash
        </button>
      </div>
    </div>
  );
};

// ── Progress / success / error subview ──────────────────────────────

interface ProgressProps {
  state:
    | { kind: 'flashing'; port: string; log: string[]; progress: number }
    | { kind: 'success'; port: string; elapsedMs: number; log: string[] }
    | { kind: 'error'; port: string | null; message: string; log: string[] };
  onRetry: () => void;
  onClose: () => void;
  onBackToPicker: () => void;
}

const ProgressView = ({ state, onRetry, onClose, onBackToPicker }: ProgressProps) => {
  const logRef = useRef<HTMLPreElement | null>(null);
  // Auto-scroll the log to the bottom as new lines come in.
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [state.log]);

  return (
    <div>
      {state.kind === 'flashing' && (
        <>
          <div style={{ fontSize: 13, color: '#ccc', marginBottom: 8 }}>
            Flashing on {state.port}...
          </div>
          <div style={{ height: 6, background: '#0c0c11', borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
            <div
              style={{
                height: '100%',
                width: `${Math.round(state.progress * 100)}%`,
                background: 'linear-gradient(90deg, #007acc 0%, #00a4ff 100%)',
                transition: 'width 0.2s ease',
              }}
            />
          </div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 12 }}>
            {Math.round(state.progress * 100)}%
          </div>
        </>
      )}

      {state.kind === 'success' && (
        <div style={{ padding: 12, background: '#143824', color: '#7ee87e', borderRadius: 4, marginBottom: 12, fontSize: 13 }}>
          ✓ Flashed successfully in {(state.elapsedMs / 1000).toFixed(1)}s
        </div>
      )}

      {state.kind === 'error' && (
        <div style={{ padding: 12, background: '#3a1a1a', color: '#ff8585', borderRadius: 4, marginBottom: 12, fontSize: 13 }}>
          {state.message}
        </div>
      )}

      <pre
        ref={logRef}
        style={{
          height: 240,
          margin: 0,
          padding: 10,
          background: '#0c0c11',
          color: '#9aa5b1',
          borderRadius: 4,
          fontSize: 11,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          overflowY: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {state.log.join('\n') || '(no output yet)'}
      </pre>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
        {state.kind === 'flashing' ? (
          <span style={{ fontSize: 11, color: '#666' }}>
            Don't unplug the board while flashing.
          </span>
        ) : (
          <button type="button" onClick={onBackToPicker} style={secondaryBtnStyle}>
            Pick another port
          </button>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          {state.kind === 'error' && (
            <button type="button" onClick={onRetry} style={primaryBtnStyle}>
              Retry
            </button>
          )}
          <button type="button" onClick={onClose} style={secondaryBtnStyle}>
            {state.kind === 'flashing' ? 'Hide' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Helpers + shared styles ─────────────────────────────────────────

function portLabel(p: SerialPortInfo): string {
  const parts: string[] = [p.path];
  if (p.product || p.manufacturer) {
    parts.push('-', p.product ?? p.manufacturer ?? '');
  }
  if (p.vid !== undefined && p.vid !== null && p.pid !== undefined && p.pid !== null) {
    parts.push(`(${hex4(p.vid)}:${hex4(p.pid)})`);
  }
  return parts.join(' ');
}

function hex4(n: number): string {
  return n.toString(16).padStart(4, '0');
}

/**
 * Decide the program file extension based on the FQBN. Mirrors the
 * formats arduino-cli expects per uploader (avrdude wants .hex,
 * esptool wants .bin, picotool accepts either .uf2 or .bin).
 */
function formatForFqbn(fqbn: string): 'hex' | 'bin' | 'uf2' | 'elf' {
  if (fqbn.startsWith('arduino:avr') || fqbn.startsWith('ATTinyCore:avr')) {
    return 'hex';
  }
  if (fqbn.startsWith('esp32:esp32')) return 'bin';
  if (fqbn.startsWith('rp2040:rp2040')) return 'uf2';
  if (fqbn.startsWith('arduino:samd')) return 'bin';
  // Defensive fallback - arduino-cli's auto-detection should still
  // do the right thing in most cases.
  return 'bin';
}

const closeBtnStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  padding: 0,
  background: 'transparent',
  border: '1px solid #2c2c33',
  borderRadius: 4,
  color: '#999',
  fontSize: 18,
  cursor: 'pointer',
  lineHeight: 1,
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '7px 16px',
  fontSize: 13,
  fontWeight: 600,
  color: 'white',
  background: 'linear-gradient(135deg, #007acc 0%, #005ea1 100%)',
  border: '1px solid #005ea1',
  borderRadius: 4,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: '7px 14px',
  fontSize: 13,
  color: '#bbb',
  background: 'transparent',
  border: '1px solid #2c2c33',
  borderRadius: 4,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: '#0c0c11',
  color: '#e6e6e9',
  border: '1px solid #2c2c33',
  borderRadius: 4,
  fontSize: 13,
  fontFamily: 'inherit',
};
