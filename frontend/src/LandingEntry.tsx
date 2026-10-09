import { lazy, Suspense, useEffect, useState } from 'react';
import { loadDanoaSession } from './auth/danoaSession';
import { PUBLIC_ASSETS } from './config/publicAssets';

const LandingPage = lazy(() => import('./Landing'));

function LandingEntryLoader({ label }: { label: string }) {
  return (
    <main className="app-route-loading" role="status" aria-live="polite">
      <span className="app-route-loading__visual" aria-hidden="true">
        <span className="app-route-loading__brand"><img src={PUBLIC_ASSETS.danoaMark} alt="" /></span>
        <span className="app-route-loading__spinner" />
      </span>
      <strong>{label}</strong>
    </main>
  );
}

const getStoredBearer = () => {
  try {
    return localStorage.getItem('chat_auth_token') || '';
  } catch {
    return '';
  }
};

/**
 * Keeps the public landing page useful for guests while sending authenticated
 * users straight to the product. The landing page remains lazy-loaded so this
 * session check does not pull its large marketing bundle into the app entry.
 */
export default function LandingEntry() {
  const [shouldShowLanding, setShouldShowLanding] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const checkSession = async () => {
      try {
        const session = await loadDanoaSession(getStoredBearer());
        if (cancelled) return;

        if (session.authenticated) {
          window.location.replace('/chat');
          return;
        }
      } catch {
        // If the session endpoint is temporarily unavailable, keep the public
        // landing page reachable instead of trapping visitors on a loader.
      }

      if (!cancelled) setShouldShowLanding(true);
    };

    void checkSession();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!shouldShowLanding) {
    return <LandingEntryLoader label="در حال بررسی حساب شما…" />;
  }

  return (
    <Suspense fallback={<LandingEntryLoader label="در حال آماده‌سازی دانوآ…" />}>
      <LandingPage />
    </Suspense>
  );
}
