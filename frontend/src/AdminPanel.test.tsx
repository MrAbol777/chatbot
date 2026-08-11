import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminPanel from './AdminPanel';
import { ToastProvider } from './design-system/components';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

describe('AdminPanel navigation and loading', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/admin/me') return response({ admin: { id: 'admin-1', username: 'root', role: 'superadmin' } });
      if (url === '/api/admin/dashboard/stats') return response({}, 500);
      if (url.startsWith('/api/admin/users?')) return response({ items: [], total: 0, page: 1, pageSize: 10 });
      throw new Error(`Unexpected admin request: ${url}`);
    }));
  });

  it('uses grouped accessible navigation and loads data only for the active section', async () => {
    const user = userEvent.setup();
    render(<ToastProvider><AdminPanel /></ToastProvider>);

    expect(screen.getByRole('link', { name: 'پرش به محتوای اصلی' })).toHaveAttribute('href', '#admin-main-content');
    expect(screen.getByRole('button', { name: 'داشبورد' })).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/admin/dashboard/stats', { credentials: 'include' }));
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
      '/api/admin/me',
      '/api/admin/dashboard/stats'
    ]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'مالی نوآ' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'کاربران' }));
    const heading = screen.getByRole('heading', { level: 2, name: 'کاربران' });
    await waitFor(() => expect(heading).toHaveFocus());
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith('/api/admin/users?'))).toBe(true));
    expect(screen.getByRole('button', { name: 'کاربران' })).toHaveAttribute('aria-current', 'page');
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/api/admin/config'))).toBe(false);
  });
});
