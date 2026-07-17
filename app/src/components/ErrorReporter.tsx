/**
 * Error reporter — captures errors and lets users submit them to GitHub Issues.
 */

import React, { useState } from 'react';

interface ErrorReporterProps {
  error: Error;
  errorInfo?: React.ErrorInfo;
  onDismiss: () => void;
}

const GITHUB_ISSUES_URL = 'https://github.com/meshackbahati/circuit-muse/issues/new';

export const ErrorReporter: React.FC<ErrorReporterProps> = ({ error, errorInfo, onDismiss }) => {
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    const title = encodeURIComponent(`Bug: ${error.message.slice(0, 80)}`);
    const body = encodeURIComponent([
      `## Error Report`,
      ``,
      `**Error:** ${error.message}`,
      ``,
      `**Stack:**`,
      '```',
      error.stack || 'No stack trace',
      '```',
      ``,
      errorInfo?.componentStack ? `**Component Stack:**\n\`\`\`\n${errorInfo.componentStack}\n\`\`\`` : '',
      ``,
      `**Platform:** ${navigator.platform}`,
      `**User Agent:** ${navigator.userAgent}`,
      `**URL:** ${window.location.href}`,
    ].join('\n'));

    window.open(`${GITHUB_ISSUES_URL}?title=${title}&body=${body}`, '_blank');
    setSubmitted(true);
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0a0a0c',
      color: '#e6e6e9',
      fontFamily: 'system-ui, sans-serif',
      zIndex: 99999,
    }}>
      <div style={{
        maxWidth: 520,
        padding: 32,
        background: '#1e1e23',
        border: '1px solid #2c2c33',
        borderRadius: 12,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 36, marginBottom: 16 }}>{'\u26A0'}</div>
        <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>Something went wrong</h2>
        <p style={{ color: '#888', fontSize: 14, lineHeight: 1.5, marginBottom: 16 }}>
          CircuitMuse encountered an unexpected error.
        </p>
        <pre style={{
          padding: 12,
          background: '#0c0c11',
          borderRadius: 6,
          fontSize: 11,
          color: '#ef4444',
          overflow: 'auto',
          maxHeight: 100,
          textAlign: 'left',
          marginBottom: 16,
        }}>
          {error.message}
        </pre>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          {!submitted ? (
            <button
              onClick={handleSubmit}
              style={{
                padding: '10px 20px',
                background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              Report Issue on GitHub
            </button>
          ) : (
            <span style={{ color: '#22c55e', fontSize: 14 }}>Issue page opened</span>
          )}
          <button
            onClick={onDismiss}
            style={{
              padding: '10px 20px',
              background: 'transparent',
              color: '#888',
              border: '1px solid #2c2c33',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};
