export const ADMIN_PANEL_PATH = '/admin-secure-9x7k';
export const CANONICAL_LANDING_PATH = '/';

export type EntryRoute = 'admin' | 'landing' | 'app';

const isAdminPath = (pathname: string) => (
  pathname === ADMIN_PANEL_PATH ||
  pathname === '/admin/login' ||
  pathname.startsWith('/admin/')
);

const isLandingPath = (pathname: string) => (
  pathname === CANONICAL_LANDING_PATH ||
  pathname === '/landing' ||
  pathname === '/landing/'
);

/**
 * Chooses only the top-level application bundle. App.tsx remains responsible
 * for all chat, studio, profile, wallet, conversation, and not-found routes.
 */
export const resolveEntryRoute = (pathname: string): EntryRoute => {
  if (isAdminPath(pathname)) return 'admin';
  if (isLandingPath(pathname)) return 'landing';
  return 'app';
};

/** Keeps old shared /landing URLs working while exposing / as the canonical URL. */
export const getCanonicalLandingUrl = ({
  pathname,
  search,
  hash,
}: Pick<Location, 'pathname' | 'search' | 'hash'>): string | null => {
  if (pathname !== '/landing' && pathname !== '/landing/') return null;
  return `${CANONICAL_LANDING_PATH}${search}${hash}`;
};
