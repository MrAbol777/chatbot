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

const monitoringPayload = {
  meta: { range: '24h', from: '2026-08-26T00:00:00.000Z', to: '2026-08-27T00:00:00.000Z', generatedAt: '2026-08-27T00:00:00.000Z', bucketSeconds: 3600, environment: 'test', requestMetricsSampled: false, thresholds: { errorRatePercent: 5, p95LatencyMs: 5000, minimumRequests: 20 } },
  health: [],
  kpis: {
    totalUsers: 150,
    activeUsers: { value: 42, changePct: 4 },
    requests: { value: 320, changePct: 8 },
    successRate: { value: 99, changePct: 1 },
    errorRate: { value: 1, changePct: -1 },
    p95LatencyMs: { value: 1200, changePct: -5 },
    noaSpent: { value: 38, changePct: 2 },
    tokens: { value: 12800, source: 'recorded' }
  },
  traffic: [], capabilities: [], providers: [],
  queues: { images: {}, videos: {}, staleImages: 0, staleVideos: 0 },
  noa: { captured: [], unresolved: { total: 0, amount: 0 } },
  storage: { image: { status: 'healthy', writable: true, freePercent: 50 }, video: { status: 'disabled', writable: false, freePercent: null } },
  alerts: [], recentErrors: [], topErrors: [],
  process: { uptimeSeconds: 60, rssMb: 80, heapUsedMb: 40, cpuPercent: 2, eventLoopUtilizationPercent: 3, nodeVersion: 'v20.0.0' }
};

describe('AdminPanel modular navigation, RBAC and lazy loading', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/admin/me') {
          return response({ admin: { id: 'admin-1', username: 'root', role: 'superadmin' } });
        }
        if (url === '/api/admin/monitoring/overview?range=24h') {
          return response(monitoringPayload, 200);
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
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/admin/monitoring/overview?range=24h', { credentials: 'include' }));
    expect(await screen.findByText('مرکز پایش دانوآ')).toBeInTheDocument();

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
      if (url === '/api/admin/monitoring/overview?range=24h') {
        return response(monitoringPayload);
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
