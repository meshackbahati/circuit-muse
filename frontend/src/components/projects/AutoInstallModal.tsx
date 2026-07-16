/**
 * Auto-install modal — downloads missing QEMU runtimes and cores.
 */

import { useState } from 'react';
import { autoInstallForBoard, type InstallProgress } from '../../services/componentInstaller';

interface AutoInstallModalProps {
  boardKind: string;
  onClose: () => void;
  onComplete: () => void;
}

const BOARD_LABELS: Record<string, string> = {
  'esp32': 'ESP32',
  'esp32-s3': 'ESP32-S3',
  'esp32-c3': 'ESP32-C3',
  'stm32-bluepill': 'STM32 Blue Pill',
  'stm32-nucleo': 'STM32 Nucleo',
};

export const AutoInstallModal: React.FC<AutoInstallModalProps> = ({
  boardKind,
  onClose,
  onComplete,
}) => {
  const [progress, setProgress] = useState<InstallProgress>({ phase: 'idle' });
  const [started, setStarted] = useState(false);

  const label = BOARD_LABELS[boardKind] ?? boardKind;

  const handleInstall = async () => {
    setStarted(true);
    setProgress({ phase: 'downloading', percent: 0 });

    await autoInstallForBoard(boardKind, setProgress);

    if (progress.phase === 'done' || progress.phase === 'error') {
      if (progress.phase === 'done') onComplete();
    }
  };

  return (
    <div className="install-overlay" onClick={onClose}>
      <div className="install-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Install {label} Support</h3>
        <p className="install-desc">
          {boardKind.startsWith('esp32') || boardKind === 'esp32-c3'
            ? `ESP32 boards need an additional QEMU runtime (~42 MB) for simulation.`
            : `STM32 boards need an additional QEMU runtime (~30 MB) for simulation.`}
        </p>

        {progress.phase !== 'idle' && progress.phase !== 'done' && (
          <div className="install-progress">
            <div className="install-progress-bar">
              <div
                className="install-progress-fill"
                style={{
                  width: progress.percent != null ? `${progress.percent}%` : '40%',
                  animation: progress.percent == null ? 'install-pulse 1.5s infinite' : undefined,
                }}
              />
            </div>
            <div className="install-progress-text">
              {progress.message ?? 'Downloading...'}
              {progress.percent != null ? ` (${progress.percent}%)` : ''}
            </div>
          </div>
        )}

        {progress.phase === 'error' && (
          <div className="install-error">{progress.error}</div>
        )}

        {progress.phase === 'done' && (
          <div className="install-success">Installation complete!</div>
        )}

        <div className="install-actions">
          <button className="install-btn" onClick={onClose} type="button">
            {progress.phase === 'done' ? 'Close' : 'Cancel'}
          </button>
          {!started && (
            <button className="install-btn install-btn-primary" onClick={handleInstall} type="button">
              Download & Install
            </button>
          )}
        </div>
      </div>

      <style>{`
        .install-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          z-index: 9500;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .install-modal {
          width: 400px;
          background: #1e1e23;
          border: 1px solid #2c2c33;
          border-radius: 8px;
          padding: 24px;
          color: #e6e6e9;
        }
        .install-modal h3 { margin: 0 0 8px; font-size: 18px; }
        .install-desc { color: #aaa; font-size: 13px; line-height: 1.5; margin: 0 0 16px; }
        .install-progress { margin-bottom: 16px; }
        .install-progress-bar {
          height: 6px;
          background: #0c0c11;
          border-radius: 3px;
          overflow: hidden;
          margin-bottom: 6px;
        }
        .install-progress-fill {
          height: 100%;
          background: #007acc;
          transition: width 0.2s ease;
        }
        @keyframes install-pulse {
          0%, 100% { width: 20%; }
          50% { width: 60%; }
        }
        .install-progress-text { font-size: 12px; color: #888; }
        .install-error {
          padding: 8px 12px;
          background: #3a1a1a;
          border: 1px solid #6a2a2a;
          color: #ff8585;
          border-radius: 4px;
          font-size: 13px;
          margin-bottom: 16px;
        }
        .install-success {
          padding: 8px 12px;
          background: #1a3a1a;
          border: 1px solid #2a6a2a;
          color: #85ff85;
          border-radius: 4px;
          font-size: 13px;
          margin-bottom: 16px;
        }
        .install-actions {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
        }
        .install-btn {
          padding: 8px 16px;
          border-radius: 4px;
          font-size: 13px;
          cursor: pointer;
          border: 1px solid #2c2c33;
          background: transparent;
          color: #e6e6e9;
        }
        .install-btn:hover { background: #2c2c33; }
        .install-btn-primary {
          background: #007acc;
          border-color: #007acc;
          color: white;
        }
        .install-btn-primary:hover { background: #005ea1; }
      `}</style>
    </div>
  );
};
