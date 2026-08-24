import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, InlineMessage } from '../../design-system/components';
import Icon from '../../components/Icon';
import './VideoGenerationsAdmin.css';

type VideoStatus =
  | 'queued'
  | 'routing'
  | 'submitting'
  | 'submitted'
  | 'processing'
  | 'storing'
  | 'provider_status_unknown'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired';

type VideoGenerationListItem = {
  id: string;
  userId: string;
  user: { name: string; phone: string | null; age: number | null };
  status: VideoStatus;
  mode: string;
  prompt: string;
  provider: string | null;
  model: string | null;
  aspectRatio: string | null;
  duration: string | null;
  resolution: string | null;
  hasInput: boolean;
  inputImageUrl: string | null;
  hasResult: boolean;
  resultContentUrl: string | null;
  resultMimeType: string | null;
  resultSizeBytes: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
};

type VideoGenerationDetail = VideoGenerationListItem & {
  internalRequestId: string | null;
  prompts: {
    user: string;
    compiled: string;
    negative: string | null;
    compiledHash: string | null;
  };
  settings: {
    mode: string;
    aspectRatio: string | null;
    duration: string | null;
    quality: string | null;
    resolution: string | null;
    generateAudio: boolean;
  };
  routing: {
    capability: string | null;
    routeId: string | null;
    routeVersion: number | null;
    provider: string | null;
    model: string | null;
    providerModel: string | null;
    attemptState: string | null;
  };
  promptProfile: {
    key: string | null;
    version: number | null;
    compilerVersion: string | null;
  };
  input: {
    url: string;
    mediaId: string | null;
    filename: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    createdAt: string | null;
  } | null;
  result: {
    contentUrl: string;
    downloadUrl: string;
    mimeType: string | null;
    sizeBytes: number | null;
    sha256: string | null;
    originalFilename: string | null;
    storedAt: string | null;
  } | null;
  billing: {
    reservationId: string;
    status: string | null;
    quantity: string | null;
    unit: string | null;
    unitPriceNoa: string | null;
    amountNoa: string | null;
    capturedAt: string | null;
    releasedAt: string | null;
    releaseReason: string | null;
  } | null;
  providerMetrics: {
    estimatedCost: string | null;
    actualCost: string | null;
    costCurrency: string | null;
    processingTimeMs: number | null;
  };
  errors: { code: string | null; message: string | null };
  timeline: Record<string, string | null>;
  diagnostics: {
    providerStatus: string | null;
    pollAttempts: number;
    storageAttempts: number;
    resultStorageStatus: string | null;
  };
};

type ListPayload = {
  items: VideoGenerationListItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: { total: number; succeeded: number; active: number; failed: number };
};

const PAGE_SIZE = 12;
const EMPTY_SUMMARY = { total: 0, succeeded: 0, active: 0, failed: 0 };
const STATUS_LABELS: Record<VideoStatus, string> = {
  queued: 'در صف',
  routing: 'مسیریابی',
  submitting: 'در حال ارسال',
  submitted: 'ارسال‌شده',
  processing: 'در حال ساخت',
  storing: 'ذخیره خروجی',
  provider_status_unknown: 'نیازمند بررسی',
  succeeded: 'تکمیل‌شده',
  failed: 'ناموفق',
  cancelled: 'لغوشده',
  expired: 'منقضی'
};

const TIMELINE_LABELS: Record<string, string> = {
  createdAt: 'ثبت درخواست',
  submittedAt: 'ارسال به ارائه‌دهنده',
  processingAt: 'شروع پردازش',
  resultStoredAt: 'ذخیره خروجی',
  completedAt: 'تکمیل',
  failedAt: 'ثبت خطا',
  cancelledAt: 'لغو',
  expiredAt: 'انقضا',
  updatedAt: 'آخرین بروزرسانی',
  lastPolledAt: 'آخرین بررسی وضعیت'
};

const formatDate = (value: string | null | undefined) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
};

const formatNumber = (value: number | string | null | undefined, maximumFractionDigits = 2) => {
  if (value == null || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat('fa-IR', { maximumFractionDigits }).format(number)
    : String(value);
};

const formatBytes = (value: number | null | undefined) => {
  if (value == null) return '—';
  if (value < 1024) return `${formatNumber(value, 0)} بایت`;
  if (value < 1024 * 1024) return `${formatNumber(value / 1024)} کیلوبایت`;
  return `${formatNumber(value / (1024 * 1024))} مگابایت`;
};

const shortId = (value: string | null | undefined) => {
  if (!value) return '—';
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
};

const parseResponse = async <T,>(response: Response, fallback: string): Promise<T> => {
  if (response.status === 401) {
    window.location.assign('/admin/login');
    throw new Error('نشست مدیریتی منقضی شده است.');
  }
  if (!response.ok) {
    let message = fallback;
    try {
      const payload = await response.json();
      message = payload.message || payload.error || message;
    } catch {
      // Keep the localized fallback.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
};

function StatusBadge({ status }: { status: VideoStatus }) {
  return (
    <span className="video-admin-status" data-status={status}>
      <span aria-hidden="true" />
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function MetricIcon({ kind }: { kind: 'all' | 'success' | 'active' | 'failed' }) {
  if (kind === 'success') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12 4 4 8-9" /></svg>;
  }
  if (kind === 'active') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9" /><path d="M12 7v5l3 2" /></svg>;
  }
  if (kind === 'failed') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4m0 4h.01" /><path d="M10.3 4.2 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m10 9 5 3-5 3V9Z" /></svg>;
}

function MediaPlaceholder({ label }: { label: string }) {
  return (
    <span className="video-admin-media-placeholder">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="3" /><path d="m9 9 6 3-6 3V9Z" /></svg>
      <span>{label}</span>
    </span>
  );
}

function VideoDetailDrawer({
  detail,
  loading,
  error,
  onClose,
  onRetry
}: {
  detail: VideoGenerationDetail | null;
  loading: boolean;
  error: string;
  onClose: () => void;
  onRetry: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), summary, video[controls], [tabindex]:not([tabindex="-1"])'
      )).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  const timeline = useMemo(
    () => Object.entries(detail?.timeline || {}).filter(([, value]) => Boolean(value)),
    [detail]
  );

  return (
    <div className="video-admin-drawer-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        ref={drawerRef}
        className="video-admin-drawer"
        role="dialog"
        aria-modal="true"
        aria-busy={loading}
        aria-labelledby="video-admin-detail-title"
      >
        <header className="video-admin-drawer__header">
          <div>
            <span>جزئیات درخواست</span>
            <h3 id="video-admin-detail-title">{detail ? `ویدیو ${shortId(detail.id)}` : 'در حال دریافت…'}</h3>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="بستن جزئیات ویدیو">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        {loading ? (
          <div className="video-admin-detail-loading" role="status">
            <Icon name="spinner" size={22} className="video-admin-spinner" aria-hidden="true" />
            در حال دریافت همه جزئیات…
          </div>
        ) : null}

        {error ? (
          <div className="video-admin-detail-error" role="alert">
            <InlineMessage variant="error" text={error} />
            <Button type="button" variant="secondary" onClick={onRetry}>تلاش دوباره</Button>
          </div>
        ) : null}

        {detail && !loading ? (
          <div className="video-admin-drawer__body">
            <div className="video-admin-detail-hero">
              <div>
                <StatusBadge status={detail.status} />
                <h4>{detail.user.name || 'کاربر'}</h4>
                <p>{detail.user.phone || 'بدون شماره'}{detail.user.age != null ? ` · ${formatNumber(detail.user.age, 0)} سال` : ''}</p>
              </div>
              <dl>
                <div><dt>شناسه درخواست</dt><dd title={detail.id}>{shortId(detail.id)}</dd></div>
                <div><dt>زمان ثبت</dt><dd>{formatDate(detail.createdAt)}</dd></div>
              </dl>
            </div>

            <section className="video-admin-detail-section" aria-labelledby="video-admin-media-title">
              <div className="video-admin-detail-section__title">
                <span aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="3" /><path d="m9 9 6 3-6 3V9Z" /></svg></span>
                <div><h4 id="video-admin-media-title">ورودی و خروجی</h4><p>تصویری که کاربر فرستاده و نتیجه‌ای که تحویل گرفته است.</p></div>
              </div>
              <div className="video-admin-media-grid">
                <figure>
                  <figcaption>تصویر ورودی کاربر</figcaption>
                  {detail.input ? (
                    <a href={detail.input.url} target="_blank" rel="noreferrer" title="باز کردن تصویر ورودی">
                      <img src={detail.input.url} alt={`تصویر ورودی ویدیوی ${detail.user.name}`} loading="lazy" />
                    </a>
                  ) : <MediaPlaceholder label="این درخواست تصویر ورودی ندارد" />}
                  {detail.input ? <small>{detail.input.filename || 'تصویر ورودی'} · {formatBytes(detail.input.sizeBytes)}</small> : null}
                </figure>
                <figure>
                  <figcaption>ویدیوی خروجی</figcaption>
                  {detail.result ? (
                    <>
                      <video controls playsInline preload="metadata">
                        <source src={detail.result.contentUrl} type={detail.result.mimeType || 'video/mp4'} />
                        مرورگر امکان پخش این ویدیو را ندارد.
                      </video>
                      <a className="video-admin-download" href={detail.result.downloadUrl}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 20h14" /></svg>
                        دانلود خروجی
                      </a>
                    </>
                  ) : <MediaPlaceholder label={detail.status === 'failed' ? 'ساخت ویدیو ناموفق بوده است' : 'خروجی هنوز آماده نیست'} />}
                  {detail.result ? <small>{detail.result.originalFilename || 'ویدیوی خروجی'} · {formatBytes(detail.result.sizeBytes)}</small> : null}
                </figure>
              </div>
            </section>

            <section className="video-admin-detail-section" aria-labelledby="video-admin-prompt-title">
              <div className="video-admin-detail-section__title">
                <span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" /></svg></span>
                <div><h4 id="video-admin-prompt-title">پرامپت‌ها</h4><p>درخواست اصلی کاربر و متن نهایی پردازش‌شده برای Provider.</p></div>
              </div>
              <div className="video-admin-prompt-card video-admin-prompt-card--primary">
                <span>پرامپت کاربر</span>
                <p>{detail.prompts.user || '—'}</p>
              </div>
              <details className="video-admin-prompt-details">
                <summary>نمایش پرامپت نهایی ارسال‌شده</summary>
                <div className="video-admin-prompt-card">
                  <p>{detail.prompts.compiled || '—'}</p>
                </div>
                {detail.prompts.negative ? (
                  <div className="video-admin-prompt-card">
                    <span>پرامپت منفی</span>
                    <p>{detail.prompts.negative}</p>
                  </div>
                ) : null}
              </details>
            </section>

            <section className="video-admin-detail-section" aria-labelledby="video-admin-settings-title">
              <div className="video-admin-detail-section__title">
                <span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" /><path d="M19 12h2M3 12h2M12 3v2M12 19v2" /></svg></span>
                <div><h4 id="video-admin-settings-title">تنظیمات ساخت</h4><p>مشخصات خروجی و مسیر پردازش درخواست.</p></div>
              </div>
              <dl className="video-admin-definition-grid">
                <div><dt>حالت</dt><dd>{detail.settings.mode === 'image-to-video' ? 'تصویر به ویدیو' : 'متن به ویدیو'}</dd></div>
                <div><dt>نسبت تصویر</dt><dd>{detail.settings.aspectRatio || '—'}</dd></div>
                <div><dt>مدت</dt><dd>{detail.settings.duration ? `${formatNumber(detail.settings.duration, 0)} ثانیه` : '—'}</dd></div>
                <div><dt>رزولوشن</dt><dd>{detail.settings.resolution || '—'}</dd></div>
                <div><dt>صدا</dt><dd>{detail.settings.generateAudio ? 'فعال' : 'بدون صدا'}</dd></div>
                <div><dt>سبک</dt><dd>{detail.promptProfile.key || '—'}{detail.promptProfile.version ? ` · نسخه ${formatNumber(detail.promptProfile.version, 0)}` : ''}</dd></div>
                <div><dt>Provider</dt><dd>{detail.routing.provider || '—'}</dd></div>
                <div><dt>مدل</dt><dd>{detail.routing.model || detail.routing.providerModel || '—'}</dd></div>
              </dl>
            </section>

            <section className="video-admin-detail-section" aria-labelledby="video-admin-billing-title">
              <div className="video-admin-detail-section__title">
                <span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 9h18M6 5h12a3 3 0 0 1 3 3v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a3 3 0 0 1 3-3Z" /></svg></span>
                <div><h4 id="video-admin-billing-title">اعتبار و عملکرد</h4><p>مقدار نوآ و شاخص‌های اجرای Provider.</p></div>
              </div>
              <dl className="video-admin-definition-grid">
                <div><dt>هزینه کاربر</dt><dd>{detail.billing?.amountNoa ? `${formatNumber(detail.billing.amountNoa, 6)} نوآ` : '—'}</dd></div>
                <div><dt>وضعیت اعتبار</dt><dd>{detail.billing?.status || '—'}</dd></div>
                <div><dt>هزینه Provider</dt><dd>{detail.providerMetrics.actualCost ? `${formatNumber(detail.providerMetrics.actualCost, 6)} ${detail.providerMetrics.costCurrency || ''}` : '—'}</dd></div>
                <div><dt>زمان پردازش</dt><dd>{detail.providerMetrics.processingTimeMs != null ? `${formatNumber(detail.providerMetrics.processingTimeMs / 1000)} ثانیه` : '—'}</dd></div>
                <div><dt>دفعات Poll</dt><dd>{formatNumber(detail.diagnostics.pollAttempts, 0)}</dd></div>
                <div><dt>دفعات ذخیره</dt><dd>{formatNumber(detail.diagnostics.storageAttempts, 0)}</dd></div>
              </dl>
            </section>

            {detail.errors.code || detail.errors.message ? (
              <section className="video-admin-detail-section video-admin-detail-section--error" aria-labelledby="video-admin-error-title">
                <div className="video-admin-detail-section__title">
                  <span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 9v4m0 4h.01" /><path d="M10.3 4.2 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" /></svg></span>
                  <div><h4 id="video-admin-error-title">خطای ثبت‌شده</h4><p>پیام امن ذخیره‌شده برای عیب‌یابی.</p></div>
                </div>
                <code>{detail.errors.code || 'VIDEO_GENERATION_FAILED'}</code>
                <p>{detail.errors.message || 'جزئیات بیشتری ثبت نشده است.'}</p>
              </section>
            ) : null}

            <section className="video-admin-detail-section" aria-labelledby="video-admin-timeline-title">
              <div className="video-admin-detail-section__title">
                <span aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg></span>
                <div><h4 id="video-admin-timeline-title">خط زمانی</h4><p>رویدادهای ثبت‌شده از شروع تا پایان درخواست.</p></div>
              </div>
              <ol className="video-admin-timeline">
                {timeline.map(([key, value]) => (
                  <li key={key}>
                    <span aria-hidden="true" />
                    <div><strong>{TIMELINE_LABELS[key] || key}</strong><time>{formatDate(value)}</time></div>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export default function VideoGenerationsAdmin() {
  const [items, setItems] = useState<VideoGenerationListItem[]>([]);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VideoGenerationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const requestRef = useRef(0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = useCallback(async (nextPage = 1, nextQuery = query, nextStatus = status) => {
    const request = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(PAGE_SIZE)
      });
      if (nextQuery.trim()) params.set('q', nextQuery.trim());
      if (nextStatus !== 'all') params.set('status', nextStatus);
      const payload = await parseResponse<ListPayload>(
        await fetch(`/api/admin/video-generations?${params.toString()}`, { credentials: 'include' }),
        'فهرست ویدیوها دریافت نشد.'
      );
      if (request !== requestRef.current) return;
      setItems(payload.items || []);
      setSummary(payload.summary || EMPTY_SUMMARY);
      setTotal(Number(payload.total || 0));
      setPage(Number(payload.page || nextPage));
    } catch (cause) {
      if (request === requestRef.current) setError(cause instanceof Error ? cause.message : 'اتصال به سرور برقرار نشد.');
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [query, status]);

  useEffect(() => {
    void load(1);
  }, []); // Initial fetch only; filters are applied explicitly.

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError('');
    try {
      const payload = await parseResponse<VideoGenerationDetail>(
        await fetch(`/api/admin/video-generations/${encodeURIComponent(id)}`, { credentials: 'include' }),
        'جزئیات این ویدیو دریافت نشد.'
      );
      setDetail(payload);
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : 'جزئیات این ویدیو دریافت نشد.');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const openDetail = (id: string) => {
    setSelectedId(id);
    setDetail(null);
    void loadDetail(id);
  };

  const closeDetail = useCallback(() => {
    setSelectedId(null);
    setDetail(null);
    setDetailError('');
  }, []);

  const applyFilters = (event: FormEvent) => {
    event.preventDefault();
    void load(1, query, status);
  };

  const metrics = [
    { key: 'all' as const, label: 'همه درخواست‌ها', value: summary.total },
    { key: 'success' as const, label: 'تکمیل‌شده', value: summary.succeeded },
    { key: 'active' as const, label: 'در حال پردازش', value: summary.active },
    { key: 'failed' as const, label: 'ناموفق', value: summary.failed }
  ];

  return (
    <div className="video-admin">
      <div className="video-admin__header">
        <div>
          <span className="video-admin__eyebrow">کتابخانه خروجی‌ها</span>
          <h3>ویدیوهای ساخته‌شده</h3>
          <p>مشاهده کاربر، پرامپت، تصویر ورودی، تنظیمات اجرا و خروجی نهایی هر درخواست.</p>
        </div>
        <Button type="button" variant="secondary" disabled={loading} onClick={() => void load(page)}>
          {loading ? 'در حال بروزرسانی…' : 'بروزرسانی'}
        </Button>
      </div>

      <div className="video-admin-metrics" aria-label="خلاصه وضعیت ویدیوها">
        {metrics.map((metric) => (
          <article key={metric.key} data-kind={metric.key}>
            <span><MetricIcon kind={metric.key} /></span>
            <div><strong>{formatNumber(metric.value, 0)}</strong><small>{metric.label}</small></div>
          </article>
        ))}
      </div>

      <form className="video-admin-filters" role="search" onSubmit={applyFilters}>
        <label>
          <span>جستجو</span>
          <div className="video-admin-search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="نام، موبایل، شناسه یا متن پرامپت"
            />
          </div>
        </label>
        <label>
          <span>وضعیت</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">همه وضعیت‌ها</option>
            {Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <Button type="submit" disabled={loading}>اعمال فیلتر</Button>
      </form>

      {error ? (
        <div className="video-admin-error" role="alert">
          <InlineMessage variant="error" text={error} />
          <Button type="button" variant="secondary" size="sm" onClick={() => void load(page)}>تلاش دوباره</Button>
        </div>
      ) : null}

      <div className="video-admin-list-meta" aria-live="polite">
        <span>{formatNumber(total, 0)} درخواست</span>
        <span>صفحه {formatNumber(page, 0)} از {formatNumber(totalPages, 0)}</span>
      </div>

      {loading && items.length === 0 ? (
        <div className="video-admin-skeletons" role="status" aria-label="در حال دریافت ویدیوها">
          {Array.from({ length: 5 }).map((_, index) => <span key={index} />)}
        </div>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <div className="video-admin-empty">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="3" /><path d="m9 9 6 3-6 3V9Z" /></svg>
          <h4>ویدیویی پیدا نشد</h4>
          <p>فیلترها را تغییر بده یا فهرست را دوباره بروزرسانی کن.</p>
          <Button type="button" variant="secondary" onClick={() => {
            setQuery('');
            setStatus('all');
            void load(1, '', 'all');
          }}>پاک کردن فیلترها</Button>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="video-admin-table-wrap">
          <table className="video-admin-table">
            <thead>
              <tr>
                <th scope="col">ورودی</th>
                <th scope="col">کاربر و پرامپت</th>
                <th scope="col">وضعیت</th>
                <th scope="col">تنظیمات</th>
                <th scope="col">زمان</th>
                <th scope="col"><span className="visually-hidden">عملیات</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td data-label="ورودی">
                    <div className="video-admin-thumb">
                      {item.inputImageUrl ? (
                        <img src={item.inputImageUrl} alt="" loading="lazy" />
                      ) : <MediaPlaceholder label="بدون تصویر" />}
                      {item.hasResult ? <span title="خروجی آماده است"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 12 3 3 7-7" /></svg></span> : null}
                    </div>
                  </td>
                  <td data-label="کاربر و پرامپت">
                    <div className="video-admin-user">
                      <strong>{item.user.name || 'کاربر'}</strong>
                      <small>{item.user.phone || shortId(item.userId)}</small>
                    </div>
                    <p className="video-admin-prompt" title={item.prompt}>{item.prompt || 'بدون پرامپت'}</p>
                  </td>
                  <td data-label="وضعیت"><StatusBadge status={item.status} /></td>
                  <td data-label="تنظیمات">
                    <div className="video-admin-specs">
                      <span>{item.duration ? `${formatNumber(item.duration, 0)} ثانیه` : '—'}</span>
                      <span>{item.aspectRatio || '—'}</span>
                      <small>{item.provider || '—'} · {item.model || '—'}</small>
                    </div>
                  </td>
                  <td data-label="زمان"><time>{formatDate(item.createdAt)}</time></td>
                  <td>
                    <Button type="button" variant="secondary" size="sm" onClick={() => openDetail(item.id)}>
                      مشاهده جزئیات
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {totalPages > 1 ? (
        <nav className="video-admin-pagination" aria-label="صفحه‌بندی ویدیوها">
          <Button type="button" variant="secondary" size="sm" disabled={loading || page <= 1} onClick={() => void load(page - 1)}>صفحه قبل</Button>
          <span>{formatNumber(page, 0)} / {formatNumber(totalPages, 0)}</span>
          <Button type="button" variant="secondary" size="sm" disabled={loading || page >= totalPages} onClick={() => void load(page + 1)}>صفحه بعد</Button>
        </nav>
      ) : null}

      {selectedId ? (
        <VideoDetailDrawer
          detail={detail}
          loading={detailLoading}
          error={detailError}
          onClose={closeDetail}
          onRetry={() => void loadDetail(selectedId)}
        />
      ) : null}
    </div>
  );
}
