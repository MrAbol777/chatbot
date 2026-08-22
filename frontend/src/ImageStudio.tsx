import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deleteGalleryImage, fetchProtectedImageBlobUrl, GalleryImage, getImageGenerationStatus, listGalleryImages, startImageEdit, startImageGeneration } from './services/imageGeneration';
import { getImageToImageJob, ImageToImageJob, listImageToImageJobs, startImageToImage } from './services/imageToImage';
import ImageViewer from './ImageViewer';
import Icon from './components/Icon';
import { formatDecimalFa } from './noa/decimal';
import { fetchNoaPublicConfig } from './noa/noa.service';
import { Button } from './design-system/components';
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
const MAX_REFERENCE_IMAGES = 4;
const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024;
const REFERENCE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type ReferenceImage = { id: string; file: File; previewUrl: string };

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
const asGalleryImage = (job: ImageToImageJob): GalleryImage => ({
  id: job.id,
  taskId: job.id,
  originalPrompt: job.prompt,
  refinedPrompt: job.prompt,
  aspectRatio: job.aspectRatio,
  operation: 'edit',
  status: job.status === 'succeeded' ? 'COMPLETED' : job.status === 'failed' ? 'ERROR' : job.status === 'submitted' ? 'RUNNING' : 'QUEUE',
  imageUrl: job.result?.contentUrl || null,
  error: job.safeErrorMessage,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  source: 'image-to-image',
  inputCount: job.inputCount
});

export default function ImageStudio({ onBack, backLabel = 'بازگشت به چت' }: { onBack: () => void; backLabel?: string }) {
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
  const [imagePriceNoa, setImagePriceNoa] = useState('');
  const [imageToImagePriceNoa, setImageToImagePriceNoa] = useState('');
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [imageSettingsOpen, setImageSettingsOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [sortOpen, setSortOpen] = useState(false);
  const inFlight = useRef(false);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const referenceInputRef = useRef<HTMLInputElement | null>(null);
  const referenceUrlsRef = useRef<string[]>([]);
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

  useEffect(() => () => {
    referenceUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const load = async (cursor = 0) => {
    try {
      const [data, imageToImageJobs] = await Promise.all([
        listGalleryImages(cursor),
        cursor ? Promise.resolve([]) : listImageToImageJobs().catch(() => [])
      ]);
      const generated = data.items.map((item) => ({ ...item, source: 'image-generation' as const }));
      const nextItems = cursor ? generated : [...generated, ...imageToImageJobs.map(asGalleryImage)];
      setItems((old) => cursor
        ? [...old, ...nextItems.filter((item) => !old.some((current) => current.id === item.id && current.source === item.source))]
        : nextItems);
      setNextCursor(data.nextCursor);
      setGalleryError('');
    } catch (e) { setGalleryError(e instanceof Error ? e.message : 'دریافت تصاویر انجام نشد.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    let active = true;
    void fetchNoaPublicConfig()
      .then((config) => {
        if (!active) return;
        const price = config.pricingConfigs.find((item) => item.actionKey === 'image_generation' && item.isActive);
        const imageToImagePrice = config.pricingConfigs.find((item) => item.actionKey === 'image_to_image' && item.isActive);
        setImagePriceNoa(price?.unitPrice || '');
        setImageToImagePriceNoa(imageToImagePrice?.unitPrice || '');
      })
      .catch(() => {
        if (active) { setImagePriceNoa(''); setImageToImagePriceNoa(''); }
      });
    return () => { active = false; };
  }, []);
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
  const generationPendingIds = useMemo(() => items.filter((x) => x.source !== 'image-to-image' && ['QUEUE', 'WAITING', 'RUNNING'].includes(x.status)).map((x) => x.id), [items]);
  const imageToImagePendingIds = useMemo(() => items.filter((x) => x.source === 'image-to-image' && ['QUEUE', 'WAITING', 'RUNNING'].includes(x.status)).map((x) => x.id), [items]);
  useEffect(() => {
    if (!generationPendingIds.length && !imageToImagePendingIds.length) return;
    let stopped = false; let delay = 1800;
    const poll = async () => {
      let hasPending = false;
      for (const id of generationPendingIds) {
        try {
          const result = await getImageGenerationStatus(id);
          if (['QUEUE', 'WAITING', 'RUNNING'].includes(result.status)) hasPending = true;
          if (!stopped) setItems((old) => old.map((x) => x.id === id ? { ...x, ...result, updatedAt: new Date().toISOString() } : x));
          if (['COMPLETED', 'ERROR'].includes(result.status)) window.dispatchEvent(new Event('noa:wallet-changed'));
        } catch { hasPending = true; }
      }
      for (const id of imageToImagePendingIds) {
        try {
          const job = asGalleryImage(await getImageToImageJob(id));
          if (['QUEUE', 'WAITING', 'RUNNING'].includes(job.status)) hasPending = true;
          if (!stopped) setItems((old) => old.map((item) => item.id === id && item.source === 'image-to-image' ? job : item));
          if (['COMPLETED', 'ERROR'].includes(job.status)) window.dispatchEvent(new Event('noa:wallet-changed'));
        } catch { hasPending = true; }
      }
      if (!stopped && hasPending) { delay = Math.min(8000, Math.round(delay * 1.35)); window.setTimeout(poll, delay); }
    };
    const timer = window.setTimeout(poll, delay);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [generationPendingIds.join(','), imageToImagePendingIds.join(',')]);
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
      const submitted = referenceImages.length > 0
        ? asGalleryImage(await startImageToImage({ prompt: value, aspectRatio: ratio, files: referenceImages.map((item) => item.file), idempotencyKey: key }))
        : null;
      const { taskId } = submitted ? { taskId: submitted.id } : editSource ? await startImageEdit(editSource.id, value, ratio, key) : await startImageGeneration(value, { aspectRatio: ratio, idempotencyKey: key });
      window.dispatchEvent(new Event('noa:wallet-changed'));
      const optimistic: GalleryImage = submitted || { id: taskId, taskId, originalPrompt: value, refinedPrompt: value, aspectRatio: ratio, operation: editSource ? 'edit' : 'generate', parentImageId: editSource?.id, status: 'QUEUE', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), source: 'image-generation' };
      setItems((old) => [optimistic, ...old.filter((item) => item.id !== taskId || item.source !== optimistic.source)]);
      referenceUrlsRef.current.forEach((url) => URL.revokeObjectURL(url)); referenceUrlsRef.current = [];
      setReferenceImages([]); setReferencePickerOpen(false); setTab('gallery'); setEditSource(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'درخواست انجام نشد.'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const reuse = (item: GalleryImage, edit = false) => { setPrompt(edit ? '' : getUserFacingPrompt(item.originalPrompt)); setRatio(item.aspectRatio === '9:16' || item.aspectRatio === '16:9' ? item.aspectRatio : '1:1'); setEditSource(edit ? item : null); setSelected(null); setError(''); setTab('create'); };
  const remove = async (item: GalleryImage) => { if (item.source === 'image-to-image') return; if (!confirm('این تصویر از گالری حذف شود؟')) return; try { await deleteGalleryImage(item.id); setItems((old) => old.filter((x) => x.id !== item.id)); setSelected(null); } catch (e) { setError(e instanceof Error ? e.message : 'حذف انجام نشد.'); } };
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
    else if (action === 'edit' && item.source !== 'image-to-image') reuse(item, true);
    else if (action === 'similar') reuse(item);
    else if (action === 'delete') void remove(item);
  }, [download, reuse, remove]);

  const addReferenceFiles = (files: FileList | File[]) => {
    const incoming = Array.from(files);
    const available = MAX_REFERENCE_IMAGES - referenceImages.length;
    if (!available) { setError('حداکثر ۴ تصویر مرجع می‌توانی اضافه کنی.'); return; }
    if (incoming.some((file) => !REFERENCE_IMAGE_TYPES.has(file.type) || file.size > MAX_REFERENCE_IMAGE_BYTES)) {
      setError('فقط JPEG، PNG یا WebP با حجم حداکثر ۱۰ مگابایت قابل انتخاب است.'); return;
    }
    const accepted = incoming.slice(0, available).map((file) => ({ id: requestKey(), file, previewUrl: URL.createObjectURL(file) }));
    referenceUrlsRef.current.push(...accepted.map((item) => item.previewUrl));
    setReferenceImages((current) => [...current, ...accepted]); setReferencePickerOpen(true); setError('');
  };
  const removeReferenceImage = (id: string) => {
    setReferenceImages((current) => {
      const item = current.find((reference) => reference.id === id);
      if (item) { URL.revokeObjectURL(item.previewUrl); referenceUrlsRef.current = referenceUrlsRef.current.filter((url) => url !== item.previewUrl); }
      return current.filter((reference) => reference.id !== id);
    });
  };
  const referencePicker = (compact = false) => <section className={`studio-reference-picker${compact ? ' compact' : ''}`} aria-label="تصویر مرجع">
    {referenceImages.length === 0 ? <button type="button" className="studio-reference-picker__empty" onClick={() => referenceInputRef.current?.click()} disabled={busy}>
      <span className="studio-reference-picker__empty-icon" aria-hidden="true"><Icon name="upload" size={18} /></span>
      <span><strong>افزودن تصویر مرجع</strong><small>اختیاری · برای ویرایش یا ترکیب عکس با متن</small></span>
      <span className="studio-reference-picker__empty-action" aria-hidden="true">افزودن</span>
    </button> : <>
      <button type="button" className="studio-reference-picker__summary" onClick={() => setReferencePickerOpen((open) => !open)} aria-expanded={referencePickerOpen}>
        <span><strong>{referenceImages.length} تصویر مرجع</strong><small>برای ویرایش با تصویر آماده است</small></span><span className="studio-reference-picker__manage">{referencePickerOpen ? 'بستن' : 'مدیریت'}</span>
      </button>
      {referencePickerOpen && <div className="studio-reference-picker__content">
        <p>تصویر اول مبنای ویرایش است؛ تا سه تصویر دیگر فقط مرجع‌اند.</p>
        <div className="studio-reference-grid">{referenceImages.map((item, index) => <figure key={item.id} className={index === 0 ? 'primary' : ''}><img src={item.previewUrl} alt={index === 0 ? 'تصویر اصلی' : `تصویر مرجع ${index + 1}`} /><figcaption>{index === 0 ? 'تصویر اصلی ۱' : `تصویر مرجع ${index + 1}`}</figcaption><button type="button" onClick={() => removeReferenceImage(item.id)} aria-label={`حذف تصویر ${index + 1}`}>×</button></figure>)}</div>
        {referenceImages.length < MAX_REFERENCE_IMAGES && <button type="button" className="studio-reference-picker__add" onClick={() => referenceInputRef.current?.click()} disabled={busy}>＋ افزودن تصویر دیگر</button>}
      </div>}
    </>}
  </section>;
  const imageSettings = (compact = false) => <section className={`studio-settings-accordion${compact ? ' compact' : ''}`} aria-label="تنظیمات تصویر">
    <button type="button" className="studio-settings-accordion__summary" onClick={() => setImageSettingsOpen((open) => !open)} aria-expanded={imageSettingsOpen} disabled={busy}>
      <span className="studio-settings-accordion__title"><span className="studio-settings-icon" aria-hidden="true"><Icon name="settings" size={18} /></span><span><strong>تنظیمات تصویر</strong><small>نسبت و قاب خروجی</small></span></span>
      <span className="studio-settings-accordion__value"><b>{ratios.find((item) => item.value === ratio)?.label}</b><small>{ratio}</small></span>
      <span className={`studio-settings-accordion__chevron${imageSettingsOpen ? ' is-open' : ''}`} aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m7 10 5 5 5-5" /></svg></span>
    </button>
    {imageSettingsOpen && <div className="studio-settings-accordion__content">
      <fieldset className="ratio-field">
        <legend>نسبت تصویر</legend>
        <div className="ratio-options" role="group" aria-label="انتخاب نسبت تصویر">
          {ratios.map((option) => <button type="button" key={option.value} className={ratio === option.value ? 'active' : ''} aria-pressed={ratio === option.value} onClick={() => setRatio(option.value)} disabled={busy}>
            <i className={`ratio-shape ratio-${option.value.replace(':', '-')}`} aria-hidden="true" />
            <span>{option.label}</span><small>{option.value}</small>{ratio === option.value ? <Icon name="check" size="1em" aria-hidden="true" /> : null}
          </button>)}
        </div>
      </fieldset>
      <section className="studio-output-summary" aria-label="خلاصه خروجی"><span>خروجی انتخاب‌شده</span><strong>{ratios.find((item) => item.value === ratio)?.label} <em>{ratio}</em></strong><p>{ratios.find((item) => item.value === ratio)?.description}</p></section>
    </div>}
  </section>;
  const imageToImageActive = referenceImages.length > 0;
  const activePriceNoa = imageToImageActive ? imageToImagePriceNoa : imagePriceNoa;

  return <main className="studio" dir="rtl">
    <div className="studio-shell">
    <header className="studio-header">
      <div className="studio-brand">
        <span className="studio-brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Z" /><path d="m18.5 15 .7 2.8L22 18.5l-2.8.7-.7 2.8-.7-2.8-2.8-.7 2.8-.7.7-2.8Z" /></svg>
        </span>
        <span className="studio-brand-copy">
          <h1>استودیوی تصویر</h1>
          <small>ایده‌ات را به تصویر تبدیل کن</small>
        </span>
      </div>
      <Button type="button" variant="ghost" className="studio-header-back" onClick={onBack} aria-label={backLabel} title={backLabel}>
        <svg className="studio-header-back__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M15 18 9 12l6-6" />
        </svg>
        <span className="studio-header-back__label">{backLabel}</span>
      </Button>
      <span className="studio-header-spacer" aria-hidden="true" />
    </header>
    <div className="studio-tabs" role="tablist" aria-label="بخش‌های استودیوی تصویر"><span className={`studio-tab-indicator ${tab === 'gallery' ? 'gallery' : ''}`} aria-hidden="true" /><button type="button" role="tab" aria-selected={tab === 'create'} className={tab === 'create' ? 'active' : ''} onClick={() => setTab('create')}>ساخت تصویر</button><button type="button" role="tab" aria-selected={tab === 'gallery'} className={tab === 'gallery' ? 'active' : ''} onClick={() => setTab('gallery')}>تصاویر من</button></div>
    {(error || (tab === 'gallery' && galleryError)) && <div className="studio-error" role="alert"><span className="studio-error-icon" aria-hidden="true">!</span><span>{error || galleryError}</span><button type="button" onClick={() => { setError(''); setGalleryError(''); }} aria-label="بستن پیام"><Icon name="x-close" size="1em" /></button></div>}
    {tab === 'create' ? <form className="studio-create" onSubmit={submit}>
      <input ref={referenceInputRef} className="studio-reference-input" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { if (event.target.files) addReferenceFiles(event.target.files); event.currentTarget.value = ''; }} />
      {editSource && <section className="studio-edit-workspace" aria-label="تصویر مبدا ویرایش">
        <div className="studio-source-preview">{editSource.imageUrl && <ProtectedImage src={editSource.imageUrl} alt="تصویر مبدا ویرایش" />}<span aria-hidden="true">اصل</span></div>
        <div className="studio-source-copy"><small>ویرایش تصویر</small><strong>یک نسخه‌ی تازه می‌سازیم</strong><p>تصویر اصلی بدون تغییر در گالری می‌ماند.</p></div>
        <button type="button" onClick={() => { setEditSource(null); setPrompt(''); setTab('gallery'); }}>تغییر تصویر</button>
      </section>}
      <div className="studio-create-grid">
        <section className="studio-prompt-card">
          <div className="studio-prompt-block">
            <label htmlFor="studio-prompt"><span>{imageToImageActive || editSource ? 'چه تغییری می‌خواهی؟' : 'چی توی ذهنت داری؟'}</span><small>{prompt.length}/۷۰۰</small></label>
            <p className="studio-field-help">سوژه، سبک، نور و حس تصویر را با چند کلمه توضیح بده.</p>
            <div className="studio-textarea-wrap"><Icon name="sparkle" size="1em" className="studio-input-spark" aria-hidden="true" /><textarea ref={promptInputRef} id="studio-prompt" value={prompt} onChange={(e) => { setPrompt(e.target.value.slice(0, 700)); setError(''); }} placeholder="مثلاً یک کلبه‌ی شیشه‌ای وسط جنگل، نور صبح و حس آرام..." rows={5} disabled={busy} maxLength={700} /></div>
            <div className="studio-mobile-create-controls">
              {imageSettings(true)}
              {referencePicker(true)}
            </div>
            <div className="studio-idea-section">
              <span>برای شروع، یکی را انتخاب کن</span>
              <div className="studio-ideas" aria-label="ایده‌های پیشنهادی" aria-describedby="studio-ideas-hint">
                {(imageToImageActive || editSource ? editIdeas : promptIdeas).map((idea) => (
                  <button
                    type="button"
                    key={idea}
                    onClick={() => {
                      setPrompt(idea);
                      window.requestAnimationFrame(() => promptInputRef.current?.focus());
                    }}
                    disabled={busy}
                  >
                    {idea}
                  </button>
                ))}
              </div>
              <small id="studio-ideas-hint" className="studio-ideas-scroll-hint"><Icon name="chevron-left" size="1em" aria-hidden="true" /> برای دیدن ایده‌های بیشتر، ردیف را حرکت بده.</small>
            </div>
          </div>
          <div className="studio-submit-dock">
            <button className="studio-submit" disabled={busy || prompt.trim().length < 8}><Icon name="sparkle" size={18} className="studio-submit-icon" aria-hidden="true" /><span>{busy ? 'در حال ارسال درخواست...' : imageToImageActive || editSource ? 'ویرایش با تصویر' : 'ساخت تصویر'}</span>{busy && <i aria-hidden="true" />}</button>
            <small>{activePriceNoa ? `هزینه این عملیات ${formatDecimalFa(activePriceNoa)} نوآ است؛ قیمت از تنظیم زنده سامانه خوانده می‌شود.` : imageToImageActive ? 'قیمت ویرایش تصویر پیش از ثبت در سرور بررسی می‌شود.' : editSource ? 'تصویر اصلی شما بدون تغییر باقی می‌ماند.' : 'قیمت زنده پیش از ثبت در سرور بررسی می‌شود.'}</small>
          </div>
        </section>
        <aside className="studio-settings-card" aria-label="تنظیمات تصویر">
          {imageSettings()}
          {referencePicker()}
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
          <div className="gallery-grid">{sortedItems.map((item) => <button type="button" className={`image-card ${item.status.toLowerCase()}`} style={{ aspectRatio: item.aspectRatio.replace(':', '/') }} key={`${item.source || 'image-generation'}:${item.id}`} onClick={() => item.status === 'COMPLETED' && setSelected(item)}>{item.status === 'COMPLETED' && item.imageUrl ? <>
            <ProtectedImage src={item.imageUrl} alt={item.originalPrompt} />
            <div className="card-overlay" aria-hidden="true">
              <div className="card-overlay-actions">
                <button type="button" onClick={(e) => handleCardAction(e, item, 'view')} aria-label="مشاهده تصویر">مشاهده</button>
                <button type="button" onClick={(e) => handleCardAction(e, item, 'download')} aria-label="دانلود تصویر">دانلود</button>
                {item.source !== 'image-to-image' && <><button type="button" onClick={(e) => handleCardAction(e, item, 'edit')} aria-label="ویرایش تصویر">ویرایش</button><button type="button" onClick={(e) => handleCardAction(e, item, 'similar')} aria-label="ساخت مشابه">مشابه</button><button type="button" onClick={(e) => handleCardAction(e, item, 'delete')} aria-label="حذف تصویر">حذف</button></>}
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
