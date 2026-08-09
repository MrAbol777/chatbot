import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/fonts.css';
import './design-system/tokens/tokens.css';
import './design-system/styles/base.css';
import './design-system/styles/components.css';
import './styles.css';
import './ChatExperience.css';
import './components/AppShellState.css';
import { installAuthenticatedFetch } from './auth/danoaSession';
import { AppErrorBoundary } from './components/AppErrorBoundary';

installAuthenticatedFetch();

const preloadRetryKey = `danoa:preload-retry:${window.location.pathname}`;
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  const previousRetryAt = Number(window.sessionStorage.getItem(preloadRetryKey) || 0);
  if (!Number.isFinite(previousRetryAt) || Date.now() - previousRetryAt > 60_000) {
    window.sessionStorage.setItem(preloadRetryKey, String(Date.now()));
    window.location.reload();
  }
});

// Global unhandled error/rejection listeners (production-safe)
window.addEventListener('unhandledrejection', (event) => {
  console.error('[unhandledrejection]', event.reason);
});

window.addEventListener('error', (event) => {
  console.error('[window:error]', event.message, event.filename, event.lineno, event.error);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
