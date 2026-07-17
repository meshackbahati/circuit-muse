import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[CircuitMuse] Rendering error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
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
        }}>
          <div style={{
            maxWidth: 500,
            padding: 32,
            background: '#1e1e23',
            border: '1px solid #2c2c33',
            borderRadius: 12,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>{'\u26A0'}</div>
            <h2 style={{ margin: '0 0 12px', fontSize: 20 }}>Something went wrong</h2>
            <p style={{ color: '#888', fontSize: 14, lineHeight: 1.5 }}>
              CircuitMuse encountered an error. Please restart the application.
            </p>
            <pre style={{
              marginTop: 16,
              padding: 12,
              background: '#0c0c11',
              borderRadius: 6,
              fontSize: 12,
              color: '#ef4444',
              overflow: 'auto',
              maxHeight: 120,
            }}>
              {this.state.error?.message}
            </pre>
            <button
              onClick={() => window.location.reload()}
              style={{
                marginTop: 16,
                padding: '10px 24px',
                background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              Restart
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
