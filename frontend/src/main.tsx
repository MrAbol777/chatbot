import React from 'react';
import ReactDOM from 'react-dom/client';
import './theme/colorMode';
import App from './App';
import './styles/fonts.css';
import './design-system/tokens/tokens.css';
import './design-system/styles/base.css';
import './design-system/styles/components.css';
import './styles.css';
import './ChatExperience.css';
import './components/AppShellState.css';
import './PageExperience.css';
import './theme/colorMode.css';
import { installAuthenticatedFetch } from './auth/danoaSession';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { ToastProvider } from './design-system/components';

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

const ADMIN_PANEL_PATH = '/admin-secure-9x7k';
const isAdminEntry = window.location.pathname === ADMIN_PANEL_PATH || window.location.pathname === '/admin/login' || window.location.pathname.startsWith('/admin/');
const LazyAdminLogin = React.lazy(() => import('./AdminLogin'));
const LazyAdminPanel = React.lazy(() => import('./AdminPanel'));

function AdminEntry() {
  const [authenticated, setAuthenticated] = React.useState(false);
  const [checking, setChecking] = React.useState(true);

  React.useEffect(() => {
    let mounted = true;
    fetch('/api/admin/me', { credentials: 'include' })
      .then((response) => {
        if (mounted) setAuthenticated(response.ok);
      })
      .catch(() => {
        if (mounted) setAuthenticated(false);
      })
      .finally(() => {
        if (mounted) setChecking(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (checking) return <main className="app-route-loading" role="status" aria-live="polite"><strong>در حال بررسی دسترسی مدیریت…</strong></main>;
  return (
    <React.Suspense fallback={<main className="app-route-loading" role="status" aria-live="polite"><strong>در حال آماده‌سازی پنل مدیریت…</strong></main>}>
      {authenticated ? <LazyAdminPanel /> : <LazyAdminLogin onLoginSuccess={() => setAuthenticated(true)} />}
    </React.Suspense>
  );
}

const Root = isAdminEntry ? AdminEntry : App;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <ToastProvider>
        <Root />
      </ToastProvider>
    </AppErrorBoundary>
  </React.StrictMode>
);
