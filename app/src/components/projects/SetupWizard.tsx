/**
 * Setup wizard — first-run dependency check and installation guide.
 *
 * Lists every tool with its state, installs the runtimes the desktop app can
 * download by itself, and reports progress and failures inline. Errors used
 * to go through `alert()`, which the desktop WebView can swallow, so a failed
 * install looked like nothing had happened.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  scanDependencies,
  type Dependency,
  type QemuInstallProgress,
  autoInstallTool,
  canAutoInstall,
} from '../../services/dependencyChecker';
import { openExternal } from '../../desktop/tauriBridge';
import './SetupWizard.css';

interface SetupWizardProps {
  onClose: () => void;
}

function formatMb(bytes?: number): string {
  if (!bytes) return '0';
  return (bytes / (1024 * 1024)).toFixed(1);
}

function progressLabel(p: QemuInstallProgress | null): string {
  if (!p) return 'Starting…';
  switch (p.phase) {
    case 'downloading':
      return p.totalBytes
        ? `Downloading ${formatMb(p.bytesDownloaded)} of ${formatMb(p.totalBytes)} MB`
        : `Downloading ${formatMb(p.bytesDownloaded)} MB`;
    case 'extracting':
      return 'Unpacking…';
    case 'done':
      return 'Checking…';
    default:
      return 'Starting…';
  }
}

export const SetupWizard: React.FC<SetupWizardProps> = ({ onClose }) => {
  const [deps, setDeps] = useState<Dependency[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);
  const [progress, setProgress] = useState<QemuInstallProgress | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const rescan = useCallback(async () => {
    const updated = await scanDependencies();
    setDeps(updated);
    return updated;
  }, []);

  useEffect(() => {
    rescan().finally(() => setLoading(false));
  }, [rescan]);

  const required = deps.filter((d) => d.required);
  const optional = deps.filter((d) => !d.required);
  const requiredMissing = required.filter((d) => d.status === 'missing');
  const allRequiredReady = requiredMissing.length === 0;

  const handleInstall = async (dep: Dependency) => {
    setInstalling(dep.id);
    setProgress(null);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[dep.id];
      return next;
    });

    let failure: string | null = null;
    try {
      await autoInstallTool(dep.id, setProgress);
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }

    const updated = await rescan();
    const after = updated.find((d) => d.id === dep.id);
    if (!failure && after?.status !== 'installed') {
      failure = 'The download finished but the runtime was not found. Try again or install it manually.';
    }
    if (failure) {
      setErrors((prev) => ({ ...prev, [dep.id]: failure as string }));
    }
    setInstalling(null);
    setProgress(null);
  };

  const renderDep = (dep: Dependency) => {
    const isInstalling = installing === dep.id;
    const ready = dep.status === 'installed';
    const error = errors[dep.id];
    const stateLabel = isInstalling ? 'Installing' : ready ? 'Ready' : dep.required ? 'Missing' : 'Not installed';
    const stateClass = isInstalling ? 'busy' : ready ? 'ok' : dep.required ? 'bad' : 'off';

    return (
      <li key={dep.id} className={`setup-dep${error ? ' setup-dep--error' : ''}`}>
        <div className="setup-dep-main">
          <div className="setup-dep-title">
            <span className="setup-dep-name">{dep.name}</span>
            <span className={`setup-state setup-state--${stateClass}`}>{stateLabel}</span>
          </div>
          <div className="setup-dep-desc">{dep.description}</div>
          {!ready && dep.notes && !isInstalling && <div className="setup-dep-notes">{dep.notes}</div>}

          {isInstalling && (
            <div className="setup-progress" role="status" aria-live="polite">
              <div className="setup-progress-track">
                <div className="setup-progress-fill" style={{ width: `${progress?.progress ?? 0}%` }} />
              </div>
              <span className="setup-progress-label">{progressLabel(progress)}</span>
            </div>
          )}

          {error && (
            <div className="setup-dep-error" role="alert">
              {error}
            </div>
          )}
        </div>

        {!ready && !isInstalling && (
          <div className="setup-dep-actions">
            {canAutoInstall(dep.id) && (
              <button
                className="setup-btn setup-btn--primary setup-btn--small"
                onClick={() => handleInstall(dep)}
                disabled={installing !== null}
                type="button"
              >
                {error ? 'Retry' : 'Install'}
              </button>
            )}
            {dep.installUrl && (
              <button
                className="setup-link"
                onClick={() => openExternal(dep.installUrl!)}
                type="button"
              >
                Install guide
              </button>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="setup-overlay" onClick={installing ? undefined : onClose}>
      <div
        className="setup-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="setup-header">
          <div>
            <h2 id="setup-title">System setup</h2>
            <p className="setup-subtitle">Tools CircuitMuse uses to compile and simulate.</p>
          </div>
          <button className="setup-close" onClick={onClose} type="button" aria-label="Close">
            {'✕'}
          </button>
        </div>

        {loading ? (
          <div className="setup-loading">Checking your system…</div>
        ) : (
          <>
            <div className="setup-body">
              <div className={`setup-summary${allRequiredReady ? ' setup-summary--ok' : ''}`}>
                {allRequiredReady
                  ? 'Everything required is ready. Optional runtimes add more boards.'
                  : `${requiredMissing.length} required ${requiredMissing.length === 1 ? 'tool is' : 'tools are'} missing.`}
              </div>

              {required.length > 0 && (
                <section className="setup-section">
                  <h3 className="setup-section-title">Required</h3>
                  <ul className="setup-list">{required.map(renderDep)}</ul>
                </section>
              )}

              {optional.length > 0 && (
                <section className="setup-section">
                  <h3 className="setup-section-title">Optional</h3>
                  <ul className="setup-list">{optional.map(renderDep)}</ul>
                </section>
              )}
            </div>

            <div className="setup-actions">
              <button
                className="setup-btn setup-btn--ghost"
                onClick={() => {
                  try {
                    localStorage.setItem('circuit-muse_setup_skipped', '1');
                  } catch {
                    // Storage can be unavailable; closing is still fine.
                  }
                  onClose();
                }}
                type="button"
              >
                Don&apos;t show again
              </button>
              <div className="setup-actions-right">
                <button
                  className="setup-btn setup-btn--secondary"
                  onClick={async () => {
                    setLoading(true);
                    await rescan();
                    setLoading(false);
                  }}
                  disabled={installing !== null}
                  type="button"
                >
                  Check again
                </button>
                <button className="setup-btn setup-btn--primary" onClick={onClose} type="button">
                  {allRequiredReady ? 'Start building' : 'Continue anyway'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
