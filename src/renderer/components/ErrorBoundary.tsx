import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Renderer crashed:', error, info.componentStack);
  }

  private reloadApp() {
    window.location.reload();
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-8 text-foreground">
          <div className="max-w-lg space-y-4 rounded-xl border border-border bg-card p-6 shadow-lg">
            <h1 className="text-xl font-semibold">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">
              Fast Renamer hit an unexpected error. Reload the app to continue.
            </p>
            <pre className="overflow-x-auto rounded-md bg-surface p-3 text-xs text-muted-foreground">
              {this.state.error.message}
            </pre>
            <Button onClick={() => this.reloadApp()}>Reload app</Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
