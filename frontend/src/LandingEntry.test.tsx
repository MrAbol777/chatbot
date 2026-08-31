import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LandingEntry from './LandingEntry';

const replace = vi.fn();

beforeEach(() => {
  localStorage.clear();
  replace.mockReset();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/auth/session') {
      return new Response(JSON.stringify({ authenticated: false }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ tomanPerNoa: '10000.000000', pricingConfigs: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }));
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, replace }
  });
});

describe('LandingEntry', () => {
  it('redirects an authenticated visitor to chat', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/auth/session') {
        return new Response(JSON.stringify({
          authenticated: true,
          provider: 'otp',
          authMethods: ['bearer'],
          userId: 'user-1',
          profile: { id: 'user-1', name: 'کاربر', age: 12 }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ pricingConfigs: [], tomanPerNoa: '10000' }), { status: 200 });
    }));

    render(<LandingEntry />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/chat'));
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('keeps the landing page for a guest visitor', async () => {
    render(<LandingEntry />);

    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
