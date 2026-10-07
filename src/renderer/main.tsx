import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { I18nProvider } from './i18n';
// Fonts are bundled locally: the CSP only allows `font-src 'self'`.
import '@fontsource-variable/dm-sans/opsz.css';
import '@fontsource-variable/dm-sans/opsz-italic.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/400-italic.css';
import '@fontsource/jetbrains-mono/500.css';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
