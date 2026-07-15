import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deleteGalleryImage, fetchProtectedImageBlobUrl, GalleryImage, getImageGenerationStatus, listGalleryImages, startImageEdit, startImageGeneration } from './services/imageGeneration';
import ImageViewer from './ImageViewer';
import './ImageStudio.css';

const ratios = [
  { value: '1:1', label: 'مربع', description: 'برای پست و آواتار' },
  { value: '9:16', label: 'عمودی', description: 'برای استوری و موبایل' },
  { value: '16:9', label: 'افقی', description: 'برای بنر و نمایشگر' }
] as const;
const promptIdeas = ['شهر خیالی در غروب', 'کاراکتر سه‌بعدی بامزه', 'پوستر رنگی و مینیمال'];
const editIdeas = ['پس‌زمینه را سینمایی کن', 'نور را طبیعی‌تر کن', 'متن تصویر را تغییر بده'];
const pendingText = ['دارم ایده‌ات رو آماده می‌کنم...', 'جزئیات تصویر در حال ساخته‌شدنه...', 'تقریباً آماده است...'];
const requestKey = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const STUDIO_SESSION_KEY = 'danoa:image-studio-state';

type StudioSessionState = {
  tab: 'create' | 'gallery';
  prompt: string;
  ratio: '1:1' | '9:16' | '16:9';
  editSourceId: string | null;
};

const readStudioSession = (): StudioSessionState => {
  const fallback: StudioSessionState = { tab: 'create', prompt: '', ratio: '1:1', editSourceId: null };
  try {
    const raw = sessionStorage.getItem(STUDIO_SESSION_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<StudioSessionState>;
    return {
      tab: parsed.tab === 'gallery' ? 'gallery' : 'create',
      prompt: typeof parsed.prompt === 'string' ? parsed.prompt.slice(0, 700) : '',
      ratio: parsed.ratio === '9:16' || parsed.ratio === '16:9' ? parsed.ratio : '1:1',
      editSourceId: typeof parsed.editSourceId === 'string' ? parsed.editSourceId : null
    };
  } catch {
    return fallback;
  }
};

const getUserFacingPrompt = (prompt: string) => {
  const text = String(prompt || '').trim();
  if (!text) return '';
  const extracted = text.match(/Original user request:\s*([\s\S]*?)(?=\s*(?:Main subject request:|Negative prompt:)|$)/i)?.[1]?.trim();
  if (extracted) return extracted;
  if (/^Create one clear, high-quality image that exactly matches this user request\.?/i.test(text)) {
    return 'تصویر ساخته‌شده با درخواست شما';
  }
  return text;
};

function ProtectedImage({ src, alt }: { src: string; alt: string }) {
  const [blobUrl, setBlobUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true; let created = '';
    setFailed(false);
    fetchProtectedImageBlobUrl(src).then((url) => { created = url; if (active) setBlobUrl(url); else if (url.startsWith('blob:')) URL.revokeObjectURL(url); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (created && created.startsWith('blob:')) URL.revokeObjectURL(created); };
  }, [src]);
  if (blobUrl) return <img src={blobUrl} alt={alt} loading="lazy" />;
  if (failed) return <span className="image-card-error" aria-label="بارگذاری تصویر انجام نشد">!</span>;
  return <span className="shimmer" aria-label="در حال بارگذاری تصویر" />;
}

type SortOrder = 'newest' | 'oldest';

const completeCount = (list: GalleryImage[]) => list.filter((x) => x.status === 'COMPLETED').length;

export default function ImageStudio({ onBack }: { onBack: () => void }) {
  const [savedSession] = useState(readStudioSession);
  const [tab, setTab] = useState<'create' | 'gallery'>(savedSession.tab);
  const [items, setItems] = useState<GalleryImage[]>([]);
  const [prompt, setPrompt] = useState(savedSession.prompt);
  const [ratio, setRatio] = useState<'1:1' | '9:16' | '16:9'>(savedSession.ratio);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [selected, setSelected] = useState<GalleryImage | null>(null);
  const [editSource, setEditSource] = useState<GalleryImage | null>(null);
  const [error, setError] = useState('');
  const [galleryError, setGalleryError] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [sortOpen, setSortOpen] = useState(false);
  const inFlight = useRef(false);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const editSourceToRestoreRef = useRef(savedSession.editSourceId);

  useEffect(() => {
    if (editSourceToRestoreRef.current && !editSource) return;
    try {
      sessionStorage.setItem(
        STUDIO_SESSION_KEY,
        JSON.stringify({ tab, prompt, ratio, editSourceId: editSource?.id || null } satisfies StudioSessionState)
      );
    } catch { /* best-effort */ }
  }, [tab, prompt, ratio, editSource?.id]);

  useEffect(() => {
    const input = promptInputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(Math.max(input.scrollHeight, 164), 300)}px`;
  }, [prompt]);

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
  useEffect(() => {
    const editSourceId = editSourceToRestoreRef.current;
    if (!editSourceId) return;
    const matchingItem = items.find((item) => item.id === editSourceId);
    if (matchingItem) {
      setEditSource(matchingItem);
      editSourceToRestoreRef.current = null;
    } else if (!loading) {
      editSourceToRestoreRef.current = null;
    }
  }, [items, loading]);
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
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('studio-viewer-open');
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.classList.remove('studio-viewer-open');
    };
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
  const reuse = (item: GalleryImage, edit = false) => { setPrompt(edit ? '' : getUserFacingPrompt(item.originalPrompt)); setRatio(item.aspectRatio); setEditSource(edit ? item : null); setSelected(null); setError(''); setTab('create'); };
  const remove = async (item: GalleryImage) => { if (!confirm('این تصویر از گالری حذف شود؟')) return; try { await deleteGalleryImage(item.id); setItems((old) => old.filter((x) => x.id !== item.id)); setSelected(null); } catch (e) { setError(e instanceof Error ? e.message : 'حذف انجام نشد.'); } };
  const download = async (item: GalleryImage) => { if (!item.imageUrl) return; const url = await fetchProtectedImageBlobUrl(item.imageUrl); const a = document.createElement('a'); a.href = url; a.download = `danoa-${item.id}.jpg`; a.click(); if (url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(url), 0); };

  const sortedItems = useMemo(() => {
    const list = [...items];
    list.sort((a, b) => {
      const da = new Date(a.createdAt).getTime();
      const db = new Date(b.createdAt).getTime();
      return sortOrder === 'newest' ? db - da : da - db;
    });
    return list;
  }, [items, sortOrder]);

  const handleCardAction = useCallback((e: React.MouseEvent, item: GalleryImage, action: string) => {
    e.stopPropagation();
    if (action === 'view') setSelected(item);
    else if (action === 'download') void download(item);
    else if (action === 'edit') reuse(item, true);
    else if (action === 'similar') reuse(item);
    else if (action === 'delete') void remove(item);
  }, [download, reuse, remove]);

  return <main className="studio" dir="rtl">
    <div className="studio-shell">
    <header className="studio-header">
      <div className="studio-brand">
        <span className="studio-brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Z" /><path d="m18.5 15 .7 2.8L22 18.5l-2.8.7-.7 2.8-.7-2.8-2.8-.7 2.8-.7.7-2.8Z" /></svg>
        </span>
        <span className="studio-brand-copy">
          <strong>استودیوی تصویر</strong>
          <small>ایده‌ات را به تصویر تبدیل کن</small>
        </span>
      </div>
      <button className="studio-header-back" type="button" onClick={onBack} aria-label="بازگشت به چت" title="بازگشت به چت">
        <span>بازگشت به چت</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18 9 12l6-6" /></svg>
      </button>
    </header>
    <div className="studio-tabs" role="tablist" aria-label="بخش‌های استودیوی تصویر"><span className={`studio-tab-indicator ${tab === 'gallery' ? 'gallery' : ''}`} aria-hidden="true" /><button type="button" role="tab" aria-selected={tab === 'create'} className={tab === 'create' ? 'active' : ''} onClick={() => setTab('create')}>ساخت تصویر</button><button type="button" role="tab" aria-selected={tab === 'gallery'} className={tab === 'gallery' ? 'active' : ''} onClick={() => setTab('gallery')}>تصاویر من</button></div>
    {(error || (tab === 'gallery' && galleryError)) && <div className="studio-error" role="alert"><span className="studio-error-icon" aria-hidden="true">!</span><span>{error || galleryError}</span><button type="button" onClick={() => { setError(''); setGalleryError(''); }} aria-label="بستن پیام">×</button></div>}
    {tab === 'create' ? <form className="studio-create" onSubmit={submit}>
      {editSource && <section className="studio-edit-workspace" aria-label="تصویر مبدا ویرایش">
        <div className="studio-source-preview">{editSource.imageUrl && <ProtectedImage src={editSource.imageUrl} alt="تصویر مبدا ویرایش" />}<span aria-hidden="true">اصل</span></div>
        <div className="studio-source-copy"><small>ویرایش تصویر</small><strong>یک نسخه‌ی تازه می‌سازیم</strong><p>تصویر اصلی بدون تغییر در گالری می‌ماند.</p></div>
        <button type="button" onClick={() => { setEditSource(null); setPrompt(''); setTab('gallery'); }}>تغییر تصویر</button>
      </section>}
      <div className="studio-create-grid">
        <section className="studio-prompt-card">
          <div className="studio-prompt-block">
            <label htmlFor="studio-prompt"><span>{editSource ? 'چه تغییری می‌خواهی؟' : 'چی توی ذهنت داری؟'}</span><small>{prompt.length}/۷۰۰</small></label>
            <p className="studio-field-help">سوژه، سبک، نور و حس تصویر را با چند کلمه توضیح بده.</p>
            <div className="studio-textarea-wrap"><span className="studio-input-spark" aria-hidden="true">✦</span><textarea ref={promptInputRef} id="studio-prompt" value={prompt} onChange={(e) => { setPrompt(e.target.value.slice(0, 700)); setError(''); }} placeholder="مثلاً یک کلبه‌ی شیشه‌ای وسط جنگل، نور صبح و حس آرام..." rows={5} disabled={busy} maxLength={700} /></div>
            <div className="studio-idea-section">
              <span>برای شروع، یکی را انتخاب کن</span>
              <div className="studio-ideas" aria-label="ایده‌های پیشنهادی">{(editSource ? editIdeas : promptIdeas).map((idea) => <button type="button" key={idea} onClick={() => setPrompt(idea)} disabled={busy}>{idea}</button>)}</div>
            </div>
          </div>
          <div className="studio-submit-dock">
            <button className="studio-submit" disabled={busy || prompt.trim().length < 8}><span className="studio-submit-icon" aria-hidden="true">✦</span><span>{busy ? 'در حال ساخت تصویر...' : editSource ? 'ویرایش تصویر' : 'ساخت تصویر'}</span>{busy && <i aria-hidden="true" />}</button>
            <small>{editSource ? 'تصویر اصلی شما بدون تغییر باقی می‌ماند.' : 'ساخت تصویر ممکن است چند لحظه زمان ببرد.'}</small>
          </div>
        </section>
        <aside className="studio-settings-card" aria-label="تنظیمات تصویر">
          <div className="studio-settings-heading"><span className="studio-settings-icon" aria-hidden="true">✦</span><div><h2>تنظیمات تصویر</h2><p>قاب مناسب خروجی را انتخاب کن</p></div></div>
          <fieldset className="ratio-field">
            <legend>نسبت تصویر</legend>
            <div className="ratio-options" role="group" aria-label="انتخاب نسبت تصویر">
              {ratios.map((option) => <button type="button" key={option.value} className={ratio === option.value ? 'active' : ''} aria-pressed={ratio === option.value} onClick={() => setRatio(option.value)} disabled={busy}>
                <i className={`ratio-shape ratio-${option.value.replace(':', '-')}`} aria-hidden="true" />
                <span>{option.label}</span><small>{option.value}</small>{ratio === option.value ? <b aria-hidden="true">✓</b> : null}
              </button>)}
            </div>
          </fieldset>
          <section className="studio-output-summary" aria-label="خلاصه خروجی">
            <span>خروجی انتخاب‌شده</span>
            <strong>{ratios.find((item) => item.value === ratio)?.label} <em>{ratio}</em></strong>
            <p>{ratios.find((item) => item.value === ratio)?.description}</p>
          </section>
        </aside>
      </div>
    </form> : <section className="studio-gallery">
      <div className="gallery-panel">
        {loading ? <div className="gallery-grid">{Array.from({ length: 8 }).map((_, i) => <div className="image-card skeleton" key={i} />)}</div> : items.length === 0 ? <div className="studio-empty"><strong>هنوز تصویری نساختی</strong><button type="button" onClick={() => setTab('create')}>اولین تصویر را بساز</button></div> : <>
          <div className="gallery-header">
            <div className="gallery-header-info">
              <h2>تصاویر من</h2>
              <span className="gallery-count">{completeCount(items)} تصویر</span>
            </div>
            <div className={`gallery-sort${sortOpen ? ' open' : ''}`}>
              <button
                className="gallery-sort-trigger"
                type="button"
                onClick={() => setSortOpen((o) => !o)}
                aria-haspopup="listbox"
                aria-expanded={sortOpen}
              >
                <span>{sortOrder === 'newest' ? 'جدیدترین' : 'قدیمی‌ترین'}</span>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
              </button>
              {sortOpen && (
                <div className="gallery-sort-dropdown" role="listbox" aria-label="مرتب‌سازی">
                  <button type="button" className={sortOrder === 'newest' ? 'active' : ''} role="option" aria-selected={sortOrder === 'newest'} onClick={() => { setSortOrder('newest'); setSortOpen(false); }}>جدیدترین</button>
                  <button type="button" className={sortOrder === 'oldest' ? 'active' : ''} role="option" aria-selected={sortOrder === 'oldest'} onClick={() => { setSortOrder('oldest'); setSortOpen(false); }}>قدیمی‌ترین</button>
                </div>
              )}
            </div>
          </div>
          <div className="gallery-grid">{sortedItems.map((item) => <button type="button" className={`image-card ${item.status.toLowerCase()}`} style={{ aspectRatio: item.aspectRatio.replace(':', '/') }} key={item.id} onClick={() => item.status === 'COMPLETED' && setSelected(item)}>{item.status === 'COMPLETED' && item.imageUrl ? <>
            <ProtectedImage src={item.imageUrl} alt={item.originalPrompt} />
            <div className="card-overlay" aria-hidden="true">
              <div className="card-overlay-actions">
                <button type="button" onClick={(e) => handleCardAction(e, item, 'view')} aria-label="مشاهده تصویر">مشاهده</button>
                <button type="button" onClick={(e) => handleCardAction(e, item, 'download')} aria-label="دانلود تصویر">دانلود</button>
                <button type="button" onClick={(e) => handleCardAction(e, item, 'edit')} aria-label="ویرایش تصویر">ویرایش</button>
                <button type="button" onClick={(e) => handleCardAction(e, item, 'similar')} aria-label="ساخت مشابه">مشابه</button>
                <button type="button" onClick={(e) => handleCardAction(e, item, 'delete')} aria-label="حذف تصویر">حذف</button>
              </div>
            </div>
          </> : <><span className="shimmer" /><strong>{item.status === 'ERROR' ? 'ساخت تصویر ناموفق بود' : pendingText[items.indexOf(item) % pendingText.length]}</strong>{item.status === 'ERROR' && <span onClick={(e) => { e.stopPropagation(); reuse(item); }}>تلاش دوباره</span>}</>}</button>)}</div>
          {nextCursor !== null && <button className="load-more" type="button" onClick={() => void load(nextCursor)}>نمایش بیشتر</button>}
        </>}
      </div>
    </section>}
    <div className="studio-bottom-spacer" aria-hidden="true" />
    {selected && <ImageViewer item={selected} onClose={() => setSelected(null)} onDownload={download} />}
    </div>
  </main>;
}
