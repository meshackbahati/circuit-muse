import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../../store/useProjectStore';
import { ShareModal } from './ShareModal';
import { useLocalizedHref, useCurrentLocale } from '../../i18n/useLocalizedNavigate';
import type { AutoSaveState } from '../../hooks/useAutoSaveProject';
import './LanguageSwitcher.css';

const GITHUB_URL = 'https://github.com/meshackbahati/circuit-muse';

interface AppHeaderProps {
  autoSave?: AutoSaveState;
}

const SAVE_STATUS_COPY: Record<AutoSaveState['status'], { label: string; color: string }> = {
  idle: { label: 'Saved', color: '#7d8590' },
  dirty: { label: 'Unsaved changes', color: '#f0883e' },
  saving: { label: 'Saving...', color: '#3fb950' },
  saved: { label: 'Saved', color: '#3fb950' },
  error: { label: 'Save failed', color: '#f85149' },
};

const AutoSaveIndicator: React.FC<{ state: AutoSaveState }> = ({ state }) => {
  const meta = SAVE_STATUS_COPY[state.status];
  const tip =
    state.status === 'error' && state.errorMessage
      ? `Auto-save failed: ${state.errorMessage}`
      : state.lastSavedAt
        ? `Last saved ${new Date(state.lastSavedAt).toLocaleTimeString()}`
        : 'Auto-save ready';
  return (
    <div title={tip} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', fontSize: 12, color: meta.color, userSelect: 'none' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: meta.color, opacity: state.status === 'saving' ? 0.7 : 1 }} />
      <span>{meta.label}</span>
    </div>
  );
};

// Detect Tauri at runtime — no build-time flag needed
const isDesktop = typeof window !== 'undefined' && !!(window as any).__TAURI__;

export const AppHeader: React.FC<AppHeaderProps> = ({ autoSave }) => {
  const location = useLocation();
  const currentProject = useProjectStore((s) => s.currentProject);
  const [showShareModal, setShowShareModal] = useState(false);
  const { t } = useTranslation();
  const localize = useLocalizedHref();

  // Desktop: no header — native menubar handles everything
  if (isDesktop) {
    return null;
  }

  return (
    <header className="app-header">
      <div className="header-content">
        <div className="header-left">
          <div className="header-brand">
            <Link to={localize('/')} style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className="header-title">CircuitMuse</span>
            </Link>
          </div>
          <nav className="header-nav-links">
            <Link to={localize('/')} className="header-nav-link">Home</Link>
            <Link to={localize('/editor')} className="header-nav-link">Editor</Link>
            <Link to={localize('/examples')} className="header-nav-link">Examples</Link>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="header-nav-link">GitHub</a>
          </nav>
        </div>

        <div className="header-right">
          {autoSave && currentProject && <AutoSaveIndicator state={autoSave} />}
          {currentProject && location.pathname === '/editor' && (
            <button
              onClick={() => setShowShareModal(true)}
              style={{ background: 'transparent', border: '1px solid #555', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, color: '#ccc', fontSize: 13 }}
              title="Share project"
            >
              Share
            </button>
          )}
        </div>
      </div>
      {showShareModal && <ShareModal onClose={() => setShowShareModal(false)} />}
    </header>
  );
};
