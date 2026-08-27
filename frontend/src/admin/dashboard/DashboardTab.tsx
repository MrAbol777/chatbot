import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { Button, InlineMessage } from '../../design-system/components';
import type { AdminTab, DashboardStats, MonitoringRange, MonitoringStatus } from '../admin.types';
import { handleAdminResponse } from '../admin.types';
import { useAdminCachedData } from '../adminCache';
import './DashboardTab.css';

const RANGE_OPTIONS: Array<{ value: MonitoringRange; label: string }> = [
  { value: '1h', label: '۱ ساعت' },
  { value: '24h', label: '۲۴ ساعت' },
  { value: '7d', label: '۷ روز' },
  { value: '30d', label: '۳۰ روز' }
];

const AUTO_REFRESH_OPTIONS = [
  { value: 0, label: 'خاموش' },
  { value: 30, label: 'هر ۳۰ ثانیه' },
  { value: 60, label: 'هر ۱ دقیقه' }
];

const STATUS_LABELS: Record<MonitoringStatus, string> = {
  healthy: 'سالم',
  warning: 'نیازمند توجه',
  critical: 'اختلال',
  disabled: 'غیرفعال'
};

const ACTION_LABELS: Record<string, string> = {
  text_chat: 'گفت‌وگو',
  image_generation: 'تصویر',
  video_generation: 'ویدیو',
  image_edit: 'ویرایش تصویر'
};

const QUEUE_LABELS: Record<string, string> = {
  queue: 'در صف',
  queued: 'در صف',
  waiting: 'منتظر',
  running: 'در حال اجرا',
  routing: 'مسیریابی',
  submitting: 'در حال ارسال',
  submitted: 'ارسال‌شده',
  processing: 'در حال پردازش',
  storing: 'در حال ذخیره',
  provider_status_unknown: 'وضعیت نامشخص',
  completed: 'تکمیل‌شده',
  succeeded: 'موفق',
  error: 'خطا',
  failed: 'ناموفق',
  cancelled: 'لغوشده',
  expired: 'منقضی'
};

const faNumber = (value: number, maximumFractionDigits = 0) =>
  new Intl.NumberFormat('fa-IR', { maximumFractionDigits }).format(Number.isFinite(value) ? value : 0);

const formatDuration = (value: number) => {
  if (value < 1000) return `${faNumber(value)} ms`;
  if (value < 60_000) return `${faNumber(value / 1000, 1)} ثانیه`;
  return `${faNumber(value / 60_000, 1)} دقیقه`;
};

const formatDateTime = (value?: string) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fa-IR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
};

const formatChartTime = (value: string, range: MonitoringRange) => {
  const date = new Date(value);
  return new Intl.DateTimeFormat('fa-IR', range === '7d' || range === '30d'
    ? { month: 'short', day: 'numeric' }
    : { hour: '2-digit', minute: '2-digit' }).format(date);
};

const statusClass = (status: MonitoringStatus) => `monitoring-status monitoring-status--${status}`;

type DashboardTabProps = {
  onNavigate?: (tab: AdminTab) => void;
};

type KpiCardProps = {
  label: string;
  value: string;
  change?: number;
  tone: 'primary' | 'success' | 'danger' | 'warning' | 'neutral';
  inverseTrend?: boolean;
  helper: string;
};

function KpiCard({ label, value, change = 0, tone, inverseTrend = false, helper }: KpiCardProps) {
  const positive = inverseTrend ? change <= 0 : change >= 0;
  return (
    <article className={`monitoring-kpi monitoring-kpi--${tone}`}>
      <div className="monitoring-kpi__head">
        <span>{label}</span>
        <span className={`monitoring-trend ${positive ? 'is-positive' : 'is-negative'}`} dir="ltr">
          {change > 0 ? '+' : ''}{faNumber(change, 1)}%
        </span>
      </div>
      <strong dir="ltr">{value}</strong>
      <small>{helper}</small>
    </article>
  );
}

export default function DashboardTab({ onNavigate }: DashboardTabProps) {
  const [range, setRange] = useState<MonitoringRange>('24h');
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState(30);

  const fetchDashboard = useCallback(async () => {
    const response = await fetch(`/api/admin/monitoring/overview?range=${range}`, { credentials: 'include' });
    const result = await handleAdminResponse(response, 'بارگذاری اطلاعات مرکز پایش ناموفق بود.');
    if (!result.ok) throw new Error('دریافت اطلاعات پایش ناموفق بود');
    return result.data as DashboardStats;
  }, [range]);

  const { data: dashboard, loading, error, refresh } = useAdminCachedData<DashboardStats>(
    `admin:monitoring:${range}`,
    fetchDashboard,
    20_000
  );

  useEffect(() => {
    if (!autoRefreshSeconds) return undefined;
    const timer = window.setInterval(() => {
      void refresh(true).catch(() => undefined);
    }, autoRefreshSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefreshSeconds, refresh]);

  const traffic = useMemo(() => (dashboard?.traffic || []).map((item) => ({
    ...item,
    label: formatChartTime(item.timestamp, range)
  })), [dashboard?.traffic, range]);

  const noaUsage = useMemo(() => (dashboard?.noa?.captured || []).map((item) => ({
    ...item,
    label: ACTION_LABELS[item.actionKey] || item.actionKey
  })), [dashboard?.noa?.captured]);

  const activeImageQueue = dashboard?.queues
    ? Object.entries(dashboard.queues.images).filter(([status]) => ['queue', 'waiting', 'running'].includes(status))
    : [];
  const activeVideoQueue = dashboard?.queues
    ? Object.entries(dashboard.queues.videos).filter(([status]) => [
      'queued', 'routing', 'submitting', 'submitted', 'processing', 'storing', 'provider_status_unknown'
    ].includes(status))
    : [];

  return (
    <div className="monitoring-center" aria-busy={loading}>
      <section className="monitoring-toolbar" aria-label="کنترل‌های مرکز پایش">
        <div className="monitoring-toolbar__intro">
          <span className="monitoring-live-dot" aria-hidden="true" />
          <div>
            <h3>مرکز پایش دانوآ</h3>
            <p>سلامت سرویس‌ها، کیفیت AI، صف عملیات و مصرف مالی در یک نما</p>
          </div>
        </div>
        <div className="monitoring-toolbar__controls">
          <label>
            <span>بازه</span>
            <select value={range} onChange={(event) => setRange(event.target.value as MonitoringRange)}>
              {RANGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            <span>بروزرسانی خودکار</span>
            <select value={autoRefreshSeconds} onChange={(event) => setAutoRefreshSeconds(Number(event.target.value))}>
              {AUTO_REFRESH_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <Button variant="secondary" size="sm" onClick={() => void refresh(true)} disabled={loading}>
            {loading ? 'در حال بروزرسانی' : 'بروزرسانی الآن'}
          </Button>
        </div>
      </section>

      {error ? <InlineMessage text={error} variant="error" /> : null}

      {loading && !dashboard ? (
        <div className="monitoring-skeleton" aria-label="در حال بارگذاری مرکز پایش">
          <div /><div /><div /><div /><div /><div />
        </div>
      ) : null}

      {dashboard ? (
        <>
          <div className="monitoring-context-line">
            <span className={`monitoring-environment monitoring-environment--${dashboard.meta.environment}`}>
              {dashboard.meta.environment === 'production' ? 'Production' : 'Development'}
            </span>
            <span>آخرین بروزرسانی: {formatDateTime(dashboard.meta.generatedAt)}</span>
            {dashboard.meta.requestMetricsSampled ? <span className="monitoring-sample-note">نمایش نمونه ۵۰هزار درخواست اخیر</span> : null}
          </div>

          <section className="monitoring-health-grid" aria-label="سلامت سرویس‌ها">
            {dashboard.health.map((item) => (
              <article key={item.key} className="monitoring-health-card">
                <div className="monitoring-health-card__title">
                  <span className={statusClass(item.status)} aria-hidden="true" />
                  <strong>{item.label}</strong>
                </div>
                <span>{STATUS_LABELS[item.status]}</span>
                <small dir={item.detail.includes('ms') ? 'ltr' : undefined}>{item.detail}</small>
              </article>
            ))}
          </section>

          <section className="monitoring-kpi-grid" aria-label="شاخص‌های کلیدی">
            <KpiCard label="درخواست‌های API" value={faNumber(dashboard.kpis.requests.value)} change={dashboard.kpis.requests.changePct} tone="primary" helper="در بازه انتخاب‌شده" />
            <KpiCard label="نرخ موفقیت" value={`${faNumber(dashboard.kpis.successRate.value, 1)}%`} change={dashboard.kpis.successRate.changePct} tone="success" helper="پاسخ‌های بدون خطا" />
            <KpiCard label="خطای درخواست" value={`${faNumber(dashboard.kpis.errorRate.value, 1)}%`} change={dashboard.kpis.errorRate.changePct} tone="danger" inverseTrend helper="مقایسه با دوره قبل" />
            <KpiCard label="p95 زمان پاسخ" value={formatDuration(dashboard.kpis.p95LatencyMs.value)} change={dashboard.kpis.p95LatencyMs.changePct} tone="warning" inverseTrend helper="کندترین ۵ درصد" />
            <KpiCard label="کاربر فعال" value={faNumber(dashboard.kpis.activeUsers.value)} change={dashboard.kpis.activeUsers.changePct} tone="neutral" helper={`از ${faNumber(dashboard.kpis.totalUsers)} کاربر`} />
            <KpiCard label="مصرف نوآ" value={faNumber(dashboard.kpis.noaSpent.value, 2)} change={dashboard.kpis.noaSpent.changePct} tone="primary" inverseTrend helper={`${faNumber(dashboard.kpis.tokens.value)} توکن ثبت‌شده`} />
          </section>

          <section className="monitoring-chart-grid">
            <article className="monitoring-card monitoring-card--wide">
              <div className="monitoring-card__header">
                <div>
                  <h4>ترافیک و نرخ خطا</h4>
                  <p>روند درخواست‌ها با تفکیک خطا در بازه انتخاب‌شده</p>
                </div>
                <span className="monitoring-card__metric">{faNumber(dashboard.kpis.requests.value)} درخواست</span>
              </div>
              <div className="monitoring-chart" role="img" aria-label="نمودار روند درخواست‌ها و نرخ خطا">
                <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={260}>
                  <ComposedChart data={traffic}>
                    <CartesianGrid stroke="var(--monitoring-grid)" vertical={false} />
                    <XAxis dataKey="label" stroke="var(--monitoring-muted)" tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis yAxisId="requests" stroke="var(--monitoring-muted)" tickLine={false} axisLine={false} allowDecimals={false} />
                    <YAxis yAxisId="errors" orientation="left" stroke="var(--monitoring-danger)" tickLine={false} axisLine={false} unit="%" />
                    <Tooltip contentStyle={{ background: 'var(--monitoring-surface)', borderColor: 'var(--monitoring-border)', borderRadius: 10 }} />
                    <Legend />
                    <Area yAxisId="requests" type="monotone" dataKey="requests" name="درخواست" fill="var(--monitoring-primary-soft)" stroke="var(--monitoring-primary)" strokeWidth={2} isAnimationActive={false} />
                    <Line yAxisId="errors" type="monotone" dataKey="errorRate" name="نرخ خطا (%)" stroke="var(--monitoring-danger)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="monitoring-card">
              <div className="monitoring-card__header">
                <div>
                  <h4>زمان پاسخ قابلیت‌ها</h4>
                  <p>مقایسه p50 و p95 بر حسب میلی‌ثانیه</p>
                </div>
              </div>
              <div className="monitoring-chart" role="img" aria-label="نمودار زمان پاسخ قابلیت‌های هوش مصنوعی">
                <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={260}>
                  <BarChart data={dashboard.capabilities}>
                    <CartesianGrid stroke="var(--monitoring-grid)" vertical={false} />
                    <XAxis dataKey="label" stroke="var(--monitoring-muted)" tickLine={false} axisLine={false} />
                    <YAxis stroke="var(--monitoring-muted)" tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ background: 'var(--monitoring-surface)', borderColor: 'var(--monitoring-border)', borderRadius: 10 }} formatter={(value) => formatDuration(Number(value || 0))} />
                    <Legend />
                    <Bar dataKey="p50LatencyMs" name="p50" fill="var(--monitoring-secondary)" radius={[5, 5, 0, 0]} isAnimationActive={false} />
                    <Bar dataKey="p95LatencyMs" name="p95" fill="var(--monitoring-primary)" radius={[5, 5, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="monitoring-card">
              <div className="monitoring-card__header">
                <div>
                  <h4>مصرف نوآ</h4>
                  <p>اعتبار مصرف‌شده بر اساس قابلیت</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => onNavigate?.('noaFinance')}>جزئیات مالی</Button>
              </div>
              {noaUsage.length > 0 ? (
                <div className="monitoring-chart" role="img" aria-label="نمودار مصرف نوآ بر اساس قابلیت">
                  <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={260}>
                    <BarChart data={noaUsage} layout="vertical" margin={{ right: 16 }}>
                      <CartesianGrid stroke="var(--monitoring-grid)" horizontal={false} />
                      <XAxis type="number" stroke="var(--monitoring-muted)" tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="label" width={76} stroke="var(--monitoring-muted)" tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ background: 'var(--monitoring-surface)', borderColor: 'var(--monitoring-border)', borderRadius: 10 }} />
                      <Bar dataKey="amount" name="نوآ" fill="var(--monitoring-secondary)" radius={[0, 6, 6, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <div className="monitoring-empty">در این بازه مصرف نوآ ثبت نشده است.</div>}
            </article>
          </section>

          <section className="monitoring-operations-grid">
            <article className="monitoring-card monitoring-card--providers">
              <div className="monitoring-card__header">
                <div>
                  <h4>کیفیت Providerها</h4>
                  <p>موفقیت، latency و وضعیت مدار سرویس‌ها</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => onNavigate?.('aiRouting')}>مدیریت Providerها</Button>
              </div>
              <div className="monitoring-table-wrap">
                <table className="monitoring-table">
                  <thead><tr><th>Provider / Model</th><th>قابلیت</th><th>درخواست</th><th>موفقیت</th><th>میانگین</th><th>مدار</th></tr></thead>
                  <tbody>
                    {dashboard.providers.map((item) => (
                      <tr key={`${item.provider}-${item.model}-${item.capability}`}>
                        <td><strong dir="ltr">{item.provider}</strong><small dir="ltr">{item.model}</small></td>
                        <td>{ACTION_LABELS[item.capability] || item.capability}</td>
                        <td>{faNumber(item.total)}</td>
                        <td><span className={item.successRate >= 95 ? 'monitoring-good' : 'monitoring-bad'}>{faNumber(item.successRate, 1)}%</span></td>
                        <td dir="ltr">{formatDuration(item.averageLatencyMs)}</td>
                        <td><span className={`monitoring-circuit monitoring-circuit--${item.circuitState.toLowerCase()}`}>{item.circuitState}</span></td>
                      </tr>
                    ))}
                    {dashboard.providers.length === 0 ? <tr><td colSpan={6}>هنوز داده‌ای برای Providerها ثبت نشده است.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="monitoring-card">
              <div className="monitoring-card__header"><div><h4>صف عملیات</h4><p>وضعیت جاری کارهای تصویر و ویدیو</p></div></div>
              <div className="monitoring-queue-group">
                <div className="monitoring-queue-group__title"><strong>تصویر</strong><Button variant="ghost" size="sm" onClick={() => onNavigate?.('imageGenerations')}>مشاهده</Button></div>
                <div className="monitoring-queue-pills">
                  {activeImageQueue.map(([status, total]) => <span key={status}>{QUEUE_LABELS[status] || status}<strong>{faNumber(total)}</strong></span>)}
                  {activeImageQueue.length === 0 ? <small>صف فعالی وجود ندارد.</small> : null}
                </div>
              </div>
              <div className="monitoring-queue-group">
                <div className="monitoring-queue-group__title"><strong>ویدیو</strong><Button variant="ghost" size="sm" onClick={() => onNavigate?.('videoGenerations')}>مشاهده</Button></div>
                <div className="monitoring-queue-pills">
                  {activeVideoQueue.map(([status, total]) => <span key={status}>{QUEUE_LABELS[status] || status}<strong>{faNumber(total)}</strong></span>)}
                  {activeVideoQueue.length === 0 ? <small>صف فعالی وجود ندارد.</small> : null}
                </div>
              </div>
              <div className="monitoring-stale-summary">
                <span>تصویر گیرکرده <strong>{faNumber(dashboard.queues.staleImages)}</strong></span>
                <span>ویدیوی گیرکرده <strong>{faNumber(dashboard.queues.staleVideos)}</strong></span>
                <span>رزرو نوآ باز <strong>{faNumber(dashboard.noa.unresolved.total)}</strong></span>
              </div>
            </article>
          </section>

          <section className="monitoring-bottom-grid">
            <article className="monitoring-card">
              <div className="monitoring-card__header"><div><h4>هشدارهای فعال</h4><p>مواردی که به اقدام مدیریتی نیاز دارند</p></div><span className="monitoring-alert-count">{faNumber(dashboard.alerts.length)}</span></div>
              <div className="monitoring-alert-list">
                {dashboard.alerts.map((alert) => (
                  <button key={alert.id} type="button" className={`monitoring-alert monitoring-alert--${alert.severity}`} onClick={() => onNavigate?.(alert.target)}>
                    <span className="monitoring-alert__marker" aria-hidden="true" />
                    <span><strong>{alert.title}</strong><small>{alert.description}</small></span>
                    <span className="monitoring-alert__action">بررسی</span>
                  </button>
                ))}
                {dashboard.alerts.length === 0 ? <div className="monitoring-empty monitoring-empty--success">هشدار فعالی وجود ندارد؛ وضعیت سامانه پایدار است.</div> : null}
              </div>
            </article>

            <article className="monitoring-card">
              <div className="monitoring-card__header"><div><h4>آخرین خطاها</h4><p>رخدادهای ثبت‌شده در بازه جاری</p></div><Button variant="ghost" size="sm" onClick={() => onNavigate?.('errors')}>همه خطاها</Button></div>
              <div className="monitoring-error-list">
                {dashboard.recentErrors.map((item, index) => (
                  <div key={`${item.type}-${item.createdAt}-${index}`}>
                    <span className="monitoring-error-code" dir="ltr">{item.statusCode || 'ERR'}</span>
                    <span><strong dir="ltr">{item.type}</strong><small dir="ltr">{item.endpoint || 'internal'}</small></span>
                    <time>{formatDateTime(item.createdAt)}</time>
                  </div>
                ))}
                {dashboard.recentErrors.length === 0 ? <div className="monitoring-empty monitoring-empty--success">خطایی در این بازه ثبت نشده است.</div> : null}
              </div>
            </article>
          </section>

          <footer className="monitoring-runtime">
            <span>Node {dashboard.process.nodeVersion}</span>
            <span>RSS: {faNumber(dashboard.process.rssMb, 1)} MB</span>
            <span>Heap: {faNumber(dashboard.process.heapUsedMb, 1)} MB</span>
            <span>CPU: {faNumber(dashboard.process.cpuPercent, 1)}%</span>
            <span>Event Loop: {faNumber(dashboard.process.eventLoopUtilizationPercent, 1)}%</span>
            <span>Uptime: {formatDuration(dashboard.process.uptimeSeconds * 1000)}</span>
          </footer>
        </>
      ) : null}
    </div>
  );
}
