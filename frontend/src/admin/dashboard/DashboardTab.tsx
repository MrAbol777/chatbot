import { useCallback } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { Button, InlineMessage } from '../../design-system/components';
import type { DashboardStats } from '../admin.types';
import { handleAdminResponse } from '../admin.types';
import { useAdminCachedData } from '../adminCache';

const PIE_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7'];

export default function DashboardTab() {
  const fetchDashboard = useCallback(async () => {
    const response = await fetch('/api/admin/dashboard/stats', { credentials: 'include' });
    const result = await handleAdminResponse(response, 'بارگذاری داده‌های داشبورد ناموفق بود.');
    if (!result.ok) throw new Error('دریافت اطلاعات ناموفق بود');
    return result.data as DashboardStats;
  }, []);

  const { data: dashboard, loading, error, refresh } = useAdminCachedData<DashboardStats>(
    'admin:dashboard:stats',
    fetchDashboard,
    40000
  );

  const estimatedTokensToday = (dashboard?.kpis?.apiCallsToday ?? 0) * 380;
  const estimatedCostToman = Math.round((estimatedTokensToday / 1000) * 45);

  return (
    <div className="admin-section">
      <div className="admin-section-header" style={{ marginBottom: '16px' }}>
        <div>
          <h3>شاخص‌های عملکرد، سلامت سیستم و آمار مصرف هوش مصنوعی</h3>
          <p className="admin-note">مانیتورینگ بلادرنگ کاربران فعال، فراخوانی‌های پایپ‌لاین AI و گزارش رویدادها</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void refresh(true)} disabled={loading}>
          {loading ? 'در حال بازخوانی...' : 'بازخوانی آمار'}
        </Button>
      </div>

      {loading && !dashboard ? (
        <div className="dashboard-skeleton">
          <div className="kpi-grid">
            <div className="skeleton-card" />
            <div className="skeleton-card" />
            <div className="skeleton-card" />
            <div className="skeleton-card" />
          </div>
          <div className="chart-grid">
            <div className="skeleton-chart" />
            <div className="skeleton-chart" />
            <div className="skeleton-chart" />
          </div>
        </div>
      ) : null}

      {error ? <InlineMessage text={error} variant="error" /> : null}

      {dashboard ? (
        <>
          <div className="kpi-grid">
            <div className="kpi-card kpi-card--users">
              <div className="kpi-card__label">تعداد کل کاربران</div>
              <strong className="kpi-card__value">{dashboard.kpis?.totalUsers ?? 0}</strong>
            </div>
            <div className="kpi-card kpi-card--active">
              <div className="kpi-card__label">کاربران فعال ۲۴ ساعت اخیر</div>
              <strong className="kpi-card__value">{dashboard.kpis?.activeUsersToday ?? 0}</strong>
            </div>
            <div className="kpi-card kpi-card--api">
              <div className="kpi-card__label">درخواست‌های API امروز</div>
              <strong className="kpi-card__value">{dashboard.kpis?.apiCallsToday ?? 0}</strong>
            </div>
            <div className="kpi-card kpi-card--errors">
              <div className="kpi-card__label">تعداد خطاهای امروز</div>
              <strong className="kpi-card__value">{dashboard.kpis?.errorCountToday ?? 0}</strong>
            </div>
          </div>

          <div className="kpi-grid" style={{ marginTop: '12px' }}>
            <div className="kpi-card" style={{ background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.1), rgba(30, 41, 59, 0.8))' }}>
              <div className="kpi-card__label">تخمین توکن‌های مصرفی امروز</div>
              <strong className="kpi-card__value" style={{ color: '#38bdf8' }}>
                ~{estimatedTokensToday.toLocaleString('fa-IR')} <small style={{ fontSize: '12px' }}>Token</small>
              </strong>
            </div>
            <div className="kpi-card" style={{ background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(30, 41, 59, 0.8))' }}>
              <div className="kpi-card__label">تخمین هزینه زیرساخت امروز</div>
              <strong className="kpi-card__value" style={{ color: '#34d399' }}>
                ~{estimatedCostToman.toLocaleString('fa-IR')} <small style={{ fontSize: '12px' }}>تومان</small>
              </strong>
            </div>
          </div>

          <div className="chart-grid">
            <div className="chart-card">
              <h3>رشد کاربران - ۷ روز اخیر</h3>
              <ResponsiveContainer width="100%" height="90%" minWidth={1} minHeight={240}>
                <LineChart data={dashboard.userGrowth || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                  <XAxis dataKey="date" stroke="#888" />
                  <YAxis allowDecimals={false} stroke="#888" />
                  <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#fff' }} />
                  <Legend />
                  <Line type="monotone" dataKey="users" stroke="#3b82f6" strokeWidth={2} name="کاربر جدید" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-card">
              <h3>مصرف API - ۷ روز اخیر</h3>
              <ResponsiveContainer width="100%" height="90%" minWidth={1} minHeight={240}>
                <BarChart data={dashboard.apiUsage || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                  <XAxis dataKey="date" stroke="#888" />
                  <YAxis allowDecimals={false} stroke="#888" />
                  <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#fff' }} />
                  <Legend />
                  <Bar dataKey="calls" fill="#10b981" radius={[4, 4, 0, 0]} name="درخواست‌ها" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-card">
              <h3>توزیع خطاها</h3>
              <ResponsiveContainer width="100%" height="90%" minWidth={1} minHeight={240}>
                <PieChart>
                  <Pie
                    data={dashboard.errorDistribution || []}
                    dataKey="count"
                    nameKey="error_type"
                    cx="50%"
                    cy="50%"
                    outerRadius={85}
                    label
                  >
                    {(dashboard.errorDistribution || []).map((item, index) => (
                      <Cell key={`${item.error_type}-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#fff' }} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="admin-section">
            <h3>آخرین فعالیت‌ها (Audit)</h3>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>زمان</th>
                    <th>ادمین</th>
                    <th>عملیات</th>
                    <th>هدف</th>
                    <th>جزئیات</th>
                  </tr>
                </thead>
                <tbody>
                  {(dashboard.recentActivities || []).map((item, index) => (
                    <tr key={index}>
                      <td>{item.timestamp || '-'}</td>
                      <td><strong>{item.adminUsername || '-'}</strong></td>
                      <td><code>{item.action || '-'}</code></td>
                      <td>{item.target || '-'}</td>
                      <td>
                        <span className="admin-note" style={{ maxWidth: '280px', display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {JSON.stringify(item.details || {})}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {(!dashboard.recentActivities || dashboard.recentActivities.length === 0) ? (
                    <tr>
                      <td colSpan={5}>هنوز فعالیتی ثبت نشده است.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
