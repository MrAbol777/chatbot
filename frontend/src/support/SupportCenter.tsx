import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon';
import { Button, Card, InlineMessage, TextAreaField, TextField } from '../design-system/components';
import {
  createSupportTicket,
  getSupportTicket,
  listSupportTickets,
  sendSupportMessage,
  supportCategoryLabels,
  supportStatusLabels,
  type SupportCategory,
  type SupportTicket
} from './support.service';
import './SupportCenter.css';

type Props = { onBackToChat: () => void };

const formatDate = (value: string) => value ? new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '';

const getSourcePath = () => {
  try { return sessionStorage.getItem('danoa:support-source-path') || document.referrer || window.location.pathname; } catch { return window.location.pathname; }
};

function SupportCenter({ onBackToChat }: Props) {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selected, setSelected] = useState<SupportTicket | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<SupportCategory>('technical');
  const [message, setMessage] = useState('');
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadTickets = useCallback(async () => {
    const items = await listSupportTickets();
    setTickets(items);
    setSelectedId((current) => current || items[0]?.id || '');
  }, []);

  const loadSelected = useCallback(async (id: string, quiet = false) => {
    if (!id) return;
    try {
      const item = await getSupportTicket(id);
      setSelected(item);
      if (!quiet) setError('');
    } catch (err) {
      if (!quiet) setError(err instanceof Error ? err.message : 'درخواست بارگذاری نشد.');
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    void loadTickets().catch((err) => { if (mounted) setError(err instanceof Error ? err.message : 'بارگذاری درخواست‌ها ناموفق بود.'); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [loadTickets]);

  useEffect(() => { setSelected(null); void loadSelected(selectedId); }, [loadSelected, selectedId]);

  useEffect(() => {
    if (!selectedId) return undefined;
    const timer = window.setInterval(() => { void loadSelected(selectedId, true); void loadTickets(); }, 8000);
    return () => window.clearInterval(timer);
  }, [loadSelected, loadTickets, selectedId]);

  const selectedFromList = useMemo(() => tickets.find((item) => item.id === selectedId) || selected, [selected, selectedId, tickets]);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!subject.trim() || !message.trim()) return;
    setSaving(true); setError('');
    try {
      const item = await createSupportTicket({
        subject: subject.trim(), category, message: message.trim(),
        context: { sourcePath: getSourcePath(), pageUrl: window.location.href, userAgent: navigator.userAgent, viewport: `${window.innerWidth}x${window.innerHeight}` }
      });
      setTickets((current) => [item, ...current.filter((ticket) => ticket.id !== item.id)]);
      setSelectedId(item.id); setSelected(item); setShowNew(false); setSubject(''); setMessage('');
    } catch (err) { setError(err instanceof Error ? err.message : 'ثبت درخواست ناموفق بود.'); }
    finally { setSaving(false); }
  };

  const handleReply = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedId || !reply.trim()) return;
    setSaving(true); setError('');
    try {
      const item = await sendSupportMessage(selectedId, reply.trim());
      setSelected(item); setTickets((current) => current.map((ticket) => ticket.id === item.id ? item : ticket)); setReply('');
    } catch (err) { setError(err instanceof Error ? err.message : 'ارسال پیام ناموفق بود.'); }
    finally { setSaving(false); }
  };

  return (
    <main className="support-page" aria-labelledby="support-page-title">
      <header className="support-page__header">
        <button type="button" className="support-back" onClick={onBackToChat} aria-label="بازگشت به گفتگو"><Icon name="chevron-left" size={22} aria-hidden="true" /></button>
        <div><span className="support-eyebrow">ارتباط با دانوآ</span><h1 id="support-page-title">مرکز پشتیبانی</h1><p>اگر جایی به خطا خوردی، همین‌جا برای ما بنویس تا پیگیری کنیم.</p></div>
        <Button onClick={() => { setShowNew(true); setSelectedId(''); setSelected(null); }} startIcon={<Icon name="plus" size={18} aria-hidden="true" />}>گزارش مشکل</Button>
      </header>

      <div className="support-page__notice"><Icon name="info-circle" size={18} aria-hidden="true" /><span>پیام‌های شما در همین درخواست ادامه پیدا می‌کنند و پاسخ ما را از دست نمی‌دهید.</span></div>
      {error ? <InlineMessage text={error} variant="error" /> : null}

      <div className="support-layout">
        <Card className="support-list-card" padding="sm">
          <div className="support-list-card__header"><h2>درخواست‌های من</h2><span>{tickets.length.toLocaleString('fa-IR')}</span></div>
          {loading ? <p className="support-muted" role="status">در حال بارگذاری…</p> : null}
          {!loading && tickets.length === 0 ? <div className="support-empty"><Icon name="chat-bubble" size={30} aria-hidden="true" /><strong>هنوز درخواستی ثبت نکردی</strong><span>اگر مشکلی دیدی، گزارشش کن تا بررسی شود.</span><Button size="sm" onClick={() => setShowNew(true)}>ثبت اولین درخواست</Button></div> : null}
          <div className="support-ticket-list">
            {tickets.map((ticket) => <button type="button" key={ticket.id} className={`support-ticket-row ${ticket.id === selectedId ? 'is-active' : ''}`} onClick={() => { setSelectedId(ticket.id); setShowNew(false); }}><span className="support-ticket-row__icon" aria-hidden="true"><Icon name={ticket.category === 'technical' ? 'info-circle' : 'chat-bubble'} size={18} /></span><span className="support-ticket-row__copy"><strong>{ticket.subject}</strong><small>{ticket.code} · {supportStatusLabels[ticket.status]}</small></span><time dateTime={ticket.updatedAt}>{formatDate(ticket.updatedAt)}</time></button>)}
          </div>
        </Card>

        <Card className="support-thread-card" padding="md">
          {showNew ? <form className="support-form" onSubmit={handleCreate}>
            <div className="support-thread-header"><div><span className="support-eyebrow">درخواست جدید</span><h2>چه مشکلی پیش آمده؟</h2></div><button type="button" className="support-close" onClick={() => setShowNew(false)} aria-label="بستن فرم"><Icon name="x-close" size={20} /></button></div>
            <TextField label="موضوع" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="مثلاً: ساخت تصویر کامل نمی‌شود" maxLength={255} required />
            <label className="support-select-field"><span>نوع درخواست</span><select value={category} onChange={(event) => setCategory(event.target.value as SupportCategory)}>{Object.entries(supportCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <TextAreaField label="توضیح مشکل" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="چه اتفاقی افتاد؟ اگر پیغام خطایی دیدی، متنش را هم بنویس." rows={7} maxLength={10000} helperText="هرچه جزئیات بیشتری بنویسی، بررسی سریع‌تر می‌شود." required />
            <div className="support-form__footer"><span>اطلاعات فنی صفحه برای پیگیری بهتر همراه درخواست ثبت می‌شود.</span><Button type="submit" loading={saving}>ثبت درخواست</Button></div>
          </form> : selectedFromList ? <div className="support-thread">
            <div className="support-thread-header"><div><span className="support-eyebrow">{selectedFromList.code}</span><h2>{selectedFromList.subject}</h2><span className={`support-status support-status--${selectedFromList.status}`}>{supportStatusLabels[selectedFromList.status]}</span></div><Button variant="secondary" size="sm" onClick={() => setShowNew(true)}>درخواست جدید</Button></div>
            <div className="support-messages" aria-live="polite">{(selected?.messages || []).map((item) => <article key={item.id} className={`support-message support-message--${item.authorType}`}><div className="support-message__meta"><strong>{item.authorName}</strong><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></div><p>{item.body}</p></article>)}</div>
            <form className="support-reply" onSubmit={handleReply}><TextAreaField label="پیام جدید" value={reply} onChange={(event) => setReply(event.target.value)} placeholder="پاسخ یا توضیح تکمیلی خودت را بنویس…" rows={4} maxLength={10000} /><Button type="submit" loading={saving}>ارسال پیام</Button></form>
          </div> : <div className="support-thread-placeholder"><span><Icon name="chat-bubble" size={32} aria-hidden="true" /></span><h2>یک درخواست را انتخاب کن</h2><p>یا برای گزارش یک مشکل جدید، روی «گزارش مشکل» بزن.</p></div>}
        </Card>
      </div>
    </main>
  );
}

export default SupportCenter;
