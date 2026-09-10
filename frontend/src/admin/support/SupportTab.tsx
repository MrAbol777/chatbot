import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, InlineMessage, TextAreaField } from '../../design-system/components';
import type { SupportStatus, SupportTicket } from '../../support/support.service';
import { supportCategoryLabels, supportStatusLabels } from '../../support/support.service';
import { handleAdminResponse } from '../admin.types';
import './SupportTab.css';

const statusOptions: Array<{ value: SupportStatus; label: string }> = Object.entries(supportStatusLabels).map(([value, label]) => ({ value: value as SupportStatus, label }));
const formatDate = (value?: string) => value ? new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';

export default function SupportTab() {
  const [items, setItems] = useState<SupportTicket[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selected, setSelected] = useState<SupportTicket | null>(null);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadItems = useCallback(async () => {
    const params = new URLSearchParams({ pageSize: '100' });
    if (status) params.set('status', status);
    if (query.trim()) params.set('q', query.trim());
    const response = await fetch(`/api/admin/support?${params.toString()}`, { credentials: 'include' });
    const result = await handleAdminResponse(response, 'بارگذاری درخواست‌های پشتیبانی ناموفق بود.');
    if (result.ok) {
      const nextItems = (result.data?.items || []) as SupportTicket[];
      setItems(nextItems);
      setSelectedId((current) => nextItems.some((item) => item.id === current) ? current : nextItems[0]?.id || '');
    }
  }, [query, status]);

  const loadSelected = useCallback(async (id: string, quiet = false) => {
    if (!id) return;
    const response = await fetch(`/api/admin/support/${encodeURIComponent(id)}`, { credentials: 'include' });
    const result = await handleAdminResponse(response, 'بارگذاری گفت‌وگو ناموفق بود.');
    if (result.ok) { setSelected(result.data?.item as SupportTicket); if (!quiet) setError(''); }
  }, []);

  useEffect(() => {
    setLoading(true);
    void loadItems().catch((err) => setError(err instanceof Error ? err.message : 'خطا در بارگذاری درخواست‌ها.')).finally(() => setLoading(false));
  }, [loadItems]);

  useEffect(() => { setSelected(null); void loadSelected(selectedId); }, [loadSelected, selectedId]);

  useEffect(() => {
    const timer = window.setInterval(() => { void loadItems(); if (selectedId) void loadSelected(selectedId, true); }, 8000);
    return () => window.clearInterval(timer);
  }, [loadItems, loadSelected, selectedId]);

  const activeFromList = useMemo(() => items.find((item) => item.id === selectedId) || selected, [items, selected, selectedId]);

  const changeStatus = async (nextStatus: SupportStatus) => {
    if (!selectedId) return;
    setSaving(true); setError('');
    try {
      const response = await fetch(`/api/admin/support/${encodeURIComponent(selectedId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ status: nextStatus }) });
      const result = await handleAdminResponse(response, 'تغییر وضعیت ناموفق بود.');
      if (result.ok) { setSelected(result.data?.item as SupportTicket); await loadItems(); }
    } catch (err) { setError(err instanceof Error ? err.message : 'تغییر وضعیت ناموفق بود.'); }
    finally { setSaving(false); }
  };

  const sendReply = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedId || !reply.trim()) return;
    setSaving(true); setError('');
    try {
      const response = await fetch(`/api/admin/support/${encodeURIComponent(selectedId)}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ body: reply.trim(), isInternal: internal }) });
      const result = await handleAdminResponse(response, 'ارسال پاسخ ناموفق بود.');
      if (result.ok) { setSelected(result.data?.item as SupportTicket); setReply(''); setInternal(false); await loadItems(); }
    } catch (err) { setError(err instanceof Error ? err.message : 'ارسال پاسخ ناموفق بود.'); }
    finally { setSaving(false); }
  };

  return <div className="admin-support">
    <div className="admin-support__toolbar">
      <div><h3>صندوق پشتیبانی</h3><p className="admin-note">گزارش خطاها و گفت‌وگوی مستقیم با کاربران</p></div>
      <div className="admin-support__filters"><input aria-label="جستجوی درخواست‌ها" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="کد، موضوع یا نام کاربر" /><select aria-label="فیلتر وضعیت" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">همه وضعیت‌ها</option>{statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><Button variant="secondary" onClick={() => void loadItems()} disabled={loading}>بازخوانی</Button></div>
    </div>
    {error ? <InlineMessage text={error} variant="error" /> : null}
    <div className="admin-support__layout">
      <Card className="admin-support__list" padding="sm"><div className="admin-support__list-header"><strong>درخواست‌ها</strong><span>{items.length.toLocaleString('fa-IR')}</span></div>{loading ? <p className="admin-note">در حال بارگذاری…</p> : null}{!loading && items.length === 0 ? <div className="admin-support__empty">درخواستی برای نمایش وجود ندارد.</div> : null}{items.map((item) => <button type="button" key={item.id} className={`admin-support__row ${item.id === selectedId ? 'is-active' : ''}`} onClick={() => { setSelectedId(item.id); setSelected(null); }}><span><strong>{item.subject}</strong><small>{item.code} · {item.userName || 'کاربر'} · {supportStatusLabels[item.status]}</small></span><time dateTime={item.updatedAt}>{formatDate(item.updatedAt)}</time></button>)}</Card>
      <Card className="admin-support__thread" padding="md">{activeFromList ? <><div className="admin-support__thread-header"><div><span className="admin-support__code">{activeFromList.code}</span><h3>{activeFromList.subject}</h3><p>{activeFromList.userName || 'کاربر'}{activeFromList.userAge ? ` · ${activeFromList.userAge.toLocaleString('fa-IR')} ساله` : ''}{activeFromList.userPhone ? ` · ${activeFromList.userPhone}` : ''}</p><span className="admin-support__category">{supportCategoryLabels[activeFromList.category]}</span></div><label className="admin-support__status"><span>وضعیت</span><select value={activeFromList.status} onChange={(event) => void changeStatus(event.target.value as SupportStatus)} disabled={saving}>{statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div><div className="admin-support__messages" aria-live="polite">{(selected?.messages || []).map((item) => <article key={item.id} className={`admin-support__message ${item.isInternal ? 'is-internal' : ''}`}><div><strong>{item.authorName}</strong><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></div><p>{item.body}</p>{item.isInternal ? <small>یادداشت داخلی</small> : null}</article>)}</div><form className="admin-support__reply" onSubmit={sendReply}><TextAreaField label="پاسخ" value={reply} onChange={(event) => setReply(event.target.value)} placeholder="پاسخ خود را بنویسید…" rows={4} maxLength={10000} /><label className="admin-support__internal"><input type="checkbox" checked={internal} onChange={(event) => setInternal(event.target.checked)} /> یادداشت داخلی (به کاربر نمایش داده نشود)</label><Button type="submit" loading={saving}>ارسال پاسخ</Button></form></> : <div className="admin-support__empty">یک درخواست را برای مشاهده انتخاب کنید.</div>}</Card>
    </div>
  </div>;
}
