import React from 'react';
import { ErrorReporter } from './ErrorReporter';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });
    console.error('[CircuitMuse] Rendering error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <ErrorReporter
          error={this.state.error}
          errorInfo={this.state.errorInfo ?? undefined}
          onDismiss={() => window.location.reload()}
        />
      );
    }
    return this.props.children;
  }
}
