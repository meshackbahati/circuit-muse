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

  // Desktop: only hide the header on the editor workspace pages,
  // but keep it on secondary pages like /examples and /docs so users can navigate back.
  if (isDesktop) {
    if (location.pathname === '/editor' || location.pathname === '/' || location.pathname === '/editor/') {
      return null;
    }
    // Beautiful, native-looking minimalist desktop navigation header for examples and docs
    const pageTitle = location.pathname.includes('/examples') ? 'Examples Gallery' : 'Documentation';
    return (
      <header className="desktop-app-header" style={{
        height: '42px',
        background: '#18181c',
        borderBottom: '1px solid #2d2d34',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        flexShrink: 0,
        userSelect: 'none',
      }}>
        <Link
          to={localize('/')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: '#a0a0a5',
            textDecoration: 'none',
            fontSize: '13px',
            fontWeight: 500,
            transition: 'color 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#ffffff')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#a0a0a5')}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          <span>Back to Workspace</span>
        </Link>
        <span style={{
          marginLeft: 'auto',
          marginRight: 'auto',
          color: '#ffffff',
          fontSize: '13px',
          fontWeight: 600,
          letterSpacing: '-0.1px',
        }}>
          {pageTitle}
        </span>
        {/* Placeholder spacer to center-align the page title perfectly */}
        <div style={{ width: '130px' }} />
      </header>
    );
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
