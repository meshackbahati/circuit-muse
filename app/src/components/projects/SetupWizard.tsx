/**
 * Setup wizard — first-run dependency check and installation guide.
 */

import { useState, useEffect } from 'react';
import { scanDependencies, type Dependency, autoInstallQemu } from '../../services/dependencyChecker';

interface SetupWizardProps {
  onClose: () => void;
}

export const SetupWizard: React.FC<SetupWizardProps> = ({ onClose }) => {
  const [deps, setDeps] = useState<Dependency[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState(0);

  useEffect(() => {
    scanDependencies().then((d) => {
      setDeps(d);
      setLoading(false);
    });
  }, []);

  const requiredMissing = deps.filter((d) => d.required && d.status === 'missing');
  const optionalMissing = deps.filter((d) => !d.required && d.status === 'missing');
  const allInstalled = requiredMissing.length === 0;

  const handleAutoInstall = async (dep: Dependency) => {
    setInstalling(dep.id);
    setInstallProgress(0);

    if (dep.id === 'qemu-esp32') {
      await autoInstallQemu('esp32', (pct) => setInstallProgress(pct));
    } else if (dep.id === 'qemu-stm32') {
      await autoInstallQemu('stm32', (pct) => setInstallProgress(pct));
    }

    // Re-scan
    const updated = await scanDependencies();
    setDeps(updated);
    setInstalling(null);
  };

  return (
    <div className="setup-overlay" onClick={onClose}>
      <div className="setup-modal" onClick={(e) => e.stopPropagation()}>
        <div className="setup-header">
          <h2>System Setup</h2>
          <button className="setup-close" onClick={onClose} type="button">{'\u2715'}</button>
        </div>

        {loading ? (
          <div className="setup-loading">Checking dependencies...</div>
        ) : (
          <div className="setup-body">
            {requiredMissing.length > 0 && (
              <div className="setup-section">
                <h3 className="setup-section-title setup-section-error">
                  Required — {requiredMissing.length} missing
                </h3>
                {requiredMissing.map((dep) => (
                  <div key={dep.id} className="setup-dep setup-dep-missing">
                    <div className="setup-dep-info">
                      <div className="setup-dep-name">{dep.name}</div>
                      <div className="setup-dep-desc">{dep.description}</div>
                      {dep.notes && <div className="setup-dep-notes">{dep.notes}</div>}
                    </div>
                    {dep.installUrl && (
                      <a
                        className="setup-dep-link"
                        href={dep.installUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Install Guide
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}

            {optionalMissing.length > 0 && (
              <div className="setup-section">
                <h3 className="setup-section-title">Optional — {optionalMissing.length} available</h3>
                {optionalMissing.map((dep) => (
                  <div key={dep.id} className="setup-dep setup-dep-optional">
                    <div className="setup-dep-info">
                      <div className="setup-dep-name">{dep.name}</div>
                      <div className="setup-dep-desc">{dep.description}</div>
                      {dep.notes && <div className="setup-dep-notes">{dep.notes}</div>}
                    </div>
                    {(dep.id === 'qemu-esp32' || dep.id === 'qemu-stm32') && installing === null && (
                      <button
                        className="setup-dep-install"
                        onClick={() => handleAutoInstall(dep)}
                        type="button"
                      >
                        Install
                      </button>
                    )}
                    {installing === dep.id && (
                      <div className="setup-dep-progress">
                        <div className="setup-dep-progress-bar">
                          <div style={{ width: `${installProgress}%` }} />
                        </div>
                        <span>{installProgress}%</span>
                      </div>
                    )}
                    {dep.installUrl && installing !== dep.id && (
                      <a
                        className="setup-dep-link"
                        href={dep.installUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Manual
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}

            {allInstalled && (
              <div className="setup-success">
                All required dependencies are installed. You're ready to go!
              </div>
            )}

            <div className="setup-actions">
              <button className="setup-btn" onClick={onClose} type="button">
                {allInstalled ? 'Start Building' : 'Continue Anyway'}
              </button>
              <button
                className="setup-btn setup-btn-secondary"
                onClick={async () => {
                  setLoading(true);
                  const updated = await scanDependencies();
                  setDeps(updated);
                  setLoading(false);
                }}
                type="button"
              >
                Re-scan
              </button>
              <button
                className="setup-btn setup-btn-secondary"
                onClick={() => {
                  localStorage.setItem('circuit-muse_setup_skipped', '1');
                  onClose();
                }}
                type="button"
              >
                Don't show again
              </button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .setup-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.7);
          z-index: 10001;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .setup-modal {
          width: 600px;
          max-height: 85vh;
          background: #1e1e23;
          border: 1px solid #2c2c33;
          border-radius: 10px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .setup-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px 22px;
          border-bottom: 1px solid #2c2c33;
        }
        .setup-header h2 { margin: 0; font-size: 20px; }
        .setup-close {
          background: transparent;
          border: none;
          color: #888;
          cursor: pointer;
          font-size: 18px;
        }
        .setup-close:hover { color: #e6e6e9; }
        .setup-loading {
          padding: 60px;
          text-align: center;
          color: #888;
        }
        .setup-body {
          flex: 1;
          overflow-y: auto;
          padding: 16px 22px;
        }
        .setup-section { margin-bottom: 20px; }
        .setup-section-title {
          font-size: 13px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #888;
          margin: 0 0 10px;
        }
        .setup-section-error { color: #ff6b6b; }
        .setup-dep {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          border: 1px solid #2c2c33;
          border-radius: 6px;
          margin-bottom: 8px;
        }
        .setup-dep-missing { border-color: #5c3333; background: rgba(220, 50, 50, 0.05); }
        .setup-dep-optional { border-color: #2c2c33; }
        .setup-dep-info { flex: 1; }
        .setup-dep-name { font-size: 14px; font-weight: 500; }
        .setup-dep-desc { font-size: 12px; color: #aaa; margin-top: 2px; }
        .setup-dep-notes { font-size: 11px; color: #666; margin-top: 4px; font-style: italic; }
        .setup-dep-link {
          font-size: 12px;
          color: #007acc;
          text-decoration: none;
          white-space: nowrap;
        }
        .setup-dep-link:hover { text-decoration: underline; }
        .setup-dep-install {
          padding: 6px 12px;
          background: #007acc;
          color: white;
          border: none;
          border-radius: 4px;
          font-size: 12px;
          cursor: pointer;
          white-space: nowrap;
        }
        .setup-dep-install:hover { background: #005ea1; }
        .setup-dep-progress {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: #888;
        }
        .setup-dep-progress-bar {
          width: 80px;
          height: 4px;
          background: #0c0c11;
          border-radius: 2px;
          overflow: hidden;
        }
        .setup-dep-progress-bar div {
          height: 100%;
          background: #007acc;
          transition: width 0.2s;
        }
        .setup-success {
          padding: 12px 16px;
          background: rgba(40, 180, 80, 0.1);
          border: 1px solid #2a6a2a;
          color: #66cc66;
          border-radius: 6px;
          font-size: 13px;
          margin-bottom: 16px;
        }
        .setup-actions {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
          padding-top: 12px;
          border-top: 1px solid #2c2c33;
        }
        .setup-btn {
          padding: 10px 20px;
          border-radius: 6px;
          font-size: 14px;
          cursor: pointer;
          border: none;
          font-weight: 500;
        }
        .setup-btn:first-child {
          background: #007acc;
          color: white;
        }
        .setup-btn:first-child:hover { background: #005ea1; }
        .setup-btn-secondary {
          background: transparent;
          color: #aaa;
          border: 1px solid #2c2c33;
        }
        .setup-btn-secondary:hover { background: #2c2c33; color: #e6e6e9; }
      `}</style>
    </div>
  );
};
