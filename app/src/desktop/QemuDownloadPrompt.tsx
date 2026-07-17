/**
 * Generic QEMU runtime download prompt (desktop / Tauri only).
 *
 * Watches the simulator for a board the given runtime handles,
 * and if the runtime isn't installed shows a download modal.
 */

import { useEffect, useState } from 'react';
import { useSimulatorStore } from '../store/useSimulatorStore';
import type { BoardKind } from '../types/board';
import { listen } from './tauriBridge';

export interface QemuRuntimeConfig {
  label: string;
  matchKind: (kind: BoardKind) => boolean;
  statusCmd: string;
  installCmd: string;
  progressEvent: string;
  sizeNote: string;
}

type QemuStatus = { installed: boolean; path?: string | null };
type ProgressPayload = {
  bytes_downloaded: number;
  total_bytes: number | null;
  phase: 'starting' | 'downloading' | 'installing' | 'extracting' | 'done';
};

type TauriInvoke = <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

function tauriInvoke(): TauriInvoke | null {
  const w = window as { __TAURI__?: { core?: { invoke?: TauriInvoke }; invoke?: TauriInvoke } };
  return w.__TAURI__?.core?.invoke ?? w.__TAURI__?.invoke ?? null;
}

export const QemuDownloadPrompt = ({ config }: { config: QemuRuntimeConfig }) => {
  const boards = useSimulatorStore((s) => s.boards);
  const hasBoard = boards.some((b) => config.matchKind(b.boardKind));
  const [status, setStatus] = useState<QemuStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<ProgressPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const invoke = tauriInvoke();
    if (!invoke) return;
    invoke<QemuStatus>(config.statusCmd).then(setStatus).catch(() => undefined);
  }, [config.statusCmd]);

  useEffect(() => {
    if (!hasBoard || !status || status.installed || dismissed) return;
    setOpen(true);
  }, [hasBoard, status, dismissed]);

  useEffect(() => {
    if (!installing) return;
    let dispose: (() => void) | null = null;
    listen<ProgressPayload>(config.progressEvent, (event) => {
      setProgress(event.payload);
    }).then((off) => {
      dispose = off;
    });
    return () => {
      if (dispose) dispose();
    };
  }, [installing, config.progressEvent]);

  if (!open) return null;

  const onInstall = async () => {
    setErr(null);
    setInstalling(true);
    setProgress({ bytes_downloaded: 0, total_bytes: null, phase: 'starting' });
    const invoke = tauriInvoke();
    if (!invoke) {
      setErr('Tauri runtime not available.');
      setInstalling(false);
      return;
    }
    try {
      await invoke(config.installCmd);
      const fresh = await invoke<QemuStatus>(config.statusCmd);
      setStatus(fresh);
      if (fresh.installed) setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(false);
      setProgress(null);
    }
  };

  const onSkip = () => {
    setDismissed(true);
    setOpen(false);
  };

  let pct = -1;
  if (progress?.total_bytes && progress.total_bytes > 0) {
    pct = Math.min(100, Math.round((progress.bytes_downloaded / progress.total_bytes) * 100));
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 9500,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: 440,
          background: '#1e1e23',
          color: '#e6e6e9',
          border: '1px solid #2c2c33',
          borderRadius: 8,
          padding: 24,
          boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
        }}
      >
        <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>
          {config.label} support not installed
        </h2>
        <p style={{ margin: '0 0 16px', color: '#aaa', lineHeight: 1.5 }}>
          {config.label} boards need an additional QEMU runtime ({config.sizeNote}).
          One-time download. You can keep using AVR and RP2040 boards without it.
        </p>
        {err && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: 4,
              background: '#3a1a1a',
              color: '#ff8585',
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            {err}
          </div>
        )}
        {installing && progress && (
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                height: 6,
                background: '#0c0c11',
                borderRadius: 3,
                overflow: 'hidden',
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: pct >= 0 ? `${pct}%` : '40%',
                  background: '#007acc',
                  transition: 'width 0.2s ease',
                  animation: pct < 0 ? 'cm-indeterminate 1.5s linear infinite' : undefined,
                }}
              />
            </div>
            <div style={{ fontSize: 12, color: '#888' }}>
              {progress.phase === 'extracting'
                ? 'Extracting...'
                : progress.phase === 'done'
                  ? 'Done'
                  : pct >= 0
                    ? `${pct}% (${(progress.bytes_downloaded / (1 << 20)).toFixed(1)} MB)`
                    : 'Downloading...'}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onSkip}
            disabled={installing}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              color: '#aaa',
              border: '1px solid #2c2c33',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Not now
          </button>
          <button
            type="button"
            onClick={onInstall}
            disabled={installing}
            style={{
              padding: '8px 16px',
              background: '#007acc',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: installing ? 'wait' : 'pointer',
              opacity: installing ? 0.7 : 1,
            }}
          >
            {installing ? 'Downloading...' : `Download ${config.label} support`}
          </button>
        </div>
      </div>
    </div>
  );
};
