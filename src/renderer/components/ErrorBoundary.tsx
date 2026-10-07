import { Component, type ErrorInfo, type ReactNode } from 'react';
import { getStandaloneTranslator } from '../i18n';
import { Button } from './ui';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Root error boundary. It wraps `I18nProvider` too (so a failure there is still caught), which
 * means it cannot use `useI18n`: the fallback translates with the persisted locale instead.
 */
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
      const { locale, t } = getStandaloneTranslator();
      return (
        <div lang={locale} role="alert" className="flex min-h-screen items-center justify-center bg-background p-8 text-foreground">
          <div className="max-w-lg space-y-4 rounded-xl border border-border bg-card p-6 shadow-lg">
            <h1 className="text-xl font-semibold">{t('error_boundary.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('error_boundary.description')}</p>
            <pre className="overflow-x-auto rounded-md bg-surface p-3 text-xs text-muted-foreground">
              {this.state.error.message}
            </pre>
            <Button onClick={() => this.reloadApp()}>{t('error_boundary.reload')}</Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
