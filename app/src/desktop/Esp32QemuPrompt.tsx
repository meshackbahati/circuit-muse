/**
 * ESP32 QEMU download prompt.
 *
 * Active only in the Tauri desktop build. Watches for ESP32 boards;
 * if QEMU isn't installed, shows a download dialog.
 */

import { useEffect, useState } from 'react';
import { useSimulatorStore } from '../store/useSimulatorStore';
import type { BoardKind } from '../types/board';
import { isTauri, listen } from './tauriBridge';

const ESP32_KINDS: BoardKind[] = ['esp32', 'esp32-s3', 'esp32-c3'];

type QemuStatus = { installed: boolean; path?: string | null };

type ProgressPayload = {
  bytes_downloaded: number;
  total_bytes: number | null;
  phase: 'starting' | 'downloading' | 'extracting' | 'done';
};

type TauriInvoke = <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

function tauriInvoke(): TauriInvoke | null {
  const w = window as { __TAURI__?: { core?: { invoke?: TauriInvoke }; invoke?: TauriInvoke } };
  return w.__TAURI__?.core?.invoke ?? w.__TAURI__?.invoke ?? null;
}

export const Esp32QemuPrompt = () => {
  const boards = useSimulatorStore((s) => s.boards);
  const hasEsp32 = boards.some((b) => ESP32_KINDS.includes(b.boardKind));
  const [status, setStatus] = useState<QemuStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<ProgressPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const invoke = tauriInvoke();
    if (!invoke) return;
    invoke<QemuStatus>('esp32_qemu_status').then(setStatus).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!hasEsp32 || !status || status.installed || dismissed) return;
    setOpen(true);
  }, [hasEsp32, status, dismissed]);

  useEffect(() => {
    if (!installing) return;
    let dispose: (() => void) | null = null;
    listen<ProgressPayload>('esp32-qemu-progress', (event) => {
      setProgress(event.payload);
    }).then((off) => {
      dispose = off;
    });
    return () => {
      if (dispose) dispose();
    };
  }, [installing]);

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
      await invoke('esp32_qemu_install');
      const fresh = await invoke<QemuStatus>('esp32_qemu_status');
      setStatus(fresh);
      if (fresh.installed) setOpen(false);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setErr(raw);
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
          ESP32 support not installed
        </h2>
        <p style={{ margin: '0 0 16px', color: '#aaa', lineHeight: 1.5 }}>
          ESP32 boards need an additional QEMU runtime (~42 MB). One-time download.
          You can keep using AVR and RP2040 boards without it.
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
            {installing ? 'Downloading...' : 'Download ESP32 support'}
          </button>
        </div>
      </div>
    </div>
  );
};
