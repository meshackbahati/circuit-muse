/**
 * GitHub Sync Modal — connects to GitHub via PAT and syncs project files.
 */

import { useState, useEffect } from 'react';
import { useEditorStore } from '../../store/useEditorStore';
import { useProjectStore } from '../../store/useProjectStore';

interface GitHubSyncModalProps {
  onClose: () => void;
}

export const GitHubSyncModal: React.FC<GitHubSyncModalProps> = ({ onClose }) => {
  const [token, setToken] = useState(() => localStorage.getItem('circuit-muse_github_token') || '');
  const [repo, setRepo] = useState(() => localStorage.getItem('circuit-muse_github_repo') || '');
  const [branch, setBranch] = useState(() => localStorage.getItem('circuit-muse_github_branch') || 'main');
  const [commitMsg, setCommitMsg] = useState('Sync from CircuitMuse');
  const [status, setStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error'; text: string }>({
    type: 'idle',
    text: '',
  });

  const files = useEditorStore((s) => s.files);
  const currentProject = useProjectStore((s) => s.currentProject);

  const handleSync = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim() || !repo.trim() || !branch.trim()) {
      setStatus({ type: 'error', text: 'Please fill in all required fields.' });
      return;
    }

    setStatus({ type: 'loading', text: 'Connecting to GitHub and syncing files...' });

    // Save configurations
    localStorage.setItem('circuit-muse_github_token', token.trim());
    localStorage.setItem('circuit-muse_github_repo', repo.trim());
    localStorage.setItem('circuit-muse_github_branch', branch.trim());

    try {
      const headers = {
        Authorization: `token ${token.trim()}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      };

      // 1. Get the reference of the branch
      const refUrl = `https://api.github.com/repos/${repo.trim()}/git/refs/heads/${branch.trim()}`;
      const refResp = await fetch(refUrl, { headers });

      if (refResp.status === 404) {
        throw new Error('Repository or branch not found. Check repository path and branch name.');
      }
      if (!refResp.ok) {
        const errObj = await refResp.json().catch(() => ({}));
        throw new Error(errObj.message || 'Failed to authenticate or fetch branch reference.');
      }

      const refData = await refResp.json();
      const lastCommitSha = refData.object.sha;

      // 2. Get the commit info to find the tree SHA
      const commitResp = await fetch(`https://api.github.com/repos/${repo.trim()}/git/commits/${lastCommitSha}`, {
        headers,
      });
      const commitData = await commitResp.json();
      const baseTreeSha = commitData.tree.sha;

      // 3. Create tree with the current workspace files
      const treeItems = files.map((file) => ({
        path: file.name,
        mode: '100644',
        type: 'blob',
        content: file.content,
      }));

      const treeResp = await fetch(`https://api.github.com/repos/${repo.trim()}/git/trees`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: treeItems,
        }),
      });

      if (!treeResp.ok) {
        throw new Error('Failed to create Git tree on GitHub.');
      }
      const treeData = await treeResp.json();
      const newTreeSha = treeData.sha;

      // 4. Create a new commit
      const newCommitResp = await fetch(`https://api.github.com/repos/${repo.trim()}/git/commits`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: commitMsg || 'Sync from CircuitMuse',
          tree: newTreeSha,
          parents: [lastCommitSha],
        }),
      });

      if (!newCommitResp.ok) {
        throw new Error('Failed to create commit.');
      }
      const newCommitData = await newCommitResp.json();
      const newCommitSha = newCommitData.sha;

      // 5. Update branch reference to the new commit
      const updateRefResp = await fetch(refUrl, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          sha: newCommitSha,
          force: false,
        }),
      });

      if (!updateRefResp.ok) {
        throw new Error('Failed to update branch reference.');
      }

      setStatus({
        type: 'success',
        text: `Successfully synced ${files.length} file(s) to GitHub branch "${branch.trim()}"!`,
      });
    } catch (err: any) {
      setStatus({
        type: 'error',
        text: err?.message || 'An unexpected error occurred during sync.',
      });
    }
  };

  const handleDisconnect = () => {
    if (!confirm('Clear your GitHub credentials from local storage?')) return;
    localStorage.removeItem('circuit-muse_github_token');
    localStorage.removeItem('circuit-muse_github_repo');
    localStorage.removeItem('circuit-muse_github_branch');
    setToken('');
    setRepo('');
    setBranch('main');
    setStatus({ type: 'idle', text: '' });
  };

  return (
    <div className="gh-sync-overlay" onClick={onClose}>
      <div className="gh-sync-modal" onClick={(e) => e.stopPropagation()}>
        <div className="gh-sync-header">
          <div className="gh-sync-title-group">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 8, color: '#f0f6fc' }}>
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.05-.02-2.06-3.34.72-4.04-1.61-4.04-1.61-.55-1.38-1.33-1.75-1.33-1.75-1.09-.74.08-.72.08-.72 1.2.08 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.62-2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.11-3.18 0 0 1.01-.32 3.3 1.23A11.5 11.5 0 0 1 12 5.8c1.02.01 2.05.14 3.01.4 2.29-1.55 3.3-1.23 3.3-1.23.65 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.62-5.49 5.92.43.37.82 1.1.82 2.22 0 1.6-.02 2.89-.02 3.29 0 .32.22.7.83.58A12 12 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
            <h2>Sync to GitHub</h2>
          </div>
          <button className="gh-sync-close" onClick={onClose} type="button">
            {'\u2715'}
          </button>
        </div>

        <form className="gh-sync-form" onSubmit={handleSync}>
          <div className="gh-sync-field">
            <label htmlFor="token">
              GitHub Personal Access Token (PAT) <span style={{ color: '#da3633' }}>*</span>
            </label>
            <input
              id="token"
              type="password"
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxx"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
            <p className="gh-sync-hint">
              Requires a token with <code style={{ color: '#007acc' }}>repo</code> scope. Generate one under GitHub Settings &gt; Developer settings &gt; Personal access tokens.
            </p>
          </div>

          <div className="gh-sync-field">
            <label htmlFor="repo">
              Repository Name (owner/repo) <span style={{ color: '#da3633' }}>*</span>
            </label>
            <input
              id="repo"
              type="text"
              placeholder="e.g. meshackbahati/circuit-projects"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              required
            />
          </div>

          <div className="gh-sync-field">
            <label htmlFor="branch">
              Branch Name <span style={{ color: '#da3633' }}>*</span>
            </label>
            <input
              id="branch"
              type="text"
              placeholder="main"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              required
            />
          </div>

          <div className="gh-sync-field">
            <label htmlFor="commitMsg">Commit Message</label>
            <input
              id="commitMsg"
              type="text"
              placeholder="Sync from CircuitMuse"
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
            />
          </div>

          <div className="gh-sync-files-preview">
            <div className="gh-sync-files-header">Files to commit:</div>
            <div className="gh-sync-files-list">
              {files.map((f) => (
                <div key={f.name} className="gh-sync-file-item">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  {f.name}
                </div>
              ))}
            </div>
          </div>

          {status.text && (
            <div className={`gh-sync-status gh-sync-status-${status.type}`}>
              {status.type === 'loading' && (
                <svg className="gh-sync-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 8 }}>
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              )}
              {status.text}
            </div>
          )}

          <div className="gh-sync-actions">
            {token && (
              <button className="gh-sync-btn gh-sync-btn-danger" onClick={handleDisconnect} type="button">
                Clear Credentials
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button className="gh-sync-btn" onClick={onClose} type="button">
              Cancel
            </button>
            <button className="gh-sync-btn gh-sync-btn-primary" type="submit" disabled={status.type === 'loading'}>
              {status.type === 'loading' ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>
        </form>
      </div>

      <style>{`
        .gh-sync-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          z-index: 10000;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #e6e6e9;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .gh-sync-modal {
          width: 520px;
          background: #1e1e23;
          border: 1px solid #2c2c33;
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
        }
        .gh-sync-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid #2c2c33;
        }
        .gh-sync-title-group {
          display: flex;
          align-items: center;
        }
        .gh-sync-header h2 { margin: 0; font-size: 16px; font-weight: 600; }
        .gh-sync-close {
          background: transparent;
          border: none;
          color: #888;
          cursor: pointer;
          font-size: 18px;
        }
        .gh-sync-close:hover { color: #e6e6e9; }
        .gh-sync-form {
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .gh-sync-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .gh-sync-field label {
          font-size: 13px;
          font-weight: 500;
          color: #c9d1d9;
        }
        .gh-sync-field input {
          background: #0d1117;
          border: 1px solid #30363d;
          border-radius: 4px;
          padding: 8px 12px;
          color: #c9d1d9;
          font-size: 13px;
          outline: none;
        }
        .gh-sync-field input:focus {
          border-color: #58a6ff;
          box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.15);
        }
        .gh-sync-hint {
          font-size: 11px;
          color: #8b949e;
          margin: 0;
          line-height: 1.4;
        }
        .gh-sync-files-preview {
          background: #0d1117;
          border: 1px solid #30363d;
          border-radius: 4px;
          padding: 10px 12px;
        }
        .gh-sync-files-header {
          font-size: 12px;
          font-weight: 500;
          color: #8b949e;
          margin-bottom: 6px;
        }
        .gh-sync-files-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          max-height: 80px;
          overflow-y: auto;
        }
        .gh-sync-file-item {
          display: flex;
          align-items: center;
          font-size: 11px;
          background: #21262d;
          border: 1px solid #30363d;
          border-radius: 3px;
          padding: 3px 6px;
          color: #c9d1d9;
        }
        .gh-sync-status {
          font-size: 13px;
          padding: 10px 12px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          line-height: 1.4;
        }
        .gh-sync-status-loading {
          background: rgba(88, 166, 255, 0.1);
          border: 1px solid rgba(88, 166, 255, 0.2);
          color: #58a6ff;
        }
        .gh-sync-status-success {
          background: rgba(46, 160, 67, 0.1);
          border: 1px solid rgba(46, 160, 67, 0.2);
          color: #3fb950;
        }
        .gh-sync-status-error {
          background: rgba(248, 81, 73, 0.1);
          border: 1px solid rgba(248, 81, 73, 0.2);
          color: #ff7b72;
        }
        .gh-sync-spinner {
          animation: gh-spin 1s linear infinite;
        }
        @keyframes gh-spin {
          100% { transform: rotate(360deg); }
        }
        .gh-sync-actions {
          display: flex;
          gap: 8px;
          margin-top: 10px;
        }
        .gh-sync-btn {
          padding: 8px 16px;
          border-radius: 4px;
          font-size: 13px;
          cursor: pointer;
          border: 1px solid #30363d;
          background: #21262d;
          color: #c9d1d9;
          font-weight: 500;
        }
        .gh-sync-btn:hover:not(:disabled) { background: #30363d; }
        .gh-sync-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .gh-sync-btn-primary {
          background: #238636;
          border-color: #2ea043;
          color: white;
        }
        .gh-sync-btn-primary:hover:not(:disabled) { background: #2ea043; }
        .gh-sync-btn-danger {
          background: rgba(248, 81, 73, 0.1);
          border-color: rgba(248, 81, 73, 0.2);
          color: #ff7b72;
        }
        .gh-sync-btn-danger:hover {
          background: #f85149;
          border-color: #f85149;
          color: white;
        }
      `}</style>
    </div>
  );
};
