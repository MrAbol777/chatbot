import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { Button, Card, Dialog, FieldGroup, InlineMessage, TextAreaField, TextField, useNotification } from '../../design-system/components';
import Icon from '../../components/Icon';
import { handleAdminResponse } from '../admin.types';
import './BroadcastMessages.css';

type AudienceType = 'all' | 'some' | 'one';
type DisplayMode = 'toast' | 'notification' | 'dismissible_modal' | 'required_modal' | 'modal_and_notification';
type SendMode = 'now' | 'scheduled' | 'draft';

type RecipientUser = {
  userId: string;
  name: string;
  phone: string;
  age: number;
};

type BroadcastMessage = {
  id: string;
  title: string;
  message: string;
  imageUrl?: string | null;
  actionUrl?: string | null;
  actionLabel?: string | null;
  displayMode: DisplayMode;
  priority: 'low' | 'normal' | 'high';
  audienceType: AudienceType;
  status: 'draft' | 'scheduled' | 'published' | 'cancelled' | 'expired';
  scheduledAt?: string | null;
  expiresAt?: string | null;
  createdBy: string;
  createdAt: string;
  publishedAt?: string | null;
  recipientCount: number;
  viewedCount: number;
  clickedCount: number;
  acknowledgedCount: number;
};

const DISPLAY_MODES: Array<{ value: DisplayMode; label: string; description: string }> = [
  { value: 'toast', label: 'اعلان موقت', description: 'بالای صفحه نمایش داده می‌شود و خودکار بسته می‌شود.' },
  { value: 'notification', label: 'اعلان ماندگار', description: 'در مرکز اعلان‌ها می‌ماند تا کاربر آن را ببیند.' },
  { value: 'dismissible_modal', label: 'مودال قابل‌بستن', description: 'پیام در پنجره‌ای برجسته با امکان بستن نمایش داده می‌شود.' },
  { value: 'required_modal', label: 'مودال اجباری', description: 'کاربر باید پیام را تأیید کند تا پنجره بسته شود.' },
  { value: 'modal_and_notification', label: 'مودال + اعلان', description: 'هم‌زمان به‌صورت مودال و اعلان ماندگار نمایش داده می‌شود.' }
];

const STATUS_LABELS: Record<BroadcastMessage['status'], string> = {
  draft: 'پیش‌نویس',
  scheduled: 'زمان‌بندی‌شده',
  published: 'ارسال‌شده',
  cancelled: 'لغوشده',
  expired: 'منقضی‌شده'
};

const AUDIENCE_LABELS: Record<AudienceType, string> = {
  all: 'همه کاربران',
  some: 'بعضی کاربران',
  one: 'یک کاربر'
};

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
};

const getApiError = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

export default function BroadcastMessagesTab() {
  const { notify, confirm } = useNotification();
  const [view, setView] = useState<'compose' | 'history'>('compose');
  const [audienceType, setAudienceType] = useState<AudienceType>('all');
  const [selectedUsers, setSelectedUsers] = useState<Record<string, RecipientUser>>({});
  const [userSearch, setUserSearch] = useState('');
  const [users, setUsers] = useState<RecipientUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [actionUrl, setActionUrl] = useState('');
  const [actionLabel, setActionLabel] = useState('');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('notification');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [sendMode, setSendMode] = useState<SendMode>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [history, setHistory] = useState<BroadcastMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyStatus, setHistoryStatus] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [details, setDetails] = useState<BroadcastMessage | null>(null);

  const selectedUserList = useMemo(() => Object.values(selectedUsers), [selectedUsers]);
  const historyPages = Math.max(1, Math.ceil(historyTotal / 10));

  const loadUsers = async () => {
    setUsersLoading(true);
    try {
      const params = new URLSearchParams({ q: userSearch.trim(), page: '1', pageSize: '30' });
      const response = await fetch(`/api/admin/broadcast-messages/users?${params.toString()}`, { credentials: 'include' });
      const result = await handleAdminResponse(response, 'بارگذاری کاربران ناموفق بود.');
      if (result.ok) setUsers((result.data?.items || []) as RecipientUser[]);
    } catch (error) {
      notify.error(getApiError(error, 'بارگذاری کاربران ناموفق بود.'));
    } finally {
      setUsersLoading(false);
    }
  };

  useEffect(() => {
    if (audienceType === 'all') return;
    const timer = window.setTimeout(() => void loadUsers(), 250);
    return () => window.clearTimeout(timer);
  }, [audienceType, userSearch]);

  const loadHistory = async (page = historyPage) => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '10' });
      if (historyStatus) params.set('status', historyStatus);
      const response = await fetch(`/api/admin/broadcast-messages?${params.toString()}`, { credentials: 'include' });
      const result = await handleAdminResponse(response, 'بارگذاری پیام‌ها ناموفق بود.');
      if (result.ok) {
        setHistory((result.data?.items || []) as BroadcastMessage[]);
        setHistoryTotal(Number(result.data?.total || 0));
        setHistoryPage(Number(result.data?.page || page));
      }
    } catch (error) {
      setHistoryError(getApiError(error, 'بارگذاری پیام‌ها ناموفق بود.'));
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (view === 'history') void loadHistory(1);
  }, [view, historyStatus]);

  const resetForm = () => {
    setAudienceType('all');
    setSelectedUsers({});
    setUserSearch('');
    setTitle('');
    setMessage('');
    setImageUrl('');
    setActionUrl('');
    setActionLabel('');
    setDisplayMode('notification');
    setPriority('normal');
    setSendMode('now');
    setScheduledAt('');
    setExpiresAt('');
    setFormError('');
  };

  const toggleUser = (user: RecipientUser) => {
    setSelectedUsers((previous) => {
      if (audienceType === 'one') return { [user.userId]: user };
      const next = { ...previous };
      if (next[user.userId]) delete next[user.userId];
      else next[user.userId] = user;
      return next;
    });
  };

  const uploadImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      notify.warning('فقط تصویر JPG، PNG یا WEBP مجاز است.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      notify.warning('حجم تصویر نباید بیشتر از ۵ مگابایت باشد.');
      return;
    }
    setUploadingImage(true);
    try {
      const body = new FormData();
      body.append('image', file);
      const response = await fetch('/api/admin/broadcast-messages/upload-image', { method: 'POST', body, credentials: 'include' });
      const result = await handleAdminResponse(response, 'بارگذاری تصویر ناموفق بود.');
      if (result.ok) {
        setImageUrl(String(result.data?.imageUrl || ''));
        notify.success('تصویر با موفقیت اضافه شد.');
      }
    } catch (error) {
      notify.error(getApiError(error, 'بارگذاری تصویر ناموفق بود.'));
    } finally {
      setUploadingImage(false);
    }
  };

  const submitMessage = async (event: FormEvent) => {
    event.preventDefault();
    setFormError('');
    if (!message.trim()) return setFormError('متن پیام الزامی است.');
    if (audienceType !== 'all' && selectedUserList.length === 0) return setFormError('حداقل یک کاربر انتخاب کنید.');
    if (audienceType === 'one' && selectedUserList.length !== 1) return setFormError('برای ارسال تک‌کاربره دقیقاً یک کاربر انتخاب کنید.');
    if (sendMode === 'scheduled' && !scheduledAt) return setFormError('تاریخ و ساعت ارسال را مشخص کنید.');

    setSubmitting(true);
    try {
      const payload = {
        audienceType,
        audienceUserIds: selectedUserList.map((user) => user.userId),
        title: title.trim(),
        message: message.trim(),
        imageUrl: imageUrl.trim(),
        actionUrl: actionUrl.trim(),
        actionLabel: actionLabel.trim(),
        displayMode,
        priority,
        sendMode,
        scheduledAt: sendMode === 'scheduled' ? new Date(scheduledAt).toISOString() : null,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null
      };
      const response = await fetch('/api/admin/broadcast-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      const result = await handleAdminResponse(response, 'ثبت پیام ناموفق بود.');
      if (!result.ok) return;
      const statusLabel = sendMode === 'now' ? 'ارسال شد' : sendMode === 'scheduled' ? 'زمان‌بندی شد' : 'به‌عنوان پیش‌نویس ذخیره شد';
      notify.success(`پیام با موفقیت ${statusLabel}.`, { title: 'پیام همگانی' });
      resetForm();
      setView('history');
    } catch (error) {
      setFormError(getApiError(error, 'ثبت پیام ناموفق بود.'));
    } finally {
      setSubmitting(false);
    }
  };

  const cancelMessage = async (item: BroadcastMessage) => {
    const allowed = await confirm({ title: 'لغو پیام', message: 'این پیام دیگر برای کاربران نمایش داده نشود؟', confirmText: 'لغو پیام', cancelText: 'انصراف', variant: 'danger' });
    if (!allowed) return;
    try {
      const response = await fetch(`/api/admin/broadcast-messages/${item.id}/cancel`, { method: 'POST', credentials: 'include' });
      const result = await handleAdminResponse(response, 'لغو پیام ناموفق بود.');
      if (result.ok) {
        notify.success('پیام لغو شد.');
        await loadHistory(historyPage);
      }
    } catch (error) {
      notify.error(getApiError(error, 'لغو پیام ناموفق بود.'));
    }
  };

  const deleteMessage = async (item: BroadcastMessage) => {
    const allowed = await confirm({ title: 'حذف پیام', message: 'حذف این پیش‌نویس/پیام لغوشده قطعی است؟', confirmText: 'حذف', cancelText: 'انصراف', variant: 'danger' });
    if (!allowed) return;
    try {
      const response = await fetch(`/api/admin/broadcast-messages/${item.id}`, { method: 'DELETE', credentials: 'include' });
      const result = await handleAdminResponse(response, 'حذف پیام ناموفق بود.');
      if (result.ok) {
        notify.success('پیام حذف شد.');
        await loadHistory(historyPage);
      }
    } catch (error) {
      notify.error(getApiError(error, 'حذف پیام ناموفق بود.'));
    }
  };

  return (
    <div className="broadcast-messages">
      <div className="broadcast-toolbar">
        <div>
          <h3>ارسال پیام همگانی</h3>
          <p>یک پیام را برای همه، چند کاربر یا یک کاربر ارسال و نتیجه آن را پیگیری کنید.</p>
        </div>
        <div className="broadcast-toolbar__actions">
          <Button variant={view === 'compose' ? 'primary' : 'secondary'} onClick={() => setView('compose')} startIcon={<Icon name="send" size={17} />}>ارسال پیام</Button>
          <Button variant={view === 'history' ? 'primary' : 'secondary'} onClick={() => setView('history')} startIcon={<Icon name="book" size={17} />}>تاریخچه پیام‌ها</Button>
        </div>
      </div>

      {view === 'compose' ? (
        <form onSubmit={submitMessage} className="broadcast-compose">
          <Card padding="lg" className="broadcast-card">
            <div className="broadcast-section-heading"><span className="broadcast-step">۱</span><div><h4>انتخاب گیرندگان</h4><p>پیام برای چه کسانی ارسال شود؟</p></div></div>
            <div className="broadcast-audience-options" role="radiogroup" aria-label="نوع گیرندگان پیام">
              {(['all', 'some', 'one'] as AudienceType[]).map((value) => (
                <button type="button" key={value} className={`broadcast-audience-option ${audienceType === value ? 'is-selected' : ''}`} onClick={() => { setAudienceType(value); setSelectedUsers({}); }} role="radio" aria-checked={audienceType === value}>
                  <span className="broadcast-audience-option__icon" aria-hidden="true"><Icon name={value === 'all' ? 'family' : value === 'some' ? 'check-circle' : 'user'} size={22} /></span>
                  <span><strong>{AUDIENCE_LABELS[value]}</strong><small>{value === 'all' ? 'ارسال به تمام کاربران فعال' : value === 'some' ? 'انتخاب چند کاربر از فهرست' : 'جست‌وجو و انتخاب یک کاربر'}</small></span>
                </button>
              ))}
            </div>

            {audienceType !== 'all' ? (
              <div className="broadcast-recipient-picker">
                <TextField label="جست‌وجوی کاربر" value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="نام، شماره یا شناسه کاربر" autoComplete="off" />
                <div className="broadcast-selected-summary" aria-live="polite">{selectedUserList.length ? `${selectedUserList.length} کاربر انتخاب شده` : 'هنوز کاربری انتخاب نشده است.'}</div>
                <div className="broadcast-user-list" aria-live="polite">
                  {usersLoading ? <div className="broadcast-empty">در حال بارگذاری کاربران...</div> : users.length === 0 ? <div className="broadcast-empty">کاربری با این مشخصات پیدا نشد.</div> : users.map((user) => {
                    const selected = Boolean(selectedUsers[user.userId]);
                    return <label className={`broadcast-user-row ${selected ? 'is-selected' : ''}`} key={user.userId}><input type={audienceType === 'one' ? 'radio' : 'checkbox'} name="broadcast-user" checked={selected} onChange={() => toggleUser(user)} /><span><strong>{user.name || 'بدون نام'}</strong><small>{user.phone || user.userId}</small></span><Icon name={selected ? 'check-circle' : 'user'} size={19} aria-hidden="true" /></label>;
                  })}
                </div>
              </div>
            ) : null}
          </Card>

          <Card padding="lg" className="broadcast-card">
            <div className="broadcast-section-heading"><span className="broadcast-step">۲</span><div><h4>محتوای پیام</h4><p>متن پیام الزامی است؛ بقیه موارد اختیاری هستند.</p></div></div>
            <FieldGroup>
              <TextField label="عنوان پیام (اختیاری)" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={191} placeholder="مثلاً اطلاعیه مهم" />
              <TextAreaField label="متن پیام *" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={30000} rows={6} placeholder="متن پیام را بنویسید..." helperText={`${message.length.toLocaleString('fa-IR')} کاراکتر`} />
              <div className="broadcast-two-columns">
                <TextField label="لینک تصویر (اختیاری)" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://..." dir="ltr" />
                <label className="broadcast-upload-field"><span>یا تصویر را بارگذاری کنید</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadImage} disabled={uploadingImage} />{uploadingImage ? <small>در حال بارگذاری...</small> : <small>JPG، PNG یا WEBP تا ۵ مگابایت</small>}</label>
              </div>
              <div className="broadcast-two-columns"><TextField label="لینک اقدام (اختیاری)" value={actionUrl} onChange={(event) => setActionUrl(event.target.value)} placeholder="https://..." dir="ltr" /><TextField label="متن دکمه (اختیاری)" value={actionLabel} onChange={(event) => setActionLabel(event.target.value)} maxLength={191} placeholder="مشاهده بیشتر" /></div>
            </FieldGroup>
            {imageUrl ? <div className="broadcast-image-preview"><img src={imageUrl} alt="پیش‌نمایش تصویر پیام" /><Button type="button" variant="ghost" size="sm" onClick={() => setImageUrl('')}>حذف تصویر</Button></div> : null}
          </Card>

          <Card padding="lg" className="broadcast-card">
            <div className="broadcast-section-heading"><span className="broadcast-step">۳</span><div><h4>نحوه و زمان نمایش</h4><p>روش نمایش را برای همین پیام انتخاب کنید.</p></div></div>
            <div className="broadcast-display-grid">
              {DISPLAY_MODES.map((mode) => <label className={`broadcast-display-option ${displayMode === mode.value ? 'is-selected' : ''}`} key={mode.value}><input type="radio" name="display-mode" value={mode.value} checked={displayMode === mode.value} onChange={() => setDisplayMode(mode.value)} /><span><strong>{mode.label}</strong><small>{mode.description}</small></span></label>)}
            </div>
            <div className="broadcast-two-columns broadcast-schedule-fields">
              <label className="broadcast-native-field"><span>زمان ارسال</span><select value={sendMode} onChange={(event) => setSendMode(event.target.value as SendMode)}><option value="now">ارسال فوری</option><option value="scheduled">زمان‌بندی‌شده</option><option value="draft">ذخیره پیش‌نویس</option></select></label>
              {sendMode === 'scheduled' ? <label className="broadcast-native-field"><span>تاریخ و ساعت ارسال</span><input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></label> : <div />}
              <label className="broadcast-native-field"><span>تاریخ انقضا (اختیاری)</span><input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
              <label className="broadcast-native-field"><span>اولویت</span><select value={priority} onChange={(event) => setPriority(event.target.value as 'low' | 'normal' | 'high')}><option value="low">عادی - کم</option><option value="normal">عادی</option><option value="high">مهم</option></select></label>
            </div>
          </Card>

          {formError ? <InlineMessage variant="error" text={formError} /> : null}
          <div className="broadcast-submit-bar"><div><strong>خلاصه:</strong> {AUDIENCE_LABELS[audienceType]}{audienceType !== 'all' ? `، ${selectedUserList.length} نفر` : ''} · {DISPLAY_MODES.find((item) => item.value === displayMode)?.label}</div><Button type="submit" size="lg" loading={submitting || uploadingImage} startIcon={<Icon name="send" size={18} />}>{sendMode === 'now' ? 'تأیید و ارسال پیام' : sendMode === 'scheduled' ? 'ذخیره زمان‌بندی' : 'ذخیره پیش‌نویس'}</Button></div>
        </form>
      ) : (
        <Card padding="lg" className="broadcast-card broadcast-history-card">
          <div className="broadcast-history-header"><div><h3>تاریخچه پیام‌ها</h3><p>{historyTotal.toLocaleString('fa-IR')} پیام ثبت شده است.</p></div><select value={historyStatus} onChange={(event) => setHistoryStatus(event.target.value)} aria-label="فیلتر وضعیت پیام"><option value="">همه وضعیت‌ها</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          {historyError ? <InlineMessage variant="error" text={historyError} /> : null}
          <div className="broadcast-history-list">
            {historyLoading ? <div className="broadcast-empty">در حال بارگذاری پیام‌ها...</div> : history.length === 0 ? <div className="broadcast-empty">هنوز پیامی ثبت نشده است.</div> : history.map((item) => <article className="broadcast-history-row" key={item.id}><div className="broadcast-history-row__main"><div className="broadcast-history-row__title"><span className={`broadcast-status broadcast-status--${item.status}`}>{STATUS_LABELS[item.status]}</span><h4>{item.title || 'پیام بدون عنوان'}</h4></div><p>{item.message}</p><small>{AUDIENCE_LABELS[item.audienceType]} · {formatDate(item.createdAt)} · سازنده: {item.createdBy}</small></div><div className="broadcast-history-row__stats"><span>گیرنده <strong>{item.recipientCount.toLocaleString('fa-IR')}</strong></span><span>مشاهده <strong>{item.viewedCount.toLocaleString('fa-IR')}</strong></span><span>کلیک <strong>{item.clickedCount.toLocaleString('fa-IR')}</strong></span></div><div className="broadcast-history-row__actions"><Button variant="ghost" size="sm" onClick={() => setDetails(item)}>جزئیات</Button>{['draft', 'scheduled'].includes(item.status) ? <Button variant="secondary" size="sm" onClick={() => void cancelMessage(item)}>لغو</Button> : null}{['draft', 'cancelled'].includes(item.status) ? <Button variant="danger" size="sm" onClick={() => void deleteMessage(item)}>حذف</Button> : null}</div></article>)}
          </div>
          <div className="admin-pagination"><Button variant="secondary" size="sm" disabled={historyLoading || historyPage <= 1} onClick={() => void loadHistory(historyPage - 1)}>قبلی</Button><span>صفحه {historyPage} / {historyPages}</span><Button variant="secondary" size="sm" disabled={historyLoading || historyPage >= historyPages} onClick={() => void loadHistory(historyPage + 1)}>بعدی</Button></div>
        </Card>
      )}

      <Dialog open={Boolean(details)} title={details?.title || 'جزئیات پیام'} onClose={() => setDetails(null)} showFooter={false} panelClassName="broadcast-details-dialog">
        {details ? <div className="broadcast-details"><div className="broadcast-detail-message">{details.message}</div><dl><div><dt>وضعیت</dt><dd>{STATUS_LABELS[details.status]}</dd></div><div><dt>گیرندگان</dt><dd>{AUDIENCE_LABELS[details.audienceType]} · {details.recipientCount.toLocaleString('fa-IR')} نفر</dd></div><div><dt>نوع نمایش</dt><dd>{DISPLAY_MODES.find((mode) => mode.value === details.displayMode)?.label}</dd></div><div><dt>ارسال</dt><dd>{formatDate(details.publishedAt || details.scheduledAt || details.createdAt)}</dd></div><div><dt>مشاهده</dt><dd>{details.viewedCount.toLocaleString('fa-IR')} نفر</dd></div><div><dt>تأیید</dt><dd>{details.acknowledgedCount.toLocaleString('fa-IR')} نفر</dd></div><div><dt>کلیک</dt><dd>{details.clickedCount.toLocaleString('fa-IR')} نفر</dd></div></dl></div> : null}
      </Dialog>
    </div>
  );
}
