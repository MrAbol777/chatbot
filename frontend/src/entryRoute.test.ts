import { describe, expect, it } from 'vitest';
import { getCanonicalLandingUrl, resolveEntryRoute } from './entryRoute';

describe('resolveEntryRoute', () => {
  it('serves the public landing page from the canonical root and legacy landing URL', () => {
    expect(resolveEntryRoute('/')).toBe('landing');
    expect(resolveEntryRoute('/landing')).toBe('landing');
    expect(resolveEntryRoute('/landing/')).toBe('landing');
  });

  it.each([
    '/chat',
    '/c/conversation-id',
    '/studio',
    '/studio/image',
    '/studio/video',
    '/profile',
    '/settings',
    '/noa',
    '/unknown-route',
  ])('preserves the app entry for %s', (pathname) => {
    expect(resolveEntryRoute(pathname)).toBe('app');
  });

  it.each(['/admin-secure-9x7k', '/admin/login', '/admin/users'])('preserves the admin entry for %s', (pathname) => {
    expect(resolveEntryRoute(pathname)).toBe('admin');
  });

  it('does not classify unrelated admin-like paths as admin', () => {
    expect(resolveEntryRoute('/administrator')).toBe('app');
  });
});

describe('getCanonicalLandingUrl', () => {
  it('canonicalizes legacy landing URLs while preserving query and hash', () => {
    expect(getCanonicalLandingUrl({ pathname: '/landing', search: '?ref=family', hash: '#faq' })).toBe('/?ref=family#faq');
    expect(getCanonicalLandingUrl({ pathname: '/landing/', search: '', hash: '#features' })).toBe('/#features');
  });

  it('leaves canonical and app URLs unchanged', () => {
    expect(getCanonicalLandingUrl({ pathname: '/', search: '', hash: '' })).toBeNull();
    expect(getCanonicalLandingUrl({ pathname: '/chat', search: '?auth=login', hash: '' })).toBeNull();
  });
});
