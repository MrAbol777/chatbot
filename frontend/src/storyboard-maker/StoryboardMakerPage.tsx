import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { Button, Dialog, useNotification } from '../design-system/components';
import Icon from '../components/Icon';
import { fetchProtectedImageBlobUrl } from '../services/imageGeneration';
import { getImageToImageJob, startImageToImage } from '../services/imageToImage';
import type { ImageToImageJob } from '../services/imageToImage';
import { listCharacterWorkspaces } from '../character-maker/characterMaker.api';
import { analyzeStoryboard, createStoryboardWorkspace, getStoryboardWorkspace, listStoryboardWorkspaces, updateStoryboardWorkspace } from './storyboardMaker.api';
import { readStoryboardScenarioHandoff } from './storyboardScenarioHandoff';
import type { StoryboardCharacterReference, StoryboardPlan, StoryboardSceneState, StoryboardWorkspace, StoryboardWorkspaceStatus } from './storyboardMaker.types';
import './StoryboardMakerPage.css';

type Props = { onBack: () => void };
const MAX_REFERENCES = 4;
type LibraryCharacterSheet = { key: string; name: string; workspaceTitle: string; imageUrl: string };
type StoryboardStage = 'form' | 'waiting-preview' | 'preview' | 'scenes';
type StoryboardTab = 'create' | 'history';
type StoryboardFormStep = 1 | 2 | 3;

const makeId = () => `character-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const getNameFromFile = (file: File) => file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim().slice(0, 60) || 'کاراکتر من';
const makeImageKey = () => `storyboard-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

async function waitForImageJob(job: ImageToImageJob) {
  let current = job;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (current.status === 'succeeded' && current.result?.contentUrl) return current.result.contentUrl;
    if (current.status === 'failed') throw new Error(current.safeErrorMessage || 'ساخت تصویر انجام نشد.');
    await wait(2000);
    current = await getImageToImageJob(job.id);
  }
  throw new Error('ساخت تصویر بیش از حد طول کشید.');
}

function buildOverviewPrompt(plan: StoryboardPlan) {
  const panels = plan.scenes.map((scene) => `PANEL ${scene.number}: ${scene.imagePrompt}`).join('\n\n');
  return `Create ONE cohesive child-safe animated storyboard contact sheet with exactly ${plan.scenes.length} clearly separated cinematic panels, one panel for each scene below, in clear reading order. This is a single review preview of one story, not a random collage. Preserve the identity, face, clothes, colors, and design from every supplied character reference. Use crisp panel borders and one clear story moment per panel. No title, watermark, logo, speech bubbles, captions, or extra text.\n\n${panels}`;
}

function ProtectedSceneImage({ src, alt }: { src?: string; alt: string }) {
  const [blobUrl, setBlobUrl] = useState('');
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    if (!src) { setBlobUrl(''); return; }
    void fetchProtectedImageBlobUrl(src).then((url) => {
      objectUrl = url;
      if (active) setBlobUrl(url);
    }).catch(() => { if (active) setBlobUrl(''); });
    return () => { active = false; if (objectUrl.startsWith('blob:')) URL.revokeObjectURL(objectUrl); };
  }, [src]);
  return blobUrl ? <img src={blobUrl} alt={alt} /> : <span className="storyboard-maker__image-wait"><Icon name="spinner" size={26} aria-hidden="true" />در حال آماده‌سازی تصویر…</span>;
}

function LibraryCharacterImage({ src, alt }: { src: string; alt: string }) {
  const [blobUrl, setBlobUrl] = useState('');
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    void fetchProtectedImageBlobUrl(src).then((url) => {
      objectUrl = url;
      if (active) setBlobUrl(url);
    }).catch(() => { if (active) setBlobUrl(''); });
    return () => { active = false; if (objectUrl.startsWith('blob:')) URL.revokeObjectURL(objectUrl); };
  }, [src]);
  return blobUrl ? <img src={blobUrl} alt={alt} /> : <span className="storyboard-maker__library-image-wait"><Icon name="spinner" size={22} aria-hidden="true" /></span>;
}

export default function StoryboardMakerPage({ onBack }: Props) {
  const [scenarioHandoff] = useState(() => readStoryboardScenarioHandoff());
  const [script, setScript] = useState(() => readStoryboardScenarioHandoff()?.scenario || '');
  const [references, setReferences] = useState<StoryboardCharacterReference[]>([]);
  const [plan, setPlan] = useState<StoryboardPlan | null>(null);
  const [scenes, setScenes] = useState<StoryboardSceneState[]>([]);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [activeTab, setActiveTab] = useState<StoryboardTab>('create');
  const [stage, setStage] = useState<StoryboardStage>('form');
  const [formStep, setFormStep] = useState<StoryboardFormStep>(1);
  const [overviewImageUrl, setOverviewImageUrl] = useState('');
  const [revisionRequest, setRevisionRequest] = useState('');
  const [error, setError] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState('');
  const [librarySheets, setLibrarySheets] = useState<LibraryCharacterSheet[]>([]);
  const [selectedLibraryKeys, setSelectedLibraryKeys] = useState<string[]>([]);
  const [isAddingFromLibrary, setIsAddingFromLibrary] = useState(false);
  const [workspaces, setWorkspaces] = useState<StoryboardWorkspace[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [savedCharacters, setSavedCharacters] = useState<Array<{ id: string; name: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlsRef = useRef(new Set<string>());
  const scenesRef = useRef<StoryboardSceneState[]>([]);
  const activeWorkspaceIdRef = useRef<string | null>(null);
  const workspacePersistenceRef = useRef<Promise<StoryboardWorkspace | null>>(Promise.resolve(null));
  const { notify } = useNotification();

  useEffect(() => () => { previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url)); }, []);
  useEffect(() => { scenesRef.current = scenes; }, [scenes]);
  useEffect(() => {
    let active = true;
    setWorkspacesLoading(true);
    void listStoryboardWorkspaces().then((items) => { if (active) setWorkspaces(items); }).catch(() => { if (active) setHistoryError('دریافت استوری‌بردهای قبلی انجام نشد.'); }).finally(() => { if (active) setWorkspacesLoading(false); });
    return () => { active = false; };
  }, []);

  const addReferences = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const available = MAX_REFERENCES - references.length;
    if (available <= 0) { setError(`برای هر داستان حداکثر ${MAX_REFERENCES} کاراکتر می‌توانی اضافه کنی.`); return; }
    const accepted = files.slice(0, available).filter((file) => ['image/jpeg', 'image/png', 'image/webp'].includes(file.type));
    if (accepted.length !== files.slice(0, available).length) setError('فقط عکس‌های JPG، PNG یا WebP قابل استفاده‌اند.');
    setReferences((items) => [...items, ...accepted.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      previewUrlsRef.current.add(previewUrl);
      return { id: makeId(), name: getNameFromFile(file), file, previewUrl };
    })]);
    event.target.value = '';
  };

  const removeReference = (id: string) => {
    setReferences((items) => {
      const target = items.find((item) => item.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        previewUrlsRef.current.delete(target.previewUrl);
      }
      return items.filter((item) => item.id !== id);
    });
  };

  const updateReferenceName = (id: string, name: string) => setReferences((items) => items.map((item) => item.id === id ? { ...item, name: name.slice(0, 60) } : item));

  const openLibrary = async () => {
    setLibraryOpen(true);
    setLibraryLoading(true);
    setLibraryError('');
    setSelectedLibraryKeys([]);
    try {
      const workspaces = await listCharacterWorkspaces();
      const sheets = workspaces.flatMap((workspace) => (workspace.analysis?.characters || []).flatMap((character) => {
        const imageUrl = character.characterSheet?.status === 'COMPLETED'
          ? character.characterSheet.imageUrl || character.characterSheet.previousImageUrl || ''
          : '';
        return imageUrl ? [{ key: `${workspace.id}:${character.id}`, name: character.name, workspaceTitle: workspace.title, imageUrl }] : [];
      }));
      setLibrarySheets(sheets);
    } catch (reason) {
      setLibraryError(reason instanceof Error ? reason.message : 'کتابخانه‌ی کاراکترها در دسترس نیست.');
    } finally { setLibraryLoading(false); }
  };

  const toggleLibrarySheet = (key: string) => setSelectedLibraryKeys((items) => items.includes(key) ? items.filter((item) => item !== key) : [...items, key]);

  const addSelectedLibrarySheets = async () => {
    const available = MAX_REFERENCES - references.length;
    const chosen = librarySheets.filter((sheet) => selectedLibraryKeys.includes(sheet.key) && !references.some((reference) => reference.sourceKey === sheet.key)).slice(0, available);
    if (!chosen.length) { setLibraryError(available <= 0 ? `حداکثر ${MAX_REFERENCES} کاراکتر می‌توانی اضافه کنی.` : 'یک کاراکترشیت انتخاب کن.'); return; }
    setIsAddingFromLibrary(true);
    setLibraryError('');
    try {
      const items = await Promise.all(chosen.map(async (sheet) => {
        const objectUrl = await fetchProtectedImageBlobUrl(sheet.imageUrl);
        try {
          const response = await fetch(objectUrl);
          if (!response.ok) throw new Error('دریافت کاراکترشیت انجام نشد.');
          const blob = await response.blob();
          const file = new File([blob], `${sheet.name || 'character'}.png`, { type: blob.type || 'image/png' });
          const previewUrl = URL.createObjectURL(file);
          previewUrlsRef.current.add(previewUrl);
          return { id: makeId(), name: sheet.name, file, previewUrl, sourceKey: sheet.key } satisfies StoryboardCharacterReference;
        } finally { if (objectUrl.startsWith('blob:')) URL.revokeObjectURL(objectUrl); }
      }));
      setReferences((current) => [...current, ...items]);
      setLibraryOpen(false);
      notify.success(`${items.length.toLocaleString('fa-IR')} کاراکترشیت اضافه شد.`);
    } catch (reason) {
      setLibraryError(reason instanceof Error ? reason.message : 'اضافه‌کردن کاراکترشیت انجام نشد.');
    } finally { setIsAddingFromLibrary(false); }
  };

  const persistStoryboard = async (status: StoryboardWorkspaceStatus, snapshot: Partial<Pick<StoryboardWorkspace, 'plan' | 'scenes' | 'overviewImageUrl' | 'characters'>> = {}) => {
    const task = workspacePersistenceRef.current.catch(() => null).then(async () => {
      const planValue = snapshot.plan || plan;
      if (!planValue) return null;
      const workspace = {
        title: planValue.title,
        script: script.trim(),
        status,
        characters: snapshot.characters || (references.length ? references.map(({ id, name }) => ({ id, name: name.trim() })) : savedCharacters),
        aspectRatio,
        plan: planValue,
        overviewImageUrl: snapshot.overviewImageUrl ?? overviewImageUrl,
        scenes: snapshot.scenes || scenesRef.current
      };
      const saved = activeWorkspaceIdRef.current
        ? await updateStoryboardWorkspace(activeWorkspaceIdRef.current, workspace)
        : await createStoryboardWorkspace(workspace);
      activeWorkspaceIdRef.current = saved.id;
      setWorkspaces((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
      return saved;
    });
    workspacePersistenceRef.current = task;
    return task;
  };

  const openHistoryWorkspace = async (id: string) => {
    setWorkspacesLoading(true);
    setHistoryError('');
    try {
      const workspace = await getStoryboardWorkspace(id);
      if (!workspace.plan) throw new Error('اطلاعات این استوری‌برد کامل نیست.');
      activeWorkspaceIdRef.current = workspace.id;
      setScript(workspace.script);
      setSavedCharacters(workspace.characters || []);
      setReferences([]);
      setAspectRatio(workspace.aspectRatio || '16:9');
      setPlan(workspace.plan);
      const restoredScenes = workspace.scenes || workspace.plan.scenes.map((scene) => ({ ...scene, status: 'idle' as const }));
      scenesRef.current = restoredScenes;
      setScenes(restoredScenes);
      setOverviewImageUrl(workspace.overviewImageUrl || '');
      setRevisionRequest('');
      setError('');
      setStage(workspace.status === 'review' && workspace.overviewImageUrl ? 'preview' : 'scenes');
      setActiveTab('create');
    } catch (reason) {
      setHistoryError(reason instanceof Error ? reason.message : 'بازکردن استوری‌برد انجام نشد.');
    } finally { setWorkspacesLoading(false); }
  };

  const prepareStoryboardPreview = async (feedback = '') => {
    const cleanScript = script.trim();
    if (cleanScript.length < 20) { setError('داستانت را کمی کامل‌تر بنویس.'); return; }
    if (!references.length || references.some((item) => !item.name.trim())) { setError('حداقل یک عکس و نام کاراکتر لازم است.'); return; }
    const hadPreview = stage === 'preview';
    setError('');
    setStage('waiting-preview');
    setIsAnalyzing(true);
    try {
      const nextPlan = await analyzeStoryboard(cleanScript, references.map(({ id, name }) => ({ id, name: name.trim() })), feedback);
      setPlan(nextPlan);
      const initialScenes = nextPlan.scenes.map((scene) => ({ ...scene, status: 'idle' as const }));
      scenesRef.current = initialScenes;
      setScenes(initialScenes);
      const overviewJob = await startImageToImage({
        prompt: buildOverviewPrompt(nextPlan),
        aspectRatio,
        files: references.map((reference) => reference.file),
        idempotencyKey: makeImageKey()
      });
      const overviewUrl = await waitForImageJob(overviewJob);
      setOverviewImageUrl(overviewUrl);
      setRevisionRequest('');
      setStage('preview');
      void persistStoryboard('review', { plan: nextPlan, scenes: initialScenes, overviewImageUrl: overviewUrl, characters: references.map(({ id, name }) => ({ id, name: name.trim() })) }).catch(() => notify.error('پیش‌نمایش آماده است، اما ذخیره در تاریخچه انجام نشد.'));
      notify.success('پیش‌نمایش استوری‌برد آماده است.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تحلیل داستان انجام نشد.');
      setStage(hadPreview ? 'preview' : 'form');
    } finally { setIsAnalyzing(false); }
  };

  const handleAnalyze = async (event: FormEvent) => {
    event.preventDefault();
    await prepareStoryboardPreview();
  };

  const goToFormStep = (nextStep: StoryboardFormStep) => {
    if (nextStep >= 2 && script.trim().length < 20) { setError('اول داستانت را کمی کامل‌تر بنویس.'); setFormStep(1); return; }
    if (nextStep >= 3 && (!references.length || references.some((item) => !item.name.trim()))) { setError('حداقل یک کاراکترشیت با نام لازم است.'); setFormStep(2); return; }
    setError('');
    setFormStep(nextStep);
  };

  const applyRevision = async () => {
    const feedback = revisionRequest.trim();
    if (feedback.length < 5) { setError('اصلاحیه‌ات را کمی کامل‌تر بنویس.'); return; }
    await prepareStoryboardPreview(feedback);
  };

  const updateScene = (id: string, patch: Partial<StoryboardSceneState>) => {
    const next = scenesRef.current.map((item) => item.id === id ? { ...item, ...patch } : item);
    scenesRef.current = next;
    setScenes(next);
    return next;
  };

  const generateScene = async (scene: StoryboardSceneState) => {
    if (activeSceneId) return;
    const sceneReferences = references.filter((reference) => scene.characterIds.includes(reference.id));
    const files = (sceneReferences.length ? sceneReferences : references).map((reference) => reference.file);
    if (!files.length) { updateScene(scene.id, { status: 'error', error: 'عکس مرجع این سکانس پیدا نشد.' }); return; }
    setActiveSceneId(scene.id);
    const generatingScenes = updateScene(scene.id, { status: 'generating', error: '', imageUrl: undefined });
    void persistStoryboard('generating', { scenes: generatingScenes }).catch(() => {});
    try {
      const prompt = `${scene.imagePrompt}\n\nNEGATIVE PROMPT: ${scene.negativePrompt || 'text, watermark, logo, horror, violence, duplicate character, deformed face'}`;
      const job = await startImageToImage({ prompt, aspectRatio, files, idempotencyKey: makeImageKey() });
      const imageUrl = await waitForImageJob(job);
      const completedScenes = updateScene(scene.id, { status: 'completed', imageUrl, error: '' });
      void persistStoryboard(completedScenes.every((item) => item.status === 'completed') ? 'completed' : 'generating', { scenes: completedScenes }).catch(() => {});
    } catch (reason) {
      const failedScenes = updateScene(scene.id, { status: 'error', error: reason instanceof Error ? reason.message : 'ساخت این قاب انجام نشد.' });
      void persistStoryboard('error', { scenes: failedScenes }).catch(() => {});
    } finally { setActiveSceneId(null); }
  };

  const generateAll = async () => {
    for (const scene of scenes) {
      if (scene.status === 'completed') continue;
      await generateScene(scene);
    }
  };

  const confirmOverview = () => {
    setError('');
    setStage('scenes');
    void persistStoryboard('generating').catch(() => {});
    void generateAll();
  };

  const resetStoryboard = () => {
    setPlan(null);
    setScenes([]);
    setOverviewImageUrl('');
    setRevisionRequest('');
    setSavedCharacters([]);
    activeWorkspaceIdRef.current = null;
    setError('');
    setStage('form');
    setFormStep(1);
  };

  const completed = scenes.filter((scene) => scene.status === 'completed').length;
  return <main className="storyboard-maker" dir="rtl">
    <header className="storyboard-maker__header">
      <Button type="button" variant="ghost" iconOnly className="storyboard-maker__back" onClick={onBack} aria-label="بازگشت به استودیو" title="بازگشت به استودیو" startIcon={<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9 18 6-6-6-6" /></svg>} />
      <div className="storyboard-maker__brand"><span className="storyboard-maker__brand-mark" aria-hidden="true"><Icon name="sparkle" size={20} /></span><span className="storyboard-maker__brand-copy"><strong>استوری‌برد من</strong><small>داستانت را قاب‌به‌قاب ببین</small></span></div>
      <span className="storyboard-maker__header-spacer" aria-hidden="true" />
    </header>
    <nav className="storyboard-maker__tabs" role="tablist" aria-label="بخش‌های استوری‌برد"><button id="storyboard-create-tab" type="button" role="tab" aria-selected={activeTab === 'create'} aria-controls="storyboard-create-panel" tabIndex={activeTab === 'create' ? 0 : -1} onClick={() => setActiveTab('create')}><Icon name="sparkle" size={17} aria-hidden="true" /> ساخت استوری‌برد</button><button id="storyboard-history-tab" type="button" role="tab" aria-selected={activeTab === 'history'} aria-controls="storyboard-history-panel" tabIndex={activeTab === 'history' ? 0 : -1} onClick={() => setActiveTab('history')}><Icon name="book" size={17} aria-hidden="true" /> استوری‌بردهای من <i>{workspaces.length.toLocaleString('fa-IR')}</i></button></nav>

    {activeTab === 'create' && stage === 'form' && scenarioHandoff ? <aside className="storyboard-maker__handoff" role="status"><Icon name="check" size={18} aria-hidden="true" /><span>داستان «{scenarioHandoff.title || 'تو'}» آماده است؛ لازم نیست آن را دوباره بنویسی.</span></aside> : null}
    {activeTab === 'history' ? <section id="storyboard-history-panel" role="tabpanel" aria-labelledby="storyboard-history-tab" className="storyboard-maker__history">
      <header><span>کتابخانهٔ استوری‌برد</span><h1>داستان‌هایی که تصویر کرده‌ای</h1><p>هر استوری‌برد را باز کن تا پیش‌نمایش و قاب‌های ساخته‌شده‌اش را ببینی.</p></header>
      {workspacesLoading ? <div className="storyboard-maker__history-state" role="status"><Icon name="spinner" size={28} aria-hidden="true" />در حال آوردن استوری‌بردها…</div> : historyError ? <p className="storyboard-maker__error" role="alert">{historyError}</p> : workspaces.length ? <div className="storyboard-maker__history-grid">{workspaces.map((workspace) => <button type="button" key={workspace.id} onClick={() => void openHistoryWorkspace(workspace.id)}><span><Icon name="story" size={22} aria-hidden="true" /></span><div><strong>{workspace.title}</strong><p>{workspace.script}</p><small>{new Intl.DateTimeFormat('fa-IR', { day: 'numeric', month: 'long' }).format(new Date(workspace.updatedAt))}</small></div><i>{workspace.status === 'completed' ? 'تکمیل‌شده' : workspace.status === 'generating' ? 'در حال ساخت' : 'آمادهٔ بررسی'}</i><Icon name="chevron-left" size={19} aria-hidden="true" /></button>)}</div> : <div className="storyboard-maker__history-state"><Icon name="book" size={30} aria-hidden="true" /><h2>هنوز استوری‌بردی نداری</h2><p>داستان اولت را بساز تا این‌جا نگهش داریم.</p><Button type="button" onClick={() => setActiveTab('create')}>ساخت اولین استوری‌برد</Button></div>}
    </section> : <section id="storyboard-create-panel" role="tabpanel">{stage === 'form' ? <section className="storyboard-maker__start">
      <div className="storyboard-maker__flow-heading"><span>{formStep === 1 ? 'شروع استوری‌برد' : formStep === 3 ? 'اندازهٔ داستان' : 'استوری‌برد'}</span><h1>{formStep === 1 ? 'سناریوت را بنویس' : formStep === 2 ? 'قهرمان‌های داستانت را انتخاب کن' : 'دوست داری داستانت چه شکلی باشد؟'}</h1>{formStep !== 1 ? <p>{formStep === 2 ? 'کاراکترشیت‌های آماده را از کتابخانه انتخاب کن یا عکسشان را اضافه کن.' : <><strong>یک سایز انتخاب کن.</strong><small>اول پیش‌نمایش همهٔ صحنه‌ها را به تو نشان می‌دهیم.</small></>}</p> : null}</div>
      <form className="storyboard-maker__form" onSubmit={handleAnalyze} noValidate>
        {formStep === 1 ? <section className="storyboard-maker__panel storyboard-maker__panel--active"><div className="storyboard-maker__panel-heading"><span className="storyboard-maker__panel-icon"><Icon name="story" size={20} aria-hidden="true" /></span><div><h2>اینجا بنویسش</h2></div></div>
          <label className="storyboard-maker__field" htmlFor="storyboard-script"><span>سناریو من</span><textarea id="storyboard-script" value={script} onChange={(event) => setScript(event.target.value.slice(0, 12000))} placeholder="مثلاً: مهتاب، دختری کنجکاو، همراه ربات کوچکش برای پیدا کردن نقشهٔ شهر آسمانی وارد یک ماجراجویی می‌شود…" maxLength={12000} aria-invalid={Boolean(error && script.trim().length < 20)} /></label>
          <div className="storyboard-maker__panel-footer"><span>{script.length.toLocaleString('fa-IR')} / ۱۲٬۰۰۰</span><Button type="button" className="storyboard-maker__step-next" onClick={() => goToFormStep(2)} endIcon={<Icon name="chevron-left" size={17} aria-hidden="true" />}>ادامه</Button></div>
        </section> : null}
        {formStep === 2 ? <section className="storyboard-maker__panel storyboard-maker__panel--active storyboard-maker__panel--references"><div className="storyboard-maker__panel-heading"><span className="storyboard-maker__panel-icon"><Icon name="family" size={20} aria-hidden="true" /></span><div><h2>کاراکترشیت‌ها را اضافه کن</h2><p>برای ثابت‌ماندن ظاهر کاراکترها، حداقل یک کاراکترشیت لازم است.</p></div></div>
          <input ref={fileInputRef} className="storyboard-maker__file-input" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={addReferences} />
          <div className="storyboard-maker__reference-grid">{references.map((reference) => <article className="storyboard-maker__reference" key={reference.id}><img src={reference.previewUrl} alt={`عکس مرجع ${reference.name || 'کاراکتر'}`} /><div><label>نام کاراکتر<input value={reference.name} onChange={(event) => updateReferenceName(reference.id, event.target.value)} maxLength={60} /></label><button type="button" onClick={() => removeReference(reference.id)} aria-label={`حذف ${reference.name || 'کاراکتر'}`} title="حذف عکس">×</button></div></article>)}</div>
          {references.length < MAX_REFERENCES ? <div className="storyboard-maker__reference-actions"><Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()} startIcon={<Icon name="studio-image" size={18} aria-hidden="true" />}>آپلود کاراکترشیت</Button><Button type="button" variant="secondary" onClick={() => void openLibrary()} startIcon={<Icon name="book" size={18} aria-hidden="true" />}>انتخاب از کتابخانه</Button></div> : null}
          <div className="storyboard-maker__panel-footer"><Button type="button" variant="ghost" onClick={() => setFormStep(1)}>بازگشت</Button><Button type="button" className="storyboard-maker__step-next" onClick={() => goToFormStep(3)} disabled={!references.length} endIcon={<Icon name="chevron-left" size={17} aria-hidden="true" />}>ادامه</Button></div>
        </section> : null}
        {formStep === 3 ? <section className="storyboard-maker__panel storyboard-maker__panel--active storyboard-maker__ratio"><div className="storyboard-maker__panel-heading"><span className="storyboard-maker__panel-icon"><Icon name="studio-image" size={20} aria-hidden="true" /></span><div><h2>یک سایز انتخاب کن</h2></div></div><div className="storyboard-maker__size-options" role="radiogroup" aria-label="سایز تصویر">{([{ ratio: '16:9', label: 'افقی', shape: 'landscape' }, { ratio: '9:16', label: 'عمودی', shape: 'portrait' }, { ratio: '1:1', label: 'مربع', shape: 'square' }] as const).map(({ ratio, label, shape }) => <button type="button" key={ratio} role="radio" aria-checked={aspectRatio === ratio} className={aspectRatio === ratio ? 'is-selected' : ''} onClick={() => setAspectRatio(ratio)}><span className={`storyboard-maker__size-shape is-${shape}`} aria-hidden="true" /><span><strong>{label}</strong><small>{ratio}</small></span></button>)}</div><div className="storyboard-maker__ready-note"><Icon name="check" size={17} aria-hidden="true" /><span>{references.length.toLocaleString('fa-IR')} کاراکترشیت آماده است. اول یک پیش‌نمایش از همهٔ صحنه‌ها می‌سازیم.</span></div>
          <div className="storyboard-maker__panel-footer"><Button type="button" variant="ghost" onClick={() => setFormStep(2)}>بازگشت</Button><Button type="submit" size="lg" loading={isAnalyzing} disabled={isAnalyzing} endIcon={<Icon name="sparkle" size={19} aria-hidden="true" />}>{isAnalyzing ? 'داریم پیش‌نمایش را می‌سازیم…' : 'ساخت پیش‌نمایش استوری‌برد'}</Button></div>
        </section> : null}
        {error ? <p className="storyboard-maker__error" role="alert">{error}</p> : null}
      </form>
    </section> : stage === 'waiting-preview' ? <section className="storyboard-maker__waiting" aria-live="polite" role="status">
      <div className="storyboard-maker__waiting-icon"><Icon name="spinner" size={34} aria-hidden="true" /></div>
      <span>مرحلهٔ ۱ از ۲</span>
      <h1>داریم پیش‌نمایش داستانت را می‌سازیم</h1>
      <p>اول همهٔ سکانس‌ها را در یک تصویر کنار هم می‌چینیم. بعد از تأیید تو، قاب‌های جداگانه را می‌سازیم.</p>
      <i aria-hidden="true"><b /></i>
    </section> : stage === 'preview' && plan ? <section className="storyboard-maker__overview" aria-live="polite">
      <header className="storyboard-maker__overview-head"><span>مرحلهٔ ۱ از ۲ · آمادهٔ بررسی</span><h1>{plan.title}</h1><p>{plan.summary}</p></header>
      <div className="storyboard-maker__style-note"><Icon name="sparkle" size={18} aria-hidden="true" /><span>سبک همهٔ قاب‌ها: <strong>{plan.visualStyle}</strong></span></div>
      <div className="storyboard-maker__overview-image"><ProtectedSceneImage src={overviewImageUrl} alt={`پیش‌نمایش کامل ${plan.title}`} /></div>
      <div className="storyboard-maker__overview-scenes" aria-label="راهنمای سکانس‌های پیش‌نمایش">{plan.scenes.map((scene) => <article key={scene.id}><span>{scene.number.toLocaleString('fa-IR')}</span><div><strong>{scene.title}</strong><p>{scene.description}</p></div></article>)}</div>
      <section className="storyboard-maker__revision"><label htmlFor="storyboard-revision">اگر چیزی را می‌خواهی تغییر بدهی، این‌جا بنویس</label><textarea id="storyboard-revision" value={revisionRequest} onChange={(event) => setRevisionRequest(event.target.value.slice(0, 800))} placeholder="مثلاً: صحنهٔ آخر روشن‌تر باشد و همه خوشحال باشند." maxLength={800} disabled={isAnalyzing} /><span>اصلاحیه باعث می‌شود یک پیش‌نمایش تازه بسازیم؛ قاب‌های نهایی هنوز ساخته نمی‌شوند.</span></section>
      {error ? <p className="storyboard-maker__error" role="alert">{error}</p> : null}
      <div className="storyboard-maker__review-actions"><Button type="button" variant="secondary" loading={isAnalyzing} disabled={isAnalyzing} onClick={() => void applyRevision()} startIcon={<Icon name="sparkle" size={17} aria-hidden="true" />}>اعمال اصلاحیه</Button><Button type="button" onClick={confirmOverview} disabled={isAnalyzing} endIcon={<Icon name="check" size={18} aria-hidden="true" />}>تأیید و ساخت قاب‌های جداگانه</Button><Button type="button" variant="ghost" onClick={resetStoryboard} disabled={isAnalyzing}>شروع یک داستان تازه</Button></div>
    </section> : stage === 'scenes' && plan ? <section className="storyboard-maker__board" aria-live="polite">
      <header className="storyboard-maker__board-head"><div><span>استوری‌برد آماده است</span><h1>{plan.title}</h1><p>{plan.summary}</p></div><div className="storyboard-maker__progress"><strong>{completed.toLocaleString('fa-IR')} از {scenes.length.toLocaleString('fa-IR')} قاب</strong><i><b style={{ width: `${scenes.length ? (completed / scenes.length) * 100 : 0}%` }} /></i></div></header>
      <div className="storyboard-maker__style-note"><Icon name="sparkle" size={18} aria-hidden="true" /><span>سبک همه‌ی قاب‌ها: <strong>{plan.visualStyle}</strong></span></div>
      <div className="storyboard-maker__board-actions"><Button type="button" onClick={() => void generateAll()} loading={Boolean(activeSceneId)} disabled={Boolean(activeSceneId)} startIcon={<Icon name="studio-image" size={18} aria-hidden="true" />}>{activeSceneId ? 'در حال ساخت یک قاب…' : completed ? 'ساخت قاب‌های باقی‌مانده' : 'ساخت همه‌ی قاب‌ها'}</Button><Button type="button" variant="secondary" onClick={resetStoryboard}>شروع یک داستان تازه</Button></div>
      <div className="storyboard-maker__scene-list">{scenes.map((scene) => <article className={`storyboard-maker__scene is-${scene.status}`} key={scene.id}>
        <div className="storyboard-maker__frame">{scene.status === 'completed' ? <ProtectedSceneImage src={scene.imageUrl} alt={`تصویر ${scene.title}`} /> : <div className="storyboard-maker__frame-placeholder"><span>{scene.number.toLocaleString('fa-IR')}</span><Icon name={scene.status === 'generating' ? 'spinner' : 'studio-image'} size={32} aria-hidden="true" /><p>{scene.status === 'generating' ? 'در حال ساخت تصویر…' : 'هنوز ساخته نشده'}</p></div>}</div>
        <div className="storyboard-maker__scene-body"><div className="storyboard-maker__scene-title"><span>سکانس {scene.number.toLocaleString('fa-IR')}</span><h2>{scene.title}</h2></div><p>{scene.description}</p><dl><div><dt>اتفاق</dt><dd>{scene.action}</dd></div><div><dt>دوربین</dt><dd>{scene.camera}</dd></div>{scene.dialogue ? <div><dt>دیالوگ</dt><dd>{scene.dialogue}</dd></div> : null}</dl>
          <label className="storyboard-maker__prompt-field">پرامپت این قاب<textarea value={scene.imagePrompt} onChange={(event) => updateScene(scene.id, { imagePrompt: event.target.value.slice(0, 2400) })} maxLength={2400} /></label>
          {scene.error ? <p className="storyboard-maker__error" role="alert">{scene.error}</p> : null}
          <Button type="button" variant={scene.status === 'completed' ? 'secondary' : 'primary'} onClick={() => void generateScene(scene)} loading={activeSceneId === scene.id} disabled={Boolean(activeSceneId)} startIcon={<Icon name="sparkle" size={17} aria-hidden="true" />}>{scene.status === 'completed' ? 'ساخت دوباره این قاب' : 'ساخت این قاب'}</Button>
        </div>
      </article>)}</div>
    </section> : null}</section>}
    <Dialog open={libraryOpen} title="انتخاب کاراکترشیت از کتابخانه" onClose={() => { if (!isAddingFromLibrary) setLibraryOpen(false); }} dismissible={!isAddingFromLibrary} showFooter={false} panelClassName="storyboard-maker__library-dialog">
      <div className="storyboard-maker__library-content">
        <p>کاراکترشیت‌های آماده‌ی خودت را انتخاب کن. می‌توانی چند کاراکتر را هم‌زمان اضافه کنی.</p>
        {libraryLoading ? <div className="storyboard-maker__library-state" role="status"><Icon name="spinner" size={28} aria-hidden="true" />در حال آوردن کتابخانه…</div> : null}
        {!libraryLoading && libraryError ? <p className="storyboard-maker__error" role="alert">{libraryError}</p> : null}
        {!libraryLoading && !libraryError && !librarySheets.length ? <div className="storyboard-maker__library-state"><Icon name="book" size={28} aria-hidden="true" />هنوز کاراکترشیت آماده‌ای در کتابخانه نداری.</div> : null}
        {!libraryLoading && librarySheets.length ? <div className="storyboard-maker__library-grid">{librarySheets.map((sheet) => { const selected = selectedLibraryKeys.includes(sheet.key); const alreadyAdded = references.some((reference) => reference.sourceKey === sheet.key); return <button type="button" key={sheet.key} className={selected ? 'is-selected' : ''} aria-pressed={selected} disabled={alreadyAdded || isAddingFromLibrary} onClick={() => toggleLibrarySheet(sheet.key)}><div><LibraryCharacterImage src={sheet.imageUrl} alt={`کاراکترشیت ${sheet.name}`} />{selected ? <span aria-hidden="true"><Icon name="check" size={16} /></span> : null}</div><strong>{sheet.name}</strong><small>{alreadyAdded ? 'قبلاً اضافه شده' : sheet.workspaceTitle}</small></button>; })}</div> : null}
        <div className="storyboard-maker__library-actions"><Button type="button" variant="secondary" disabled={isAddingFromLibrary} onClick={() => setLibraryOpen(false)}>انصراف</Button><Button type="button" loading={isAddingFromLibrary} disabled={!selectedLibraryKeys.length || isAddingFromLibrary} onClick={() => void addSelectedLibrarySheets()}>{isAddingFromLibrary ? 'در حال اضافه‌کردن…' : `اضافه‌کردن ${selectedLibraryKeys.length.toLocaleString('fa-IR')} کاراکترشیت`}</Button></div>
      </div>
    </Dialog>
  </main>;
}
