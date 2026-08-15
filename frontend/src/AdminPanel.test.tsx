import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminPanel from './AdminPanel';
import { ToastProvider } from './design-system/components';

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });

describe('AdminPanel modular navigation, RBAC and lazy loading', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/admin/me') {
          return response({ admin: { id: 'admin-1', username: 'root', role: 'superadmin' } });
        }
        if (url === '/api/admin/dashboard/stats') {
          return response(
            {
              kpis: { totalUsers: 150, activeUsersToday: 42, apiCallsToday: 320, errorCountToday: 3 },
              userGrowth: [],
              apiUsage: [],
              errorDistribution: [],
              recentActivities: []
            },
            200
          );
        }
        if (url.startsWith('/api/admin/users?')) {
          return response({ items: [], total: 0, page: 1, pageSize: 10 });
        }
        if (url === '/api/admin/moderation/flagged') {
          return response({ users: [], images: [] });
        }
        throw new Error(`Unexpected admin request: ${url}`);
      })
    );
  });

  it('uses grouped accessible navigation and loads data only for the active section', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <AdminPanel />
      </ToastProvider>
    );

    expect(screen.getByRole('link', { name: 'پرش به محتوای اصلی' })).toHaveAttribute('href', '#admin-main-content');
    expect(screen.getByRole('button', { name: 'داشبورد' })).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/admin/dashboard/stats', { credentials: 'include' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'نوآ و قیمت‌گذاری' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'ایمنی و نظارت' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'کاربران' }));
    const heading = screen.getByRole('heading', { level: 2, name: 'کاربران' });
    await waitFor(() => expect(heading).toHaveFocus());
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith('/api/admin/users?'))).toBe(true)
    );
    expect(screen.getByRole('button', { name: 'کاربران' })).toHaveAttribute('aria-current', 'page');
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/api/admin/config'))).toBe(false);
  });

  it('restricts tabs based on admin role (e.g. finance)', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/admin/me') {
        return response({ admin: { id: 'admin-2', username: 'finance_officer', role: 'finance' } });
      }
      if (url === '/api/admin/dashboard/stats') {
        return response({ kpis: { totalUsers: 0, activeUsersToday: 0, apiCallsToday: 0, errorCountToday: 0 } });
      }
      return response({});
    });

    render(
      <ToastProvider>
        <AdminPanel />
      </ToastProvider>
    );

    await waitFor(() => expect(screen.getByText('finance_officer')).toBeInTheDocument());
    // Finance role should see dashboard and noaFinance, but NOT system config or AI routing
    expect(screen.getByRole('button', { name: 'نوآ و قیمت‌گذاری' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'تنظیمات سیستم' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ارائه‌دهندگان AI' })).not.toBeInTheDocument();
  });
});
