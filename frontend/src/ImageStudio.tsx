import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { deleteGalleryImage, fetchProtectedImageBlobUrl, GalleryImage, getImageGenerationStatus, listGalleryImages, startImageEdit, startImageGeneration } from './services/imageGeneration';
import './ImageStudio.css';

const ratios = [{ value: '1:1', label: 'مربع' }, { value: '9:16', label: 'عمودی' }, { value: '16:9', label: 'افقی' }] as const;
const promptIdeas = ['شهر خیالی در غروب', 'کاراکتر سه‌بعدی بامزه', 'پوستر رنگی و مینیمال'];
const editIdeas = ['پس‌زمینه را سینمایی کن', 'نور را طبیعی‌تر کن', 'متن تصویر را تغییر بده'];
const pendingText = ['دارم ایده‌ات رو آماده می‌کنم...', 'جزئیات تصویر در حال ساخته‌شدنه...', 'تقریباً آماده است...'];
const requestKey = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;

function ProtectedImage({ src, alt }: { src: string; alt: string }) {
  const [blobUrl, setBlobUrl] = useState('');
  useEffect(() => {
    let active = true; let created = '';
    fetchProtectedImageBlobUrl(src).then((url) => { created = url; if (active) setBlobUrl(url); else URL.revokeObjectURL(url); }).catch(() => {});
    return () => { active = false; if (created) URL.revokeObjectURL(created); };
  }, [src]);
  return blobUrl ? <img src={blobUrl} alt={alt} loading="lazy" /> : <span className="shimmer" aria-label="در حال بارگذاری تصویر" />;
}

export default function ImageStudio({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<'create' | 'gallery'>('create');
  const [items, setItems] = useState<GalleryImage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [ratio, setRatio] = useState<'1:1' | '9:16' | '16:9'>('1:1');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [selected, setSelected] = useState<GalleryImage | null>(null);
  const [editSource, setEditSource] = useState<GalleryImage | null>(null);
  const [error, setError] = useState('');
  const [galleryError, setGalleryError] = useState('');
  const inFlight = useRef(false);

  const load = async (cursor = 0) => {
    try {
      const data = await listGalleryImages(cursor);
      setItems((old) => cursor ? [...old, ...data.items] : data.items);
      setNextCursor(data.nextCursor);
      setGalleryError('');
    } catch (e) { setGalleryError(e instanceof Error ? e.message : 'دریافت تصاویر انجام نشد.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const pendingIds = useMemo(() => items.filter((x) => ['QUEUE', 'WAITING', 'RUNNING'].includes(x.status)).map((x) => x.id), [items]);
  useEffect(() => {
    if (!pendingIds.length) return;
    let stopped = false; let delay = 1800;
    const poll = async () => {
      let hasPending = false;
      for (const id of pendingIds) {
        try {
          const result = await getImageGenerationStatus(id);
          if (['QUEUE', 'WAITING', 'RUNNING'].includes(result.status)) hasPending = true;
          if (!stopped) setItems((old) => old.map((x) => x.id === id ? { ...x, ...result, updatedAt: new Date().toISOString() } : x));
        } catch { hasPending = true; }
      }
      if (!stopped && hasPending) { delay = Math.min(8000, Math.round(delay * 1.35)); window.setTimeout(poll, delay); }
    };
    const timer = window.setTimeout(poll, delay);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [pendingIds.join(',')]);
  useEffect(() => {
    if (!selected) return;
    const close = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(null);
    document.body.style.overflow = 'hidden'; document.addEventListener('keydown', close);
    return () => { document.body.style.overflow = ''; document.removeEventListener('keydown', close); };
  }, [selected]);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); const value = prompt.trim();
    if (value.length < 8 || inFlight.current) { if (value.length < 8) setError('توضیحت را کمی کامل‌تر بنویس.'); return; }
    inFlight.current = true; setBusy(true); setError('');
    try {
      const key = requestKey();
      const { taskId } = editSource ? await startImageEdit(editSource.id, value, ratio, key) : await startImageGeneration(value, { aspectRatio: ratio, idempotencyKey: key });
      const optimistic: GalleryImage = { id: taskId, taskId, originalPrompt: value, refinedPrompt: value, aspectRatio: ratio, operation: editSource ? 'edit' : 'generate', parentImageId: editSource?.id, status: 'QUEUE', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      setItems((old) => [optimistic, ...old.filter((x) => x.id !== taskId)]); setTab('gallery'); setEditSource(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'درخواست انجام نشد.'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const reuse = (item: GalleryImage, edit = false) => { setPrompt(edit ? '' : item.originalPrompt); setRatio(item.aspectRatio); setEditSource(edit ? item : null); setSelected(null); setError(''); setTab('create'); };
  const remove = async (item: GalleryImage) => { if (!confirm('این تصویر از گالری حذف شود؟')) return; try { await deleteGalleryImage(item.id); setItems((old) => old.filter((x) => x.id !== item.id)); setSelected(null); } catch (e) { setError(e instanceof Error ? e.message : 'حذف انجام نشد.'); } };
  const download = async (item: GalleryImage) => { if (!item.imageUrl) return; const url = await fetchProtectedImageBlobUrl(item.imageUrl); const a = document.createElement('a'); a.href = url; a.download = `danoa-${item.id}.jpg`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 0); };

  return <main className="studio" dir="rtl">
    <div className="studio-shell">
    <header className="studio-header">
      <div className="studio-title"><span className="studio-mark" aria-hidden="true">✦</span><div><small>استودیوی دانوآ</small><h1>تصویرها</h1></div></div>
      <button className="studio-back" type="button" onClick={onBack} aria-label="بازگشت به گفتگوها"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg></button>
    </header>
    <div className="studio-tabs" role="tablist" aria-label="بخش‌های استودیوی تصویر"><span className={`studio-tab-indicator ${tab === 'gallery' ? 'gallery' : ''}`} aria-hidden="true" /><button type="button" role="tab" aria-selected={tab === 'create'} className={tab === 'create' ? 'active' : ''} onClick={() => setTab('create')}>ساخت تصویر</button><button type="button" role="tab" aria-selected={tab === 'gallery'} className={tab === 'gallery' ? 'active' : ''} onClick={() => setTab('gallery')}>تصاویر من</button></div>
    {(error || (tab === 'gallery' && galleryError)) && <div className="studio-error" role="alert"><span className="studio-error-icon" aria-hidden="true">!</span><span>{error || galleryError}</span><button type="button" onClick={() => { setError(''); setGalleryError(''); }} aria-label="بستن پیام">×</button></div>}
    {tab === 'create' ? <form className="studio-create" onSubmit={submit}>
      {editSource && <section className="studio-edit-workspace" aria-label="تصویر مبدا ویرایش">
        <div className="studio-source-preview">{editSource.imageUrl && <ProtectedImage src={editSource.imageUrl} alt="تصویر مبدا ویرایش" />}<span aria-hidden="true">اصل</span></div>
        <div className="studio-source-copy"><small>ویرایش تصویر</small><strong>یک نسخه‌ی تازه می‌سازیم</strong><p>تصویر اصلی بدون تغییر در گالری می‌ماند.</p></div>
        <button type="button" onClick={() => { setEditSource(null); setPrompt(''); setTab('gallery'); }}>تغییر تصویر</button>
      </section>}
      <section className="studio-prompt-block">
        <label htmlFor="studio-prompt"><span>{editSource ? 'چه تغییری می‌خواهی؟' : 'چی توی ذهنت داری؟'}</span><small>{prompt.length}/۷۰۰</small></label>
        <div className="studio-textarea-wrap"><span className="studio-input-spark" aria-hidden="true">✦</span><textarea id="studio-prompt" value={prompt} onChange={(e) => { setPrompt(e.target.value.slice(0, 700)); setError(''); }} placeholder="مثلاً یک کلبه‌ی شیشه‌ای وسط جنگل، نور صبح و حس آرام..." rows={5} disabled={busy} /></div>
        {!prompt && <div className="studio-ideas" aria-label="ایده‌های پیشنهادی">{(editSource ? editIdeas : promptIdeas).map((idea) => <button type="button" key={idea} onClick={() => setPrompt(idea)}>{idea}</button>)}</div>}
      </section>
      <fieldset><div className="studio-field-heading"><legend>قاب تصویر</legend><span>بهترین اندازه برای خروجی‌ات</span></div><div className="ratio-options">{ratios.map((r) => <button type="button" key={r.value} className={ratio === r.value ? 'active' : ''} onClick={() => setRatio(r.value)} aria-pressed={ratio === r.value}><i className={`ratio-shape ratio-${r.value.replace(':', '-')}`} aria-hidden="true" /><span>{r.label}</span><small>{r.value}</small><b aria-hidden="true">✓</b></button>)}</div></fieldset>
      <button className="studio-submit" disabled={busy || prompt.trim().length < 8}><span className="studio-submit-icon" aria-hidden="true">✦</span><span>{busy ? 'دارم آماده می‌کنم...' : editSource ? 'ویرایش تصویر' : 'ساخت تصویر'}</span>{busy && <i aria-hidden="true" />}</button>
    </form> : <section className="studio-gallery">
      {loading ? <div className="gallery-grid">{Array.from({ length: 8 }).map((_, i) => <div className="image-card skeleton" key={i} />)}</div> : items.length === 0 ? <div className="studio-empty"><strong>هنوز تصویری نساختی</strong><button type="button" onClick={() => setTab('create')}>اولین تصویر را بساز</button></div> : <div className="gallery-grid">{items.map((item, index) => <button type="button" className={`image-card ${item.status.toLowerCase()}`} style={{ aspectRatio: item.aspectRatio.replace(':', '/') }} key={item.id} onClick={() => item.status === 'COMPLETED' && setSelected(item)}>{item.status === 'COMPLETED' && item.imageUrl ? <ProtectedImage src={item.imageUrl} alt={item.originalPrompt} /> : <><span className="shimmer" /><strong>{item.status === 'ERROR' ? 'ساخت تصویر ناموفق بود' : pendingText[index % pendingText.length]}</strong>{item.status === 'ERROR' && <span onClick={(e) => { e.stopPropagation(); reuse(item); }}>تلاش دوباره</span>}</>}</button>)}</div>}
      {nextCursor !== null && <button className="load-more" type="button" onClick={() => void load(nextCursor)}>نمایش بیشتر</button>}
    </section>}
    {selected && <div className="studio-modal" role="dialog" aria-modal="true" aria-label="نمایش تصویر" onMouseDown={(e) => e.target === e.currentTarget && setSelected(null)}><div><button className="modal-close" type="button" onClick={() => setSelected(null)} aria-label="بستن">×</button>{selected.imageUrl && <ProtectedImage src={selected.imageUrl} alt={selected.originalPrompt} />}<p>{selected.originalPrompt}</p><div className="modal-actions"><button type="button" onClick={() => void download(selected)}>دانلود</button><button type="button" onClick={() => reuse(selected)}>ساخت مشابه</button><button type="button" onClick={() => reuse(selected, true)}>ویرایش</button><button type="button" className="danger" onClick={() => void remove(selected)}>حذف</button></div></div></div>}
    </div>
  </main>;
}
