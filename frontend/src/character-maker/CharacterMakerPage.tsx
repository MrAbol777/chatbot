import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dialog, useNotification } from '../design-system/components';
import Icon from '../components/Icon';
import ImageViewer from '../ImageViewer';
import { fetchProtectedImageBlobUrl, type GalleryImage, getImageGenerationStatus, startImageEdit, startImageGeneration } from '../services/imageGeneration';
import { analyzeCharacters, createCharacterWorkspace, getCharacterWorkspace, listCharacterWorkspaces, updateCharacterWorkspace } from './characterMaker.api';
import { clearCharacterScenarioHandoff, readCharacterScenarioHandoff, type CharacterScenarioHandoff } from './characterScenarioHandoff';
import type { CharacterImageState, CharacterWorkspace, CharacterWorkspaceStatus } from './characterMaker.types';
import './CharacterMakerPage.css';

type Props = { onBack: () => void };
type Tab = 'create' | 'library';
type ImageEditTarget = { id: string; name: string; ratio: '1:1' | '16:9' };
type ImagePreviewTarget = { id: string; name: string; imageUrl: string; ratio: '1:1' | '16:9' };

const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const imageState = (taskId: string, options: Partial<CharacterImageState> = {}): CharacterImageState => ({ taskId, status: 'QUEUE', imageUrl: null, error: null, ...options });
const statusText = (status?: CharacterImageState['status']) => status === 'COMPLETED' ? 'تصویر آماده است' : status === 'ERROR' ? 'ساخت ناموفق بود' : status && status !== 'idle' ? 'در حال ساخت تصویر' : 'آماده‌ی ساخت تصویر';

function SecureImage({ src, alt }: { src?: string | null; alt: string }) {
  const [blobUrl, setBlobUrl] = useState('');
  useEffect(() => {
    let current = true; let objectUrl = '';
    if (!src) { setBlobUrl(''); return; }
    void fetchProtectedImageBlobUrl(src).then((url) => { objectUrl = url; if (current) setBlobUrl(url); }).catch(() => { if (current) setBlobUrl(''); });
    return () => { current = false; if (objectUrl.startsWith('blob:')) URL.revokeObjectURL(objectUrl); };
  }, [src]);
  return blobUrl ? <img src={blobUrl} alt={alt} /> : <span className="character-maker__image-placeholder"><Icon name="sparkle" size={24} aria-hidden="true" /></span>;
}

function ImagePreviewButton({ image, alt, onOpen }: { image?: CharacterImageState; alt: string; onOpen: () => void }) {
  const src = image?.imageUrl || image?.previousImageUrl;
  if (!src) return <SecureImage src={src} alt={alt} />;
  return <button type="button" className="character-maker__image-button" onClick={onOpen} aria-label={`نمایش بزرگ ${alt}`} title="نمایش بزرگ تصویر"><SecureImage src={src} alt={alt} /><span><Icon name="zoom-in" size={17} aria-hidden="true" />نمایش</span></button>;
}

export default function CharacterMakerPage({ onBack }: Props) {
  const [tab, setTab] = useState<Tab>('create');
  const [scenario, setScenario] = useState('');
  const [scenarioHandoff, setScenarioHandoff] = useState<CharacterScenarioHandoff | null>(() => readCharacterScenarioHandoff());
  const [workspace, setWorkspace] = useState<CharacterWorkspace | null>(null);
  const [library, setLibrary] = useState<CharacterWorkspace[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [error, setError] = useState('');
  const [imageEditTarget, setImageEditTarget] = useState<ImageEditTarget | null>(null);
  const [imageEditRequest, setImageEditRequest] = useState('');
  const [imageEditError, setImageEditError] = useState('');
  const [isEditingImage, setIsEditingImage] = useState(false);
  const [imagePreview, setImagePreview] = useState<ImagePreviewTarget | null>(null);
  const saveTimer = useRef<number | null>(null);
  const resultsRef = useRef<HTMLElement | null>(null);
  const shouldAutoScrollResults = useRef(false);
  const { notify } = useNotification();
  const analysis = workspace?.analysis || null;
  const activeItems = useMemo(() => analysis ? [...analysis.characters.map((character) => ({ id: character.id, prompt: character.imagePrompt, ratio: '1:1' as const, kind: 'character' as const })), { id: 'setting', prompt: analysis.setting.imagePrompt, ratio: '16:9' as const, kind: 'setting' as const }] : [], [analysis]);
  const completedCount = activeItems.filter((item) => (item.kind === 'setting' ? analysis?.setting.image : analysis?.characters.find((character) => character.id === item.id)?.image)?.status === 'COMPLETED').length;
  const imageEditSource = imageEditTarget
    ? imageEditTarget.id === 'setting'
      ? analysis?.setting.image
      : analysis?.characters.find((character) => character.id === imageEditTarget.id)?.image
    : null;
  const imagePreviewItem: GalleryImage | null = imagePreview ? {
    id: imagePreview.id, taskId: imagePreview.id, originalPrompt: imagePreview.name, refinedPrompt: imagePreview.name,
    aspectRatio: imagePreview.ratio, operation: 'generate', status: 'COMPLETED', imageUrl: imagePreview.imageUrl,
    createdAt: '', updatedAt: ''
  } : null;

  const refreshLibrary = async () => {
    setLoadingLibrary(true);
    try { setLibrary(await listCharacterWorkspaces()); } catch { /* Empty state is still useful offline. */ } finally { setLoadingLibrary(false); }
  };
  useEffect(() => { void refreshLibrary(); }, []);

  useEffect(() => {
    if (!scenarioHandoff) return;
    setScenario(scenarioHandoff.scenario);
    setTab('create');
  }, [scenarioHandoff]);

  useEffect(() => {
    if (!analysis || !shouldAutoScrollResults.current) return;
    const animationFrame = window.requestAnimationFrame(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      shouldAutoScrollResults.current = false;
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [analysis]);

  const workspacePayload = (next: CharacterWorkspace, status: CharacterWorkspaceStatus = next.status) => ({ title: next.title, scenario: next.scenario, status, analysis: next.analysis });
  const persist = async (next: CharacterWorkspace, status?: CharacterWorkspaceStatus) => {
    const saved = await updateCharacterWorkspace(next.id, workspacePayload(next, status));
    setWorkspace(saved); setLibrary((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
    return saved;
  };
  useEffect(() => () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); }, []);

  const handleAnalyze = async () => {
    const text = scenario.trim();
    if (!text) { setError('سناریو را وارد کن تا شخصیت‌ها را پیدا کنیم.'); return; }
    setError(''); setIsAnalyzing(true);
    try {
      const nextAnalysis = await analyzeCharacters(text);
      const saved = await createCharacterWorkspace({ title: nextAnalysis.title, scenario: text, status: 'review', analysis: nextAnalysis });
      shouldAutoScrollResults.current = true;
      setWorkspace(saved); setScenario(text); setTab('create');
      clearCharacterScenarioHandoff();
      setScenarioHandoff(null);
      void refreshLibrary();
      notify.success(`${nextAnalysis.characters.length} کاراکتر و فضای داستان آماده شد.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'تحلیل انجام نشد.'); }
    finally { setIsAnalyzing(false); }
  };

  const updateImageState = (source: CharacterWorkspace, targetId: string, nextImage: CharacterImageState): CharacterWorkspace => {
    if (!source.analysis) return source;
    return targetId === 'setting'
      ? { ...source, analysis: { ...source.analysis, setting: { ...source.analysis.setting, image: nextImage } } }
      : { ...source, analysis: { ...source.analysis, characters: source.analysis.characters.map((character) => character.id === targetId ? { ...character, image: nextImage } : character) } };
  };

  const openImageEditor = (target: ImageEditTarget) => {
    const image = target.id === 'setting' ? analysis?.setting.image : analysis?.characters.find((character) => character.id === target.id)?.image;
    if (!image?.taskId || image.status !== 'COMPLETED') {
      notify.error('اول صبر کن تصویر این بخش کامل شود.');
      return;
    }
    setImageEditTarget(target); setImageEditRequest(''); setImageEditError('');
  };

  const downloadPreview = async (item: GalleryImage) => {
    if (!item.imageUrl) return;
    try {
      const url = await fetchProtectedImageBlobUrl(item.imageUrl);
      const link = document.createElement('a');
      link.href = url; link.download = `${item.originalPrompt || 'character-image'}.jpg`; link.click();
      if (url.startsWith('blob:')) window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch { notify.error('دانلود تصویر انجام نشد.'); }
  };

  const submitImageEdit = async () => {
    if (!workspace?.analysis || !imageEditTarget || isEditingImage) return;
    const request = imageEditRequest.trim();
    if (request.length < 8) { setImageEditError('کمی دقیق‌تر بگو چه چیزی باید تغییر کند.'); return; }
    const currentImage = imageEditTarget.id === 'setting'
      ? workspace.analysis.setting.image
      : workspace.analysis.characters.find((character) => character.id === imageEditTarget.id)?.image;
    if (!currentImage?.taskId || currentImage.status !== 'COMPLETED') { setImageEditError('تصویر مرجع دیگر آماده نیست؛ یک‌بار صفحه را تازه کن.'); return; }
    setIsEditingImage(true); setImageEditError(''); setError('');
    try {
      const result = await startImageEdit(currentImage.taskId, request, imageEditTarget.ratio, makeId(`character-edit-${imageEditTarget.id}`));
      const next = updateImageState(workspace, imageEditTarget.id, imageState(result.taskId, {
        operation: 'edit', previousImageUrl: currentImage.imageUrl || currentImage.previousImageUrl || null
      }));
      await persist(next, 'generating');
      setImageEditTarget(null); setImageEditRequest('');
      notify.success(`ویرایش تصویر ${imageEditTarget.name} شروع شد؛ هویت اصلی حفظ می‌شود.`);
    } catch (cause) { setImageEditError(cause instanceof Error ? cause.message : 'ویرایش تصویر شروع نشد.'); }
    finally { setIsEditingImage(false); }
  };

  const generateImages = async () => {
    if (!workspace?.analysis || isGenerating) return;
    setIsGenerating(true); setError('');
    let next = workspace;
    try {
      for (const item of activeItems) {
        const existing = item.kind === 'setting' ? next.analysis?.setting.image : next.analysis?.characters.find((character) => character.id === item.id)?.image;
        if (existing?.taskId && existing.status !== 'ERROR') continue;
        const result = await startImageGeneration(item.prompt, { aspectRatio: item.ratio, idempotencyKey: makeId(`character-${item.id}`) });
        next = updateImageState(next, item.id, imageState(result.taskId));
        setWorkspace(next);
      }
      await persist(next, 'generating');
      notify.success('ساخت تصاویر شروع شد؛ کارت‌ها خودکار به‌روزرسانی می‌شوند.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'ارسال ساخت تصویر انجام نشد.'); }
    finally { setIsGenerating(false); }
  };

  useEffect(() => {
    if (!workspace?.analysis || !activeItems.some((item) => {
      const image = item.kind === 'setting' ? workspace.analysis?.setting.image : workspace.analysis?.characters.find((character) => character.id === item.id)?.image;
      return image?.taskId && image.status !== 'COMPLETED' && image.status !== 'ERROR';
    })) return;
    const poll = async () => {
      let next = workspace;
      let changed = false;
      for (const item of activeItems) {
        const previous = item.kind === 'setting' ? next.analysis?.setting.image : next.analysis?.characters.find((character) => character.id === item.id)?.image;
        if (!previous?.taskId || previous.status === 'COMPLETED' || previous.status === 'ERROR') continue;
        try {
          const status = await getImageGenerationStatus(previous.taskId);
          if (status.status !== previous.status || status.imageUrl !== previous.imageUrl || status.error !== previous.error) {
            next = updateImageState(next, item.id, { ...previous, status: status.status, imageUrl: status.imageUrl, error: status.error }); changed = true;
          }
        } catch { /* A later poll will retry. */ }
      }
      if (changed) {
        const allDone = activeItems.every((item) => {
          const image = item.kind === 'setting' ? next.analysis?.setting.image : next.analysis?.characters.find((character) => character.id === item.id)?.image;
          return image?.status === 'COMPLETED' || image?.status === 'ERROR';
        });
        try { await persist(next, allDone ? 'completed' : 'generating'); } catch { setWorkspace(next); }
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3500);
    return () => window.clearInterval(timer);
  }, [workspace?.id, workspace?.analysis, activeItems]);

  const openLibraryItem = async (id: string) => {
    try { const next = await getCharacterWorkspace(id); setWorkspace(next); setScenario(next.scenario); setTab('create'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'پروژه باز نشد.'); }
  };

  const workspaceState = isAnalyzing
    ? 'در حال تحلیل'
    : workspace?.status === 'generating'
      ? 'در حال ساخت'
      : workspace?.status === 'completed'
        ? 'تکمیل‌شده'
        : workspace
          ? 'ذخیره‌شده'
          : 'پروژه تازه';

  return <main className="character-maker" dir="rtl" id="main-content">
    <header className="character-maker__header">
      <Button type="button" variant="ghost" iconOnly className="character-maker__back" onClick={onBack} aria-label="بازگشت به استودیو" title="بازگشت به استودیو" startIcon={<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9 18 6-6-6-6" /></svg>} />
      <div className="character-maker__brand"><span className="character-maker__brand-mark"><Icon name="family" size={20} aria-hidden="true" /></span><span className="character-maker__brand-copy"><strong>ساخت کاراکتر</strong><small>هویت تصویری ثابت برای داستان‌های تو</small></span></div>
      <span className="character-maker__workspace-state" aria-live="polite">{workspaceState}</span>
    </header>
    <nav className="character-maker__tabs" role="tablist" aria-label="بخش‌های ساخت کاراکتر"><button id="character-create-tab" type="button" role="tab" aria-selected={tab === 'create'} aria-controls="character-create-panel" tabIndex={tab === 'create' ? 0 : -1} onClick={() => setTab('create')}>کارگاه ساخت</button><button id="character-library-tab" type="button" role="tab" aria-selected={tab === 'library'} aria-controls="character-library-panel" tabIndex={tab === 'library' ? 0 : -1} onClick={() => setTab('library')}>کتابخانه <i>{library.length}</i></button></nav>

    {tab === 'library' ? <section id="character-library-panel" role="tabpanel" aria-labelledby="character-library-tab" className="character-maker__library" aria-label="کتابخانهٔ کاراکترها"><div className="character-maker__section-heading"><span>کتابخانه‌ی شخصیت‌ها</span><h1 id="character-library-title">قهرمان‌هایت اینجا ماندگار می‌شوند</h1><p>هر پروژه، هویت ثابت، پرامپت‌های حرفه‌ای و تصویر مرجع خودش را نگه می‌دارد.</p></div>{loadingLibrary ? <div className="character-maker__loading"><Icon name="spinner" size={28} aria-hidden="true" />در حال خواندن کتابخانه…</div> : library.length ? <div className="character-maker__library-grid">{library.map((item) => <button key={item.id} type="button" className="character-maker__library-card" onClick={() => void openLibraryItem(item.id)}><span className="character-maker__library-card-icon"><Icon name="family" size={24} aria-hidden="true" /></span><strong>{item.title}</strong><small>{new Intl.DateTimeFormat('fa-IR', { day: 'numeric', month: 'long' }).format(new Date(item.updatedAt))}</small><i>{item.status === 'completed' ? 'تکمیل‌شده' : item.status === 'generating' ? 'در حال ساخت' : 'آماده‌ی بررسی'}</i><Icon name="chevron-left" size={18} aria-hidden="true" /></button>)}</div> : <div className="character-maker__empty"><Icon name="family" size={30} aria-hidden="true" /><h2>هنوز کاراکتری ذخیره نشده</h2><p>سناریوی اولت را تحلیل کن تا کتابخانه‌ات ساخته شود.</p><Button onClick={() => setTab('create')}>شروع ساخت</Button></div>}</section> : <section id="character-create-panel" role="tabpanel" aria-labelledby="character-create-tab" className="character-maker__create-panel">
      <section className="character-maker__hero"><div className="character-maker__hero-copy"><span className="character-maker__eyebrow"><Icon name="sparkle" size={15} aria-hidden="true" /> CHARACTER INTELLIGENCE</span><h1>هر قهرمان، یک هویتِ ماندگار</h1><p>سناریو را بده؛ دانوآ شخصیت‌ها، رابطه‌ها، استایل و پرامپت آماده‌ی تولید تصویر را جدا می‌سازد.</p><div className="character-maker__hero-points"><span>تحلیل نقش‌ها</span><span>پرامپت حرفه‌ای</span><span>تصویر مرجع</span></div></div><div className="character-maker__orbital" aria-hidden="true"><i /><b /><span><Icon name="family" size={46} /></span></div></section>
      <section className="character-maker__scenario-panel" aria-labelledby="character-scenario-title"><div><span className="character-maker__step">۱</span><div><h2 id="character-scenario-title">سناریو را وارد کن</h2><p>اسم‌ها، رفتارها، موقعیت‌ها و رابطه‌ها را پیدا می‌کنیم؛ لازم نیست فرم طولانی پر کنی.</p></div></div>{scenarioHandoff ? <aside className="character-maker__story-handoff" role="status"><span><Icon name="story" size={18} aria-hidden="true" /></span><div><strong>{scenarioHandoff.title ? `سناریوی «${scenarioHandoff.title}» آماده است` : 'سناریوی ساخته‌شده آماده است'}</strong><p>متن از سناریونویسی وارد شده؛ وقتی آماده‌ای، کاراکترها را تشخیص بده.</p></div></aside> : null}<label className="character-maker__scenario-input"><span>سناریوی داستان</span><textarea value={scenario} onChange={(event) => setScenario(event.target.value.slice(0, 8000))} placeholder="مثلاً: آرین، پسری کنجکاو، همراه دوست رباتش نیکا وارد کتابخانه‌ی شناور شهر می‌شود…" maxLength={8000} disabled={isAnalyzing} /></label><div className="character-maker__scenario-footer"><small>{new Intl.NumberFormat('fa-IR').format(scenario.length)} / ۸٬۰۰۰</small><Button type="button" className={scenarioHandoff ? 'character-maker__analyze-button is-story-handoff' : 'character-maker__analyze-button'} onClick={() => void handleAnalyze()} disabled={isAnalyzing || !scenario.trim()} startIcon={<Icon name={isAnalyzing ? 'spinner' : 'sparkle'} size={18} aria-hidden="true" />}>{isAnalyzing ? 'داریم سناریو را می‌خوانیم…' : 'تشخیص کاراکترها'}</Button></div></section>
      {error ? <p className="character-maker__error" role="alert"><Icon name="alert-triangle" size={18} aria-hidden="true" />{error}</p> : null}
      {analysis ? <section ref={resultsRef} className="character-maker__results" aria-live="polite" tabIndex={-1}><div className="character-maker__result-heading"><div><span className="character-maker__step">۲</span><h2>{analysis.title}</h2><p>{analysis.summary}</p></div><div className="character-maker__result-actions"><span>{completedCount} از {activeItems.length} تصویر آماده</span><Button type="button" onClick={() => void generateImages()} disabled={isGenerating} startIcon={<Icon name={isGenerating ? 'spinner' : 'studio-image'} size={18} aria-hidden="true" />}>{isGenerating ? 'در حال ارسال…' : completedCount ? 'تکمیل تصاویر' : 'ساخت همه‌ی تصاویر'}</Button></div></div><div className="character-maker__style-bar"><Icon name="sparkles" size={18} aria-hidden="true" /><span>سبک تصویر:</span><strong>{analysis.visualStyle}</strong></div><div className="character-maker__character-grid">{analysis.characters.map((character, index) => <article key={character.id} className="character-maker__character-card"><div className="character-maker__image"><ImagePreviewButton image={character.image} alt={`تصویر ${character.name}`} onOpen={() => { const imageUrl = character.image?.imageUrl || character.image?.previousImageUrl; if (imageUrl) setImagePreview({ id: character.image?.taskId || character.id, name: character.name, imageUrl, ratio: '1:1' }); }} /><span className={`character-maker__image-status is-${character.image?.status || 'idle'}`}>{character.image?.status === 'RUNNING' || character.image?.status === 'QUEUE' ? <Icon name="spinner" size={14} aria-hidden="true" /> : <Icon name={character.image?.status === 'COMPLETED' ? 'check' : character.image?.status === 'ERROR' ? 'alert-triangle' : 'sparkle'} size={14} aria-hidden="true" />}{statusText(character.image?.status)}</span></div><div className="character-maker__character-main"><span className="character-maker__character-number">کاراکتر {index + 1}</span><h3>{character.name}</h3><p>{character.role || 'نقش داستانی'}</p></div><dl><div><dt>شخصیت</dt><dd>{character.personality || 'در حال تکمیل'}</dd></div><div><dt>رابطه</dt><dd>{character.relationshipNote || 'براساس سناریو'}</dd></div></dl><div className="character-maker__image-edit-action"><Button type="button" variant="secondary" onClick={() => openImageEditor({ id: character.id, name: character.name, ratio: '1:1' })} disabled={character.image?.status !== 'COMPLETED'} startIcon={<Icon name="edit" size={16} aria-hidden="true" />}>ویرایش تصویر</Button></div></article>)}</div><article className="character-maker__setting-card"><div className="character-maker__setting-image"><ImagePreviewButton image={analysis.setting.image} alt={`فضای ${analysis.setting.name}`} onOpen={() => { const imageUrl = analysis.setting.image?.imageUrl || analysis.setting.image?.previousImageUrl; if (imageUrl) setImagePreview({ id: analysis.setting.image?.taskId || 'setting', name: analysis.setting.name, imageUrl, ratio: '16:9' }); }} /></div><div><span className="character-maker__character-number">فضای داستان</span><h3>{analysis.setting.name}</h3><p>{analysis.setting.description}</p><div className="character-maker__setting-actions"><Button type="button" variant="secondary" className="character-maker__setting-edit" onClick={() => openImageEditor({ id: 'setting', name: analysis.setting.name, ratio: '16:9' })} disabled={analysis.setting.image?.status !== 'COMPLETED'} startIcon={<Icon name="edit" size={16} aria-hidden="true" />}>ویرایش تصویر</Button></div></div></article></section> : null}
    </section>}
    <Dialog open={Boolean(imageEditTarget)} title={imageEditTarget ? `ویرایش تصویر ${imageEditTarget.name}` : 'ویرایش تصویر'} onClose={() => { if (!isEditingImage) setImageEditTarget(null); }} dismissible={!isEditingImage} showFooter={false} panelClassName="character-maker__edit-dialog">
      {imageEditTarget ? <div className="character-maker__edit-dialog-content" dir="rtl"><div className="character-maker__edit-source"><SecureImage src={imageEditSource?.imageUrl || imageEditSource?.previousImageUrl} alt={`تصویر فعلی ${imageEditTarget.name}`} /><span>تصویر مرجع</span></div><div className="character-maker__edit-dialog-intro"><span><Icon name="shield" size={19} aria-hidden="true" /></span><div><strong>فقط همان تغییر را اعمال می‌کنیم</strong><p>تصویر فعلی مرجع است؛ هویت، چهره و سبک حفظ می‌شود مگر خودت خلافش را بخواهی.</p></div></div><label htmlFor="character-image-edit-request">چه چیزی را تغییر بدهیم؟<textarea id="character-image-edit-request" value={imageEditRequest} onChange={(event) => { setImageEditRequest(event.target.value.slice(0, 900)); setImageEditError(''); }} placeholder="مثلاً لباس علی را به یک هودی سبز تبدیل کن، بقیهٔ تصویر بدون تغییر بماند." maxLength={900} disabled={isEditingImage} /></label>{imageEditError ? <p className="character-maker__edit-error" role="alert">{imageEditError}</p> : null}<div className="character-maker__edit-actions"><Button type="button" variant="secondary" onClick={() => setImageEditTarget(null)} disabled={isEditingImage}>انصراف</Button><Button type="button" onClick={() => void submitImageEdit()} loading={isEditingImage} disabled={isEditingImage || imageEditRequest.trim().length < 8} startIcon={<Icon name="sparkle" size={17} aria-hidden="true" />}>اعمال تغییر</Button></div></div> : null}
    </Dialog>
    {imagePreviewItem ? <ImageViewer item={imagePreviewItem} onClose={() => setImagePreview(null)} onDownload={(item) => void downloadPreview(item)} /> : null}
  </main>;
}
