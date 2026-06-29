import { useEffect, useMemo, useState } from 'react';
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
import { Button, FieldGroup, InlineMessage, TextAreaField, TextField } from './design-system/components';

type User = {
  user_id: string;
  name: string;
  age: number;
  phone?: string;
  registered_at?: string;
  last_activity?: string;
  conversationCount?: number;
  isBanned?: boolean;
};

type UserProfile = User & {
  conversations: Array<{
    conversation_id: string;
    title: string;
    message_count: number;
    last_message_at?: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  }>;
};

type DashboardStats = {
  kpis: {
    totalUsers: number;
    activeUsersToday: number;
    apiCallsToday: number;
    errorCountToday: number;
  };
  userGrowth: Array<{ date: string; users: number }>;
  apiUsage: Array<{ date: string; calls: number }>;
  errorDistribution: Array<{ error_type: string; count: number }>;
  recentActivities: Array<{
    timestamp: string;
    adminUsername: string;
    action: string;
    target: string | null;
    details?: Record<string, unknown>;
  }>;
};

type SubscriptionPlan = {
  id: string;
  name: string;
  icon: string;
  tagline?: string;
  monthlyPrice: number;
  dailyPrice: number;
  dailyMessageLimit: number | null;
  dailyImageLimit: number | null;
  features: string[];
  isActive: boolean;
  sortOrder: number;
};

type UserSubscription = {
  userId: string;
  planId: string;
  status: string;
  assignedAt?: string;
  expiresAt?: string | null;
  note?: string;
  plan?: SubscriptionPlan | null;
  user?: User | null;
};

type SubscriptionsPayload = {
  plans: SubscriptionPlan[];
  userSubscriptions: UserSubscription[];
  users: User[];
  updatedAt?: string;
};

type SiteSettingsPayload = {
  settings: Record<string, any>;
  definitions?: Record<string, { label: string; type: string; category: string; allowedValues?: string[] }>;
};

const PIE_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7'];
type AdminTab = 'dashboard' | 'users' | 'subscriptions' | 'errors' | 'siteSettings' | 'config' | 'audit';
const TAB_LABELS: Record<AdminTab, string> = {
  dashboard: 'داشبورد',
  users: 'کاربران',
  subscriptions: 'اشتراک‌ها',
  errors: 'خطاها',
  siteSettings: 'تنظیمات سایت',
  config: 'سیستم',
  audit: 'Audit'
};

const TAB_ICONS: Record<keyof typeof TAB_LABELS, string> = {
  dashboard: '▦',
  users: '◎',
  subscriptions: '◈',
  errors: '!',
  siteSettings: '⚙',
  config: '⚙',
  audit: '⌁'
};

// ─── Shared error helpers for admin routes ───
const handleAdminResponse = async (response: Response, fallback: string): Promise<{ ok: boolean; data?: any }> => {
  if (response.status === 401) {
    window.location.href = '/admin/login';
    return { ok: false };
  }
  if (!response.ok) {
    let message = fallback;
    try {
      const payload = await response.json();
      if (payload?.error || payload?.message) message = payload.error || payload.message;
    } catch { /* ignore JSON parse error */ }
    throw new Error(message);
  }
  const data = await response.json();
  return { ok: true, data };
};

function AdminPanel() {
  const [tab, setTab] = useState<AdminTab>('dashboard');
  const [users, setUsers] = useState<User[]>([]);
  const [query, setQuery] = useState('');
  const [banFilter, setBanFilter] = useState('all');
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [errors, setErrors] = useState<any[]>([]);
  const [config, setConfig] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [reportOptions, setReportOptions] = useState({ users: true, errors: false, conversations: false });
  const [dashboard, setDashboard] = useState<DashboardStats | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState('');
  const [configSaving, setConfigSaving] = useState(false);
  const [configMessage, setConfigMessage] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [systemPromptLoading, setSystemPromptLoading] = useState(false);
  const [systemPromptSaving, setSystemPromptSaving] = useState(false);
  const [systemPromptMessage, setSystemPromptMessage] = useState('');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [subscriptions, setSubscriptions] = useState<SubscriptionsPayload | null>(null);
  const [subscriptionMessage, setSubscriptionMessage] = useState('');
  const [subscriptionSaving, setSubscriptionSaving] = useState(false);
  const [assignForm, setAssignForm] = useState({ userId: '', planId: 'gold', expiresAt: '', note: '' });
  const [siteSettings, setSiteSettings] = useState<SiteSettingsPayload | null>(null);
  const [siteSettingsSaving, setSiteSettingsSaving] = useState(false);
  const [siteSettingsMessage, setSiteSettingsMessage] = useState('');

  const loadUsers = async () => {
    setLoadError('');
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (banFilter !== 'all') params.set('isBanned', banFilter);
    try {
      const response = await fetch(`/api/admin/users?${params.toString()}`, { credentials: 'include' });
      const result = await handleAdminResponse(response, 'بارگذاری کاربران ناموفق بود.');
      if (!result.ok) return;
      setUsers(result.data.items || []);
    } catch {
      setLoadError('اتصال به سرور برقرار نشد. لطفاً دوباره تلاش کنید.');
    }
  };

  const loadDashboard = async () => {
    setDashboardLoading(true);
    setDashboardError('');

    try {
      const response = await fetch('/api/admin/dashboard/stats', { credentials: 'include' });
      if (response.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      if (!response.ok) {
        throw new Error('بارگذاری داده های داشبورد ناموفق بود.');
      }
      const payload = (await response.json()) as DashboardStats;
      setDashboard(payload);
    } catch (_error) {
      setDashboardError('دریافت اطلاعات داشبورد با خطا مواجه شد. لطفا دوباره تلاش کنید.');
    } finally {
      setDashboardLoading(false);
    }
  };

  const loadErrors = async () => {
    try {
      const response = await fetch('/api/admin/errors', { credentials: 'include' });
      const result = await handleAdminResponse(response, 'بارگذاری خطاها ناموفق بود.');
      if (result.ok) setErrors(result.data.items || []);
    } catch {
      console.error('[admin] loadErrors failed');
    }
  };

  const loadConfig = async () => {
    try {
      const response = await fetch('/api/admin/config', { credentials: 'include' });
      const result = await handleAdminResponse(response, 'بارگذاری تنظیمات ناموفق بود.');
      if (result.ok) setConfig(result.data);
    } catch {
      console.error('[admin] loadConfig failed');
    }
  };

  const loadSystemPrompt = async () => {
    setSystemPromptLoading(true);
    setSystemPromptMessage('');
    try {
      const response = await fetch('/api/admin/config/system-prompt', { credentials: 'include' });
      if (response.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      if (!response.ok) {
        throw new Error('load_failed');
      }
      const payload = await response.json();
      setSystemPrompt(typeof payload.systemPrompt === 'string' ? payload.systemPrompt : '');
    } catch (_error) {
      setSystemPromptMessage('خواندن سیستم پرامپت ناموفق بود.');
    } finally {
      setSystemPromptLoading(false);
    }
  };

  const loadLogs = async () => {
    try {
      const response = await fetch('/api/admin/audit-logs?page=1&pageSize=50', { credentials: 'include' });
      const result = await handleAdminResponse(response, 'بارگذاری لاگ ها ناموفق بود.');
      if (result.ok) setLogs(result.data.items || []);
    } catch {
      console.error('[admin] loadLogs failed');
    }
  };

  const loadSubscriptions = async () => {
    setSubscriptionMessage('');
    try {
      const response = await fetch('/api/admin/subscriptions', { credentials: 'include' });
      const result = await handleAdminResponse(response, 'بارگذاری اشتراک‌ها ناموفق بود.');
      if (result.ok) {
        setSubscriptions(result.data);
        const firstUser = result.data.users?.[0]?.user_id || '';
        const firstPlan = result.data.plans?.find((plan: SubscriptionPlan) => plan.id !== 'free')?.id || result.data.plans?.[0]?.id || 'gold';
        setAssignForm((prev) => ({
          ...prev,
          userId: prev.userId || firstUser,
          planId: prev.planId || firstPlan
        }));
      }
    } catch {
      setSubscriptionMessage('اتصال به سرور برای دریافت اشتراک‌ها برقرار نشد.');
    }
  };

  const loadSiteSettings = async () => {
    setSiteSettingsMessage('');
    try {
      const response = await fetch('/api/admin/settings', { credentials: 'include' });
      const result = await handleAdminResponse(response, 'بارگذاری تنظیمات سایت ناموفق بود.');
      if (result.ok) setSiteSettings(result.data);
    } catch (error) {
      setSiteSettingsMessage(error instanceof Error ? error.message : 'اتصال به سرور برای دریافت تنظیمات سایت برقرار نشد.');
    }
  };

  useEffect(() => {
    void loadDashboard();
    void loadUsers();
    void loadErrors();
    void loadConfig();
    void loadSystemPrompt();
    void loadLogs();
    void loadSubscriptions();
    void loadSiteSettings();
  }, []);

  const visibleUsers = useMemo(() => users, [users]);

  const toggleBan = async (user: User) => {
    setActionError('');
    try {
      const response = await fetch(`/api/admin/users/${user.user_id}/ban`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ isBanned: !user.isBanned })
      });
      await handleAdminResponse(response, 'تغییر وضعیت کاربر ناموفق بود.');
      await loadUsers();
    } catch {
      setActionError('عملیات با خطا مواجه شد. لطفاً دوباره تلاش کنید.');
    }
  };

  const deleteUser = async (user: User) => {
    if (!window.confirm('حذف کاربر و گفتگوها انجام شود؟')) return;
    setActionError('');
    try {
      const response = await fetch(`/api/admin/users/${user.user_id}`, { method: 'DELETE', credentials: 'include' });
      await handleAdminResponse(response, 'حذف کاربر ناموفق بود.');
      setSelectedUser(null);
      await loadUsers();
      await loadDashboard();
    } catch {
      setActionError('حذف کاربر با خطا مواجه شد. لطفاً دوباره تلاش کنید.');
    }
  };

  const openUser = async (userId: string) => {
    setActionError('');
    try {
      const response = await fetch(`/api/admin/users/${userId}`, { credentials: 'include' });
      const result = await handleAdminResponse(response, 'بارگذاری پروفایل کاربر ناموفق بود.');
      if (result.ok) setSelectedUser(result.data);
    } catch {
      setActionError('اتصال به سرور برقرار نشد. لطفاً دوباره تلاش کنید.');
    }
  };

  const saveConfig = async () => {
    setConfigSaving(true);
    setConfigMessage('');
    try {
      const response = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(config)
      });

      if (!response.ok) {
        throw new Error('خطا در ذخیره سازی تنظیمات');
      }

      await loadConfig();
      setConfigMessage('تنظیمات با موفقیت ذخیره شد.');
    } catch (_error) {
      setConfigMessage('ذخیره تنظیمات ناموفق بود. لطفا دوباره تلاش کنید.');
    } finally {
      setConfigSaving(false);
    }
  };

  const downloadReport = () => {
    const params = new URLSearchParams();
    if (reportOptions.users) params.set('users', '1');
    if (reportOptions.errors) params.set('errors', '1');
    if (reportOptions.conversations) params.set('conversations', '1');
    window.open(`/api/admin/reports/csv?${params.toString()}`, '_blank');
  };

  const saveSystemPrompt = async () => {
    if (!systemPrompt.trim()) {
      setSystemPromptMessage('سیستم پرامپت نمی تواند خالی باشد.');
      return;
    }

    setSystemPromptSaving(true);
    setSystemPromptMessage('');
    try {
      const response = await fetch('/api/admin/config/system-prompt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ systemPrompt })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'save_failed');
      }
      setSystemPromptMessage(payload.message || 'پرامپت با موفقیت به‌روزرسانی شد');
    } catch (error) {
      setSystemPromptMessage(error instanceof Error ? error.message : 'ذخیره سیستم پرامپت ناموفق بود.');
    } finally {
      setSystemPromptSaving(false);
    }
  };

  const updateLocalPlan = (planId: string, patch: Partial<SubscriptionPlan> & { featuresText?: string }) => {
    setSubscriptions((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        plans: prev.plans.map((plan) => (plan.id === planId ? { ...plan, ...patch } : plan))
      };
    });
  };

  const savePlan = async (plan: SubscriptionPlan) => {
    setSubscriptionSaving(true);
    setSubscriptionMessage('');
    try {
      const response = await fetch(`/api/admin/subscriptions/plans/${encodeURIComponent(plan.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(plan)
      });
      await handleAdminResponse(response, 'ذخیره پلن ناموفق بود.');
      await loadSubscriptions();
      setSubscriptionMessage('پلن با موفقیت ذخیره شد.');
    } catch (error) {
      setSubscriptionMessage(error instanceof Error ? error.message : 'ذخیره پلن ناموفق بود.');
    } finally {
      setSubscriptionSaving(false);
    }
  };

  const assignSubscription = async () => {
    if (!assignForm.userId || !assignForm.planId) {
      setSubscriptionMessage('کاربر و پلن را انتخاب کنید.');
      return;
    }
    setSubscriptionSaving(true);
    setSubscriptionMessage('');
    try {
      const response = await fetch('/api/admin/subscriptions/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(assignForm)
      });
      await handleAdminResponse(response, 'اختصاص اشتراک ناموفق بود.');
      await loadSubscriptions();
      setSubscriptionMessage('اشتراک کاربر با موفقیت به‌روزرسانی شد.');
    } catch (error) {
      setSubscriptionMessage(error instanceof Error ? error.message : 'اختصاص اشتراک ناموفق بود.');
    } finally {
      setSubscriptionSaving(false);
    }
  };

  const cancelSubscription = async (userId: string) => {
    if (!window.confirm('اشتراک این کاربر لغو شود؟')) return;
    setSubscriptionSaving(true);
    setSubscriptionMessage('');
    try {
      const response = await fetch(`/api/admin/subscriptions/users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      await handleAdminResponse(response, 'لغو اشتراک ناموفق بود.');
      await loadSubscriptions();
      setSubscriptionMessage('اشتراک لغو شد.');
    } catch (error) {
      setSubscriptionMessage(error instanceof Error ? error.message : 'لغو اشتراک ناموفق بود.');
    } finally {
      setSubscriptionSaving(false);
    }
  };

  const updateSiteSetting = (key: string, value: any) => {
    setSiteSettings((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        settings: {
          ...prev.settings,
          [key]: value
        }
      };
    });
  };

  const saveSiteSettings = async () => {
    if (!siteSettings) return;
    setSiteSettingsSaving(true);
    setSiteSettingsMessage('');
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ settings: siteSettings.settings })
      });
      const result = await handleAdminResponse(response, 'ذخیره تنظیمات سایت ناموفق بود.');
      if (result.ok) {
        setSiteSettings(result.data);
        setSiteSettingsMessage('تنظیمات سایت با موفقیت ذخیره شد.');
      }
    } catch (error) {
      setSiteSettingsMessage(error instanceof Error ? error.message : 'ذخیره تنظیمات سایت ناموفق بود.');
    } finally {
      setSiteSettingsSaving(false);
    }
  };

  return (
    <div className="admin-panel">
      <div className="admin-panel__header">
        <div>
          <span className="admin-panel__eyebrow">مدیریت محصول</span>
          <h2>پنل ادمین دانوآ</h2>
          <p>نمای کلی وضعیت کاربران، اشتراک‌ها، خطاها و فعالیت سیستم</p>
        </div>
      </div>

      <div className="admin-tabs">
        {(Object.keys(TAB_LABELS) as AdminTab[]).map((item) => (
          <Button
            key={item}
            variant="secondary"
            className={`admin-tab ${tab === item ? 'active' : ''}`}
            onClick={() => setTab(item)}
          >
            <span className="admin-tab__icon" aria-hidden="true">{TAB_ICONS[item]}</span>
            {TAB_LABELS[item]}
          </Button>
        ))}
      </div>

      {loadError && (
        <InlineMessage text={loadError} variant="error" />
      )}
      {actionError && (
        <InlineMessage text={actionError} variant="error" />
      )}

      {tab === 'dashboard' ? (
        <div className="admin-section">
          {dashboardLoading ? (
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
          {dashboardError ? <p className="admin-error">{dashboardError}</p> : null}

          {dashboard ? (
            <>
              <div className="kpi-grid">
                <div className="kpi-card kpi-card--users">
                  <div className="kpi-card__label">تعداد کل کاربران</div>
                  <strong className="kpi-card__value">{dashboard.kpis.totalUsers}</strong>
                </div>
                <div className="kpi-card kpi-card--active">
                  <div className="kpi-card__label">کاربران فعال 24 ساعت اخیر</div>
                  <strong className="kpi-card__value">{dashboard.kpis.activeUsersToday}</strong>
                </div>
                <div className="kpi-card kpi-card--api">
                  <div className="kpi-card__label">درخواست های API امروز</div>
                  <strong className="kpi-card__value">{dashboard.kpis.apiCallsToday}</strong>
                </div>
                <div className="kpi-card kpi-card--errors">
                  <div className="kpi-card__label">تعداد خطاهای امروز</div>
                  <strong className="kpi-card__value">{dashboard.kpis.errorCountToday}</strong>
                </div>
              </div>

              <div className="chart-grid">
                <div className="chart-card">
                  <h3>رشد کاربران - 7 روز اخیر</h3>
                  <ResponsiveContainer width="100%" height="90%">
                    <LineChart data={dashboard.userGrowth}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="users" stroke="#2563eb" strokeWidth={2} name="کاربر جدید" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="chart-card">
                  <h3>مصرف API - 7 روز اخیر</h3>
                  <ResponsiveContainer width="100%" height="90%">
                    <BarChart data={dashboard.apiUsage}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="calls" fill="#16a34a" name="message_sent" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="chart-card">
                  <h3>توزیع خطاها</h3>
                  <ResponsiveContainer width="100%" height="90%">
                    <PieChart>
                      <Pie
                        data={dashboard.errorDistribution}
                        dataKey="count"
                        nameKey="error_type"
                        cx="50%"
                        cy="50%"
                        outerRadius={95}
                        label
                      >
                        {dashboard.errorDistribution.map((item, index) => (
                          <Cell key={`${item.error_type}-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="admin-section">
                <h3>آخرین فعالیت ها (Audit)</h3>
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
                    {dashboard.recentActivities.map((item, index) => (
                      <tr key={index}>
                        <td>{item.timestamp || '-'}</td>
                        <td>{item.adminUsername || '-'}</td>
                        <td>{item.action || '-'}</td>
                        <td>{item.target || '-'}</td>
                        <td>{JSON.stringify(item.details || {})}</td>
                      </tr>
                    ))}
                    {dashboard.recentActivities.length === 0 ? (
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
      ) : null}

      {tab === 'users' ? (
        <div className="admin-section">
          <div className="admin-controls">
            <TextField
              className="admin-control-field"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جستجوی نام"
              aria-label="جستجوی نام"
              fullWidth={false}
            />
            <select value={banFilter} onChange={(e) => setBanFilter(e.target.value)}>
              <option value="all">همه</option>
              <option value="true">مسدود</option>
              <option value="false">فعال</option>
            </select>
            <Button className="admin-action-btn" onClick={() => void loadUsers()}>اعمال فیلتر</Button>
          </div>
          <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>نام</th><th>سن</th><th>شماره</th><th>تاریخ عضویت</th><th>تعداد گفتگو</th><th>آخرین فعالیت</th><th>عملیات</th></tr>
            </thead>
            <tbody>
              {visibleUsers.map((user) => (
                <tr key={user.user_id}>
                  <td>{user.name}</td><td>{user.age}</td><td>{user.phone || '-'}</td><td>{user.registered_at || '-'}</td>
                  <td>{user.conversationCount || 0}</td><td>{user.last_activity || '-'}</td>
                  <td>
                    <FieldGroup direction="row" className="admin-row-actions">
                      <Button variant="ghost" size="sm" onClick={() => void openUser(user.user_id)}>
                        پروفایل
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => void toggleBan(user)}>
                        {user.isBanned ? 'رفع مسدود' : 'مسدود'}
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => void deleteUser(user)}>
                        حذف
                      </Button>
                    </FieldGroup>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          {selectedUser ? (
            <div className="profile-box">
              <h3>پروفایل کاربر: {selectedUser.name}</h3>
              <p>سن: {selectedUser.age} | شماره: {selectedUser.phone || '-'}</p>
              {selectedUser.conversations.map((conv) => (
                <details key={conv.conversation_id} className="profile-conversation">
                  <summary>{conv.title} - {conv.message_count} پیام</summary>
                  <pre className="profile-messages">
                    {conv.messages.map((msg) => `[${msg.role}] ${msg.content}`).join('\n')}
                  </pre>
                </details>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'subscriptions' ? (
        <div className="admin-section">
          <div className="admin-section-header">
            <div>
              <h3>مدیریت اشتراک‌ها</h3>
              <p className="admin-note">پلن‌های نمایش داده‌شده در صفحه خرید و اشتراک فعال کاربران را مدیریت کنید.</p>
            </div>
            <Button className="admin-action-btn" onClick={() => void loadSubscriptions()}>بروزرسانی</Button>
          </div>

          {subscriptionMessage ? (
            <InlineMessage
              text={subscriptionMessage}
              variant={subscriptionMessage.includes('موفقیت') || subscriptionMessage.includes('لغو شد') ? 'success' : 'error'}
            />
          ) : null}

          <div className="subscription-plan-grid">
            {(subscriptions?.plans || []).map((plan) => (
              <article className="subscription-plan-editor" key={plan.id}>
                <div className="subscription-plan-editor__head">
                  <strong>{plan.icon} {plan.name}</strong>
                  <label>
                    <input
                      type="checkbox"
                      checked={plan.isActive}
                      onChange={(event) => updateLocalPlan(plan.id, { isActive: event.target.checked })}
                    />
                    فعال
                  </label>
                </div>
                <FieldGroup direction="row">
                  <TextField label="نام پلن" value={plan.name} onChange={(e) => updateLocalPlan(plan.id, { name: e.target.value })} />
                  <TextField label="آیکن" value={plan.icon} onChange={(e) => updateLocalPlan(plan.id, { icon: e.target.value })} />
                </FieldGroup>
                <TextField label="توضیح کوتاه" value={plan.tagline || ''} onChange={(e) => updateLocalPlan(plan.id, { tagline: e.target.value })} />
                <FieldGroup direction="row">
                  <TextField label="قیمت ماهانه" type="number" value={String(plan.monthlyPrice || 0)} onChange={(e) => updateLocalPlan(plan.id, { monthlyPrice: Number(e.target.value) })} />
                  <TextField label="قیمت روزانه" type="number" value={String(plan.dailyPrice || 0)} onChange={(e) => updateLocalPlan(plan.id, { dailyPrice: Number(e.target.value) })} />
                </FieldGroup>
                <FieldGroup direction="row">
                  <TextField
                    label="سقف پیام روزانه"
                    value={plan.dailyMessageLimit === null ? '' : String(plan.dailyMessageLimit)}
                    placeholder="خالی = نامحدود"
                    onChange={(e) => updateLocalPlan(plan.id, { dailyMessageLimit: e.target.value.trim() ? Number(e.target.value) : null })}
                  />
                  <TextField
                    label="سقف تصویر روزانه"
                    value={plan.dailyImageLimit === null ? '' : String(plan.dailyImageLimit)}
                    placeholder="خالی = نامحدود"
                    onChange={(e) => updateLocalPlan(plan.id, { dailyImageLimit: e.target.value.trim() ? Number(e.target.value) : null })}
                  />
                </FieldGroup>
                <TextAreaField
                  label="ویژگی‌ها"
                  rows={4}
                  value={plan.features.join('\n')}
                  onChange={(e) => updateLocalPlan(plan.id, { features: e.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })}
                  helperText="هر ویژگی در یک خط"
                />
                <Button className="admin-action-btn" disabled={subscriptionSaving} onClick={() => void savePlan(plan)}>
                  ذخیره پلن
                </Button>
              </article>
            ))}
          </div>

          <div className="subscription-assign-panel">
            <h3>اختصاص اشتراک به کاربر</h3>
            <FieldGroup direction="row">
              <label className="admin-select-field">
                <span>کاربر</span>
                <select value={assignForm.userId} onChange={(e) => setAssignForm({ ...assignForm, userId: e.target.value })}>
                  {(subscriptions?.users || users).map((user) => (
                    <option key={user.user_id} value={user.user_id}>
                      {user.name} - {user.phone || user.user_id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="admin-select-field">
                <span>پلن</span>
                <select value={assignForm.planId} onChange={(e) => setAssignForm({ ...assignForm, planId: e.target.value })}>
                  {(subscriptions?.plans || []).map((plan) => (
                    <option key={plan.id} value={plan.id}>{plan.name}</option>
                  ))}
                </select>
              </label>
            </FieldGroup>
            <FieldGroup direction="row">
              <TextField
                label="تاریخ انقضا"
                type="date"
                value={assignForm.expiresAt}
                onChange={(e) => setAssignForm({ ...assignForm, expiresAt: e.target.value })}
                helperText="خالی بماند یعنی بدون تاریخ انقضا"
              />
              <TextField
                label="یادداشت"
                value={assignForm.note}
                onChange={(e) => setAssignForm({ ...assignForm, note: e.target.value })}
              />
            </FieldGroup>
            <Button className="admin-action-btn" disabled={subscriptionSaving} onClick={() => void assignSubscription()}>
              ثبت اشتراک کاربر
            </Button>
          </div>

          <h3>اشتراک‌های فعال</h3>
          <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>کاربر</th><th>پلن</th><th>وضعیت</th><th>شروع</th><th>انقضا</th><th>عملیات</th></tr>
            </thead>
            <tbody>
              {(subscriptions?.userSubscriptions || []).map((item) => (
                <tr key={item.userId}>
                  <td>{item.user?.name || item.userId}</td>
                  <td>{item.plan?.name || item.planId}</td>
                  <td>{item.status === 'active' ? 'فعال' : item.status}</td>
                  <td>{item.assignedAt || '-'}</td>
                  <td>{item.expiresAt || 'بدون انقضا'}</td>
                  <td>
                    <Button variant="danger" size="sm" onClick={() => void cancelSubscription(item.userId)}>
                      لغو
                    </Button>
                  </td>
                </tr>
              ))}
              {(!subscriptions?.userSubscriptions || subscriptions.userSubscriptions.length === 0) ? (
                <tr><td colSpan={6}>هنوز اشتراک فعالی ثبت نشده است.</td></tr>
              ) : null}
            </tbody>
          </table>
          </div>
        </div>
      ) : null}

      {tab === 'siteSettings' ? (
        <div className="admin-section config-panel">
          <h3>تنظیمات سایت</h3>
          <p className="admin-note">فقط تنظیمات غیرحساس در این بخش ذخیره می‌شوند. کلیدهای API و رمزها همچنان فقط در env می‌مانند.</p>

          {siteSettingsMessage ? (
            <InlineMessage
              text={siteSettingsMessage}
              variant={siteSettingsMessage.includes('موفقیت') ? 'success' : 'error'}
            />
          ) : null}

          {siteSettings ? (
            <>
              <h4>مهمان</h4>
              <FieldGroup direction="row">
                <TextField
                  label="تعداد پیام مهمان"
                  type="number"
                  value={String(siteSettings.settings['guest.message_limit'] ?? 10)}
                  onChange={(e) => updateSiteSetting('guest.message_limit', Number(e.target.value))}
                />
                <TextField
                  label="نشان مودال"
                  value={String(siteSettings.settings['guest.limit_modal.badge_text'] ?? '')}
                  onChange={(e) => updateSiteSetting('guest.limit_modal.badge_text', e.target.value)}
                />
              </FieldGroup>
              <FieldGroup direction="row">
                <TextField
                  label="عنوان مودال"
                  value={String(siteSettings.settings['guest.limit_modal.title'] ?? '')}
                  onChange={(e) => updateSiteSetting('guest.limit_modal.title', e.target.value)}
                />
                <TextField
                  label="تیتر مودال"
                  value={String(siteSettings.settings['guest.limit_modal.heading'] ?? '')}
                  onChange={(e) => updateSiteSetting('guest.limit_modal.heading', e.target.value)}
                />
              </FieldGroup>
              <TextAreaField
                label="متن مودال محدودیت مهمان"
                rows={3}
                value={String(siteSettings.settings['guest.limit_modal.body'] ?? '')}
                onChange={(e) => updateSiteSetting('guest.limit_modal.body', e.target.value)}
              />
              <TextField
                label="متن دکمه مودال"
                value={String(siteSettings.settings['guest.limit_modal.cta'] ?? '')}
                onChange={(e) => updateSiteSetting('guest.limit_modal.cta', e.target.value)}
              />

              <h4>آپلود عکس</h4>
              <FieldGroup direction="row">
                <TextField
                  label="حداکثر حجم عکس (MB)"
                  type="number"
                  value={String(siteSettings.settings['upload.image.max_size_mb'] ?? 5)}
                  onChange={(e) => updateSiteSetting('upload.image.max_size_mb', Number(e.target.value))}
                />
                <TextField
                  label="حداکثر تعداد عکس"
                  type="number"
                  value={String(siteSettings.settings['upload.image.max_files'] ?? 5)}
                  onChange={(e) => updateSiteSetting('upload.image.max_files', Number(e.target.value))}
                />
              </FieldGroup>
              <TextField
                label="فرمت‌های مجاز عکس"
                value={Array.isArray(siteSettings.settings['upload.image.allowed_types']) ? siteSettings.settings['upload.image.allowed_types'].join(', ') : ''}
                onChange={(e) => updateSiteSetting('upload.image.allowed_types', e.target.value.split(',').map((item) => item.trim()).filter(Boolean))}
                helperText="مقادیر مجاز: image/jpeg, image/png, image/webp"
              />

              <h4>هوش مصنوعی</h4>
              <FieldGroup direction="row">
                <TextField
                  label="مدل چت"
                  value={String(siteSettings.settings['ai.chat.model'] ?? '')}
                  onChange={(e) => updateSiteSetting('ai.chat.model', e.target.value)}
                />
                <TextField
                  label="Temperature"
                  type="number"
                  step="0.1"
                  value={String(siteSettings.settings['ai.chat.temperature'] ?? 0.6)}
                  onChange={(e) => updateSiteSetting('ai.chat.temperature', Number(e.target.value))}
                />
                <TextField
                  label="Timeout (ms)"
                  type="number"
                  value={String(siteSettings.settings['ai.chat.timeout_ms'] ?? 30000)}
                  onChange={(e) => updateSiteSetting('ai.chat.timeout_ms', Number(e.target.value))}
                />
              </FieldGroup>

              <h4>ورود و ثبت‌نام</h4>
              <FieldGroup direction="row">
                <TextField
                  label="اعتبار OTP (ثانیه)"
                  type="number"
                  value={String(siteSettings.settings['auth.otp.expire_seconds'] ?? 120)}
                  onChange={(e) => updateSiteSetting('auth.otp.expire_seconds', Number(e.target.value))}
                />
                <TextField
                  label="فاصله ارسال مجدد OTP (ms)"
                  type="number"
                  value={String(siteSettings.settings['auth.otp.resend_cooldown_ms'] ?? 60000)}
                  onChange={(e) => updateSiteSetting('auth.otp.resend_cooldown_ms', Number(e.target.value))}
                />
              </FieldGroup>
              <FieldGroup direction="row">
                <TextField
                  label="حداقل سن"
                  type="number"
                  value={String(siteSettings.settings['auth.validation.age_min'] ?? 8)}
                  onChange={(e) => updateSiteSetting('auth.validation.age_min', Number(e.target.value))}
                />
                <TextField
                  label="حداکثر سن"
                  type="number"
                  value={String(siteSettings.settings['auth.validation.age_max'] ?? 18)}
                  onChange={(e) => updateSiteSetting('auth.validation.age_max', Number(e.target.value))}
                />
              </FieldGroup>

              <FieldGroup direction="row" className="config-actions">
                <Button onClick={() => void saveSiteSettings()} disabled={siteSettingsSaving}>
                  {siteSettingsSaving ? 'در حال ذخیره...' : 'ذخیره تنظیمات سایت'}
                </Button>
              </FieldGroup>
            </>
          ) : (
            <InlineMessage text="در حال بارگذاری تنظیمات سایت..." variant="help" />
          )}
        </div>
      ) : null}

      {tab === 'errors' ? (
        <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>نوع</th><th>Endpoint</th><th>Status</th><th>پیام</th><th>زمان</th></tr></thead>
          <tbody>
            {errors.map((item, index) => (
              <tr key={index}><td>{item.error_type}</td><td>{item.endpoint}</td><td>{item.status_code}</td><td>{item.details}</td><td>{item.created_at}</td></tr>
            ))}
          </tbody>
        </table>
        </div>
      ) : null}

      {tab === 'config' && config ? (
        <div className="admin-section config-panel">
          <h3>پیکربندی سیستم</h3>
          <p className="admin-note">تنظیمات کلی مدل و ویژگی های تجربه کاربری را از این بخش مدیریت کنید.</p>
          <FieldGroup direction="row">
            <TextField
              label="Model"
              value={config.model || ''}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
              helperText="نام مدل مورد استفاده در پاسخ دهی دستیار"
            />
            <TextField
              label="Timeout (ms)"
              type="number"
              value={String(config.timeoutMs || 30000)}
              onChange={(e) => setConfig({ ...config, timeoutMs: Number(e.target.value) })}
              helperText="حداکثر زمان انتظار برای هر درخواست"
            />
          </FieldGroup>
          <h4>ویژگی ها</h4>
          <FieldGroup direction="row" className="config-flags">
            <label><input type="checkbox" checked={Boolean(config.features?.voiceInput)} onChange={(e) => setConfig({ ...config, features: { ...config.features, voiceInput: e.target.checked } })} /> voiceInput</label>
            <label><input type="checkbox" checked={Boolean(config.features?.quickChips)} onChange={(e) => setConfig({ ...config, features: { ...config.features, quickChips: e.target.checked } })} /> quickChips</label>
            <label><input type="checkbox" checked={Boolean(config.features?.practiceMode)} onChange={(e) => setConfig({ ...config, features: { ...config.features, practiceMode: e.target.checked } })} /> practiceMode</label>
          </FieldGroup>
          <FieldGroup direction="row" className="config-actions">
            <Button onClick={() => void saveConfig()} disabled={configSaving}>
              {configSaving ? 'در حال ذخیره...' : 'ذخیره'}
            </Button>
            {configMessage ? <InlineMessage text={configMessage} variant={configMessage.includes('موفقیت') ? 'success' : 'error'} /> : null}
          </FieldGroup>

          <div className="system-prompt-box">
            <h4>سیستم پرامپت (System Prompt)</h4>
            <p className="admin-note">متن دستور پایه مدل در این بخش مدیریت می شود و بدون ری استارت سرور اعمال خواهد شد.</p>
            {systemPromptLoading ? <InlineMessage text="در حال بارگذاری پرامپت..." variant="help" /> : null}
            <TextAreaField
              className="system-prompt-textarea"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="متن سیستم پرامپت را وارد کنید"
              rows={14}
              aria-label="سیستم پرامپت"
            />
            <FieldGroup direction="row" className="config-actions">
              <Button onClick={() => void saveSystemPrompt()} disabled={systemPromptSaving || systemPromptLoading}>
                {systemPromptSaving ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
              </Button>
              {systemPromptMessage ? (
                <InlineMessage text={systemPromptMessage} variant={systemPromptMessage.includes('موفقیت') ? 'success' : 'error'} />
              ) : null}
            </FieldGroup>
          </div>
        </div>
      ) : null}

      {tab === 'audit' ? (
        <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>زمان</th><th>ادمین</th><th>عملیات</th><th>هدف</th><th>جزئیات</th></tr></thead>
          <tbody>
            {logs.map((item, index) => (
              <tr key={index}><td>{item.timestamp}</td><td>{item.adminUsername}</td><td>{item.action}</td><td>{item.target}</td><td>{JSON.stringify(item.details)}</td></tr>
            ))}
          </tbody>
        </table>
        </div>
      ) : null}

      <div className="admin-section admin-report">
        <h3>گزارش CSV</h3>
        <FieldGroup direction="row" className="admin-report-options">
          <label><input type="checkbox" checked={reportOptions.users} onChange={(e) => setReportOptions({ ...reportOptions, users: e.target.checked })} /> لیست کاربران</label>
          <label><input type="checkbox" checked={reportOptions.errors} onChange={(e) => setReportOptions({ ...reportOptions, errors: e.target.checked })} /> خطاها</label>
          <label><input type="checkbox" checked={reportOptions.conversations} onChange={(e) => setReportOptions({ ...reportOptions, conversations: e.target.checked })} /> خلاصه گفتگوها</label>
        </FieldGroup>
        <FieldGroup direction="row" className="admin-report-actions">
          <Button variant="secondary" onClick={downloadReport}>دانلود گزارش</Button>
        </FieldGroup>
      </div>
    </div>
  );
}

export default AdminPanel;
