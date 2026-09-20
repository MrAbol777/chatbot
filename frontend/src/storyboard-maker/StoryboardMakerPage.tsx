import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { Dialog, useNotification } from '../design-system/components';
import Icon from '../components/Icon';
import { fetchProtectedImageBlobUrl } from '../services/imageGeneration';
import { getImageToImageJob, startImageToImage } from '../services/imageToImage';
import type { ImageToImageJob } from '../services/imageToImage';
import { getCharacterWorkspace, listCharacterWorkspaces } from '../character-maker/characterMaker.api';
import { analyzeStoryboard, createStoryboardWorkspace, getStoryboardWorkspace, listStoryboardWorkspaces, updateStoryboardWorkspace } from './storyboardMaker.api';
import { readStoryboardScenarioHandoff } from './storyboardScenarioHandoff';
import { transitionAnimationProject } from '../animation-maker/animationMaker.api';
import { saveAnimationVideoHandoff } from '../animation-maker/animationVideoHandoff';
import type { StoryboardCharacterReference, StoryboardPlan, StoryboardSceneState, StoryboardWorkspace, StoryboardWorkspaceStatus } from './storyboardMaker.types';
import './StoryboardMakerPage.css';

type Props = { onBack: () => void; onOpenDirectVideo?: () => void };
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
  return blobUrl ? (
    <img src={blobUrl} alt={alt} />
  ) : (
    <span style={{ display: 'grid', placeItems: 'center', gap: 8, color: 'var(--color-muted)' }}>
      <Icon name="spinner" size={26} />
      <span>در حال آماده‌سازی تصویر…</span>
    </span>
  );
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
  return blobUrl ? (
    <img src={blobUrl} alt={alt} className="storyboard-library-modal__img" />
  ) : (
    <span className="storyboard-library-modal__img-loading">
      <Icon name="spinner" size={20} />
    </span>
  );
}

export default function StoryboardMakerPage({ onBack, onOpenDirectVideo }: Props) {
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
  const [autoReferenceStatus, setAutoReferenceStatus] = useState('');
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
    void listStoryboardWorkspaces()
      .then((items) => { if (active) setWorkspaces(items); })
      .catch(() => { if (active) setHistoryError('دریافت استوری‌بردهای قبلی انجام نشد.'); })
      .finally(() => { if (active) setWorkspacesLoading(false); });
    return () => { active = false; };
  }, []);

  const materializeLibrarySheets = async (sheets: LibraryCharacterSheet[]) => Promise.all(sheets.map(async (sheet) => {
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

  useEffect(() => {
    const workspaceId = scenarioHandoff?.characterWorkspaceId;
    if (!workspaceId) return;
    let active = true;
    setAutoReferenceStatus('در حال آماده‌سازی شخصیت‌های تأییدشده…');
    void (async () => {
      try {
        const workspace = await getCharacterWorkspace(workspaceId);
        const allReadySheets = (workspace.analysis?.characters || []).flatMap((character) => {
          const imageUrl = character.characterSheet?.status === 'COMPLETED'
            ? character.characterSheet.imageUrl || character.characterSheet.previousImageUrl || ''
            : '';
          return imageUrl ? [{ key: `${workspace.id}:${character.id}`, name: character.name, workspaceTitle: workspace.title, imageUrl }] : [];
        });
        const sheets = allReadySheets.slice(0, MAX_REFERENCES);
        if (!sheets.length) throw new Error('شخصیت آماده‌ای برای این سناریو پیدا نشد.');
        const items = await materializeLibrarySheets(sheets);
        if (!active) {
          items.forEach((item) => { URL.revokeObjectURL(item.previewUrl); previewUrlsRef.current.delete(item.previewUrl); });
          return;
        }
        setReferences((current) => {
          if (current.length) {
            items.forEach((item) => { URL.revokeObjectURL(item.previewUrl); previewUrlsRef.current.delete(item.previewUrl); });
            return current;
          }
          return items;
        });
        setFormStep((current) => current === 1 ? 2 : current);
        setAutoReferenceStatus(`${items.length.toLocaleString('fa-IR')} شخصیت همین داستان خودکار اضافه شد؛ این‌ها مرجع ساخت همهٔ صحنه‌ها هستند.`);
      } catch (reason) {
        if (active) setAutoReferenceStatus(reason instanceof Error ? reason.message : 'افزودن خودکار شخصیت‌ها انجام نشد؛ از کتابخانه انتخابشان کن.');
      }
    })();
    return () => { active = false; };
  }, [scenarioHandoff?.characterWorkspaceId]);

  const addReferences = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const available = MAX_REFERENCES - references.length;
    if (available <= 0) { setError(`برای هر داستان حداکثر ${MAX_REFERENCES} شخصیت می‌توانی اضافه کنی.`); return; }
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
      const workspaceSummaries = await listCharacterWorkspaces();
      // The list endpoint intentionally returns workspace summaries, so fetch each
      // workspace before reading its saved character assets.
      const workspaces = await Promise.all(workspaceSummaries.map((workspace) => getCharacterWorkspace(workspace.id)));
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
    if (!chosen.length) { setLibraryError(available <= 0 ? `حداکثر ${MAX_REFERENCES} شخصیت می‌توانی اضافه کنی.` : 'یک شخصیت انتخاب کن.'); return; }
    setIsAddingFromLibrary(true);
    setLibraryError('');
    try {
      const items = await materializeLibrarySheets(chosen);
      setReferences((current) => [...current, ...items]);
      setLibraryOpen(false);
      notify.success(`${items.length.toLocaleString('fa-IR')} شخصیت اضافه شد.`);
    } catch (reason) {
      setLibraryError(reason instanceof Error ? reason.message : 'اضافه‌کردن شخصیت انجام نشد.');
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
    if (!references.length || references.some((item) => !item.name.trim())) { setError('حداقل یک عکس و نام شخصیت لازم است.'); return; }
    const hadPreview = stage === 'preview';
    setError('');
    setStage('waiting-preview');
    setIsAnalyzing(true);
    try {
      if (scenarioHandoff?.animationProjectId) await transitionAnimationProject(scenarioHandoff.animationProjectId, 'storyboard_generating', { characterWorkspaceId: scenarioHandoff.characterWorkspaceId });
      const nextPlan = await analyzeStoryboard(cleanScript, references.map(({ id, name }) => ({ id, name: name.trim() })), feedback);
      setPlan(nextPlan);
      const totalDuration = scenarioHandoff?.durationSeconds || 0;
      const baseDuration = totalDuration ? Math.floor(totalDuration / nextPlan.scenes.length) : 0;
      const remainder = totalDuration ? totalDuration % nextPlan.scenes.length : 0;
      const initialScenes = nextPlan.scenes.map((scene, index) => ({ ...scene, sourceSceneId: scene.sourceSceneId || `SC-${index + 1}`, durationSeconds: totalDuration ? baseDuration + (index < remainder ? 1 : 0) : undefined, status: 'idle' as const }));
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
      const saved = await persistStoryboard('review', { plan: nextPlan, scenes: initialScenes, overviewImageUrl: overviewUrl, characters: references.map(({ id, name }) => ({ id, name: name.trim() })) });
      if (scenarioHandoff?.animationProjectId && saved) await transitionAnimationProject(scenarioHandoff.animationProjectId, 'storyboard_review', { storyboardWorkspaceId: saved.id, revisionRequest: feedback });
      notify.success('پیش‌نمایش صحنه‌های داستان آماده شد.');
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
    if (nextStep >= 3 && (!references.length || references.some((item) => !item.name.trim()))) { setError('حداقل یک شخصیت با نام لازم است.'); setFormStep(2); return; }
    setError('');
    setFormStep(nextStep);
  };

  const applyRevision = async () => {
    const feedback = revisionRequest.trim();
    if (feedback.length < 5) { setError('تغییری که می‌خواهی را کمی کامل‌تر بنویس.'); return; }
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
    if (!files.length) { updateScene(scene.id, { status: 'error', error: 'عکس مرجع این صحنه پیدا نشد.' }); return; }
    setActiveSceneId(scene.id);
    const isRegeneration = scene.status === 'completed';
    const generatingScenes = updateScene(scene.id, { status: 'generating', error: '', imageUrl: undefined });
    void persistStoryboard('generating', { scenes: generatingScenes }).catch(() => {});
    try {
      const prompt = `${scene.imagePrompt}\n\nNEGATIVE PROMPT: ${scene.negativePrompt || 'text, watermark, logo, horror, violence, duplicate character, deformed face'}`;
      const job = await startImageToImage({ prompt, aspectRatio, files, idempotencyKey: makeImageKey() });
      const imageUrl = await waitForImageJob(job);
      const completedScenes = updateScene(scene.id, { status: 'completed', imageUrl, imageJobId: job.id, error: '' });
      const saved = await persistStoryboard(completedScenes.every((item) => item.status === 'completed') ? 'completed' : 'generating', { scenes: completedScenes });
      if (scenarioHandoff?.animationProjectId && saved && isRegeneration) await transitionAnimationProject(scenarioHandoff.animationProjectId, 'storyboard_review', { storyboardWorkspaceId: saved.id, revisionRequest: `بازتولید قاب ${scene.sourceSceneId || scene.id}` });
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

  const approveStoryboard = async () => {
    if (!plan || scenes.some((scene) => scene.status !== 'completed')) { setError('اول همهٔ قاب‌ها را کامل کن.'); return; }
    const expected = scenarioHandoff?.durationSeconds || 0;
    const actual = scenes.reduce((sum, scene) => sum + Number(scene.durationSeconds || 0), 0);
    if (expected && actual !== expected) { setError('جمع زمان صحنه‌ها با مدت فیلم یکی نیست.'); return; }
    try {
      const saved = await persistStoryboard('completed', { scenes });
      if (scenarioHandoff?.animationProjectId && saved) {
        const approved = await transitionAnimationProject(scenarioHandoff.animationProjectId, 'storyboard_approved', { storyboardWorkspaceId: saved.id });
        await transitionAnimationProject(approved.id, 'video_queued', { videoPayload: { animationProjectId: approved.id, scenarioId: approved.sourceLinks.storyWorkspaceId, scenarioVersion: approved.review.scenarioVersion, characterSheetVersion: approved.review.characterVersion, storyboardId: saved.id, storyboardVersion: approved.review.storyboardVersion, duration: approved.preferences.durationSeconds, aspectRatio: approved.preferences.aspectRatio, visualStyle: approved.preferences.style, audioSettings: approved.preferences.audio } });
        saveAnimationVideoHandoff({ animationProjectId: approved.id, storyboardWorkspaceId: saved.id, storyWorkspaceId: approved.sourceLinks.storyWorkspaceId, characterWorkspaceId: approved.sourceLinks.characterWorkspaceId, scenarioVersion: approved.review.scenarioVersion, characterVersion: approved.review.characterVersion, storyboardVersion: approved.review.storyboardVersion, durationSeconds: approved.preferences.durationSeconds, aspectRatio: approved.preferences.aspectRatio, visualStyle: approved.preferences.style, audio: approved.preferences.audio });
      }
      notify.success('استوری‌برد با موفقیت تأیید شد.');
      onOpenDirectVideo?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'تأیید استوری‌برد ذخیره نشد.'); }
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

  return (
    <main className="storyboard-maker" dir="rtl" id="main-content">
      {/* Header */}
      <header className="storyboard-maker__header">
        <button
          type="button"
          className="storyboard-maker__back"
          onClick={onBack}
          aria-label="بازگشت به استودیو"
          title="بازگشت به استودیو"
        >
          <Icon name="chevron-right" size={20} />
        </button>

        <div className="storyboard-maker__brand">
          <span className="storyboard-maker__brand-mark">
            <Icon name="story" size={22} />
          </span>
          <div className="storyboard-maker__brand-copy">
            <strong>کارگاه صحنه‌سازی</strong>
            <small>داستانت را صحنه‌به‌صحنه تصویرگری کن</small>
          </div>
        </div>

        <span className="storyboard-maker__header-spacer" aria-hidden="true" />
      </header>

      {/* Navigation Tabs */}
      <nav className="storyboard-maker__tabs" role="tablist" aria-label="بخش‌های صحنه‌سازی">
        <button
          id="storyboard-create-tab"
          type="button"
          role="tab"
          aria-selected={activeTab === 'create'}
          tabIndex={activeTab === 'create' ? 0 : -1}
          onClick={() => setActiveTab('create')}
        >
          <Icon name="sparkles" size={16} />
          <span>کارگاه صحنه‌سازی</span>
        </button>
        <button
          id="storyboard-history-tab"
          type="button"
          role="tab"
          aria-selected={activeTab === 'history'}
          tabIndex={activeTab === 'history' ? 0 : -1}
          onClick={() => setActiveTab('history')}
        >
          <Icon name="book" size={16} />
          <span>استوری‌بردهای من</span>
          <i>{workspaces.length.toLocaleString('fa-IR')}</i>
        </button>
      </nav>

      {/* History Panel */}
      {activeTab === 'history' ? (
        <section aria-label="استوری‌بردهای من">
          <div className="storyboard-maker__overview-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Icon name="book" size={24} />
              <div>
                <h2>کتابخانهٔ استوری‌بردها</h2>
                <p>داستان‌هایی که تصویرگری کرده‌ای این‌جا نگه‌داری می‌شوند.</p>
              </div>
            </div>
            <button type="button" className="danoa-btn danoa-btn--primary" onClick={() => setActiveTab('create')}>
              <Icon name="sparkles" size={16} />
              <span>ساخت استوری‌برد جدید</span>
            </button>
          </div>

          {workspacesLoading ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-muted)' }}>
              <Icon name="spinner" size={32} />
              <p style={{ marginTop: 12, fontWeight: 700 }}>در حال بارگذاری استوری‌بردها…</p>
            </div>
          ) : historyError ? (
            <p style={{ color: 'var(--color-danger)', textAlign: 'center' }}>{historyError}</p>
          ) : workspaces.length ? (
            <div className="storyboard-maker__library-grid">
              {workspaces.map((workspace) => (
                <button
                  type="button"
                  key={workspace.id}
                  className="storyboard-maker__storybook-card"
                  onClick={() => void openHistoryWorkspace(workspace.id)}
                >
                  <div className="storyboard-maker__storybook-icon">
                    <Icon name="story" size={24} />
                  </div>
                  <div className="storyboard-maker__storybook-info">
                    <strong>{workspace.title || 'داستان بدون عنوان'}</strong>
                    <small>
                      {workspace.status === 'completed' ? 'تکمیل‌شده' : workspace.status === 'generating' ? 'در حال ساخت' : 'آماده بررسی'}
                    </small>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '60px 20px', background: 'var(--color-surface-2)', borderRadius: 22, border: '1px solid var(--color-border)' }}>
              <Icon name="story" size={40} style={{ color: 'var(--color-muted)', marginBottom: 12 }} />
              <h3 style={{ fontWeight: 800, fontSize: '1.15rem' }}>هنوز استوری‌بردی ذخیره نشده است</h3>
              <p style={{ color: 'var(--color-muted)', margin: '6px 0 20px' }}>اولین داستانت را بساز تا صحنه‌هایش این‌جا ثبت شوند.</p>
              <button type="button" className="danoa-btn danoa-btn--primary" onClick={() => setActiveTab('create')}>
                <Icon name="sparkles" size={16} />
                <span>شروع تصویرگری</span>
              </button>
            </div>
          )}
        </section>
      ) : (
        /* Create Flow */
        <section>
          {/* Stage 1: Form (100% Anti-Nesting Flow) */}
          {stage === 'form' ? (
            <section>
              {/* Compact Hero */}
              <section className="storyboard-maker__hero">
                <div className="storyboard-maker__hero-copy">
                  <span className="storyboard-maker__eyebrow">
                    <Icon name="sparkle" size={14} />
                    قدم ۳: تصویرگری صحنه‌های داستان
                  </span>
                  <h1>صحنه‌های کارتونت را تصویرگری کن</h1>
                  <p>داستانت را به قاب‌های جذاب تبدیل می‌کنیم تا حرکت و ماجرای شخصیت‌ها را ببینی.</p>
                </div>
              </section>

              {/* Stepper */}
              <ul className="storyboard-maker__stepper" aria-label="مراحل استوری‌برد">
                <li
                  className={`storyboard-maker__step-item ${formStep === 1 ? 'is-active' : script.trim().length >= 20 ? 'is-completed' : ''}`}
                  onClick={() => goToFormStep(1)}
                >
                  <span className="storyboard-maker__step-num">۱</span>
                  <span>متن داستان</span>
                </li>
                <li
                  className={`storyboard-maker__step-item ${formStep === 2 ? 'is-active' : references.length ? 'is-completed' : ''}`}
                  onClick={() => goToFormStep(2)}
                >
                  <span className="storyboard-maker__step-num">۲</span>
                  <span>شخصیت‌ها ({references.length})</span>
                </li>
                <li
                  className={`storyboard-maker__step-item ${formStep === 3 ? 'is-active' : ''}`}
                  onClick={() => goToFormStep(3)}
                >
                  <span className="storyboard-maker__step-num">۳</span>
                  <span>شکل ویدیو</span>
                </li>
              </ul>

              <form onSubmit={handleAnalyze} noValidate className="storyboard-maker__flow-panel">
                {/* Step 1: Script Input (Direct Canvas Surface) */}
                {formStep === 1 && (
                  <div>
                    <div className="storyboard-maker__panel-intro">
                      <h2>متن داستانت را اینجا بنویس</h2>
                      <p>ماجرا را تعریف کن تا هوش مصنوعی صحنه‌ها را پیدا کند.</p>
                    </div>

                    <textarea
                      className="storyboard-maker__textarea"
                      value={script}
                      onChange={(e) => setScript(e.target.value.slice(0, 12000))}
                      placeholder="مثلاً: مهتاب، دختری کنجکاو، همراه ربات کوچکش برای پیدا کردن نقشهٔ شهر آسمانی وارد یک ماجراجویی می‌شود…"
                      rows={5}
                    />

                    <div className="storyboard-maker__panel-footer">
                      <span className="storyboard-maker__char-count">
                        {script.length.toLocaleString('fa-IR')} / ۱۲٬۰۰۰ کاراکتر
                      </span>
                      <button
                        type="button"
                        className="danoa-btn danoa-btn--primary storyboard-maker__cta-btn"
                        onClick={() => goToFormStep(2)}
                      >
                        <span>انتخاب شخصیت‌ها</span>
                        <Icon name="chevron-left" size={18} />
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 2: Character References */}
                {formStep === 2 && (
                  <div>
                    <div className="storyboard-maker__panel-intro">
                      <h2>شخصیت‌های این داستان را انتخاب کن</h2>
                      <p>ظاهر شخصیت‌ها در تمام قاب‌های داستان ثابت می‌ماند.</p>
                    </div>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      style={{ display: 'none' }}
                      onChange={addReferences}
                    />

                    {autoReferenceStatus && (
                      <div className="storyboard-maker__auto-ref-status">
                        <Icon name="check" size={16} />
                        <span>{autoReferenceStatus}</span>
                      </div>
                    )}

                    <div className="storyboard-maker__ref-grid">
                      {references.map((reference) => (
                        <article className="storyboard-maker__ref-card" key={reference.id}>
                          <img src={reference.previewUrl} alt={`عکس مرجع ${reference.name || 'کاراکتر'}`} />
                          <div className="storyboard-maker__ref-info">
                            <input
                              value={reference.name}
                              onChange={(e) => updateReferenceName(reference.id, e.target.value)}
                              placeholder="نام شخصیت"
                              maxLength={60}
                            />
                          </div>
                          <button
                            type="button"
                            className="ref-remove"
                            onClick={() => removeReference(reference.id)}
                            aria-label={`حذف ${reference.name}`}
                          >
                            <Icon name="x-close" size={14} />
                          </button>
                        </article>
                      ))}
                    </div>

                    {references.length < MAX_REFERENCES && (
                      <div className="storyboard-maker__ref-actions">
                        <button
                          type="button"
                          className="danoa-btn danoa-btn--secondary danoa-btn--sm"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Icon name="studio-image" size={16} />
                          <span>آپلود عکس شخصیت</span>
                        </button>
                        <button
                          type="button"
                          className="danoa-btn danoa-btn--secondary danoa-btn--sm"
                          onClick={() => void openLibrary()}
                        >
                          <Icon name="book" size={16} />
                          <span>انتخاب از شخصیت‌های ساخته‌شده</span>
                        </button>
                      </div>
                    )}

                    <div className="storyboard-maker__panel-footer">
                      <button
                        type="button"
                        className="danoa-btn danoa-btn--secondary"
                        onClick={() => setFormStep(1)}
                      >
                        بازگشت
                      </button>
                      <button
                        type="button"
                        className="danoa-btn danoa-btn--primary"
                        onClick={() => goToFormStep(3)}
                        disabled={!references.length}
                      >
                        <span>انتخاب اندازه و شکل ویدیو</span>
                        <Icon name="chevron-left" size={16} />
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 3: Aspect Ratio */}
                {formStep === 3 && (
                  <div className="storyboard-maker__ratio-step">
                    <div className="storyboard-maker__panel-intro">
                      <h2>اندازهٔ کارتونت چطور باشد؟</h2>
                      <p>یک شکل برای قاب تصویرها انتخاب کن:</p>
                    </div>

                    <div className="storyboard-maker__ratio-grid" role="radiogroup" aria-label="انتخاب اندازه ویدیو">
                      {([
                        {
                          ratio: '16:9' as const,
                          label: 'تلویزیون و کامپیوتر',
                          tag: 'پیشنهادی برای کارتون',
                          shape: 'landscape' as const,
                          isRecommended: true
                        },
                        {
                          ratio: '9:16' as const,
                          label: 'گوشی موبایل',
                          tag: '',
                          shape: 'portrait' as const,
                          isRecommended: false
                        },
                        {
                          ratio: '1:1' as const,
                          label: 'کتاب قصه (مربعی)',
                          tag: '',
                          shape: 'square' as const,
                          isRecommended: false
                        }
                      ]).map(({ ratio, label, tag, shape, isRecommended }) => {
                        const isSelected = aspectRatio === ratio;
                        return (
                          <button
                            type="button"
                            key={ratio}
                            role="radio"
                            aria-checked={isSelected}
                            className={`storyboard-maker__ratio-card ${isSelected ? 'is-selected' : ''}`}
                            onClick={() => setAspectRatio(ratio)}
                          >
                            {/* Checkmark indicator only when selected */}
                            {isSelected && (
                              <span className="storyboard-maker__ratio-check" aria-hidden="true">
                                <Icon name="check" size={13} />
                              </span>
                            )}

                            {/* Recommended badge */}
                            {isRecommended && (
                              <span className="storyboard-maker__ratio-tag">
                                <Icon name="sparkle" size={12} />
                                <span>{tag}</span>
                              </span>
                            )}

                            {/* Visual Device Illustration */}
                            <div className={`storyboard-maker__ratio-visual is-${shape}`} aria-hidden="true">
                              <div className="storyboard-maker__ratio-screen">
                                <span className="storyboard-maker__ratio-screen-art" />
                              </div>
                            </div>

                            <strong className="storyboard-maker__ratio-label">{label}</strong>
                          </button>
                        );
                      })}
                    </div>

                    <div className="storyboard-maker__panel-footer">
                      <button
                        type="button"
                        className="danoa-btn danoa-btn--secondary"
                        onClick={() => setFormStep(2)}
                      >
                        بازگشت
                      </button>
                      <button
                        type="submit"
                        className="danoa-btn danoa-btn--primary storyboard-maker__cta-btn"
                        disabled={isAnalyzing}
                      >
                        <Icon name={isAnalyzing ? 'spinner' : 'sparkles'} size={18} />
                        <span>{isAnalyzing ? 'در حال تصویرگری پیش‌نمایش…' : 'تصویرگری صحنه‌های داستان'}</span>
                      </button>
                    </div>
                  </div>
                )}

                {error && (
                  <div style={{
                    marginTop: 14, background: 'color-mix(in srgb, var(--color-danger) 8%, var(--color-surface-2))',
                    border: '1px solid color-mix(in srgb, var(--color-danger) 30%, var(--color-border))', borderRadius: 14,
                    padding: '10px 14px', color: 'var(--color-danger)', fontWeight: 750, display: 'flex', alignItems: 'center', gap: 8
                  }}>
                    <Icon name="alert-triangle" size={16} />
                    <span>{error}</span>
                  </div>
                )}
              </form>
            </section>
          ) : stage === 'waiting-preview' ? (
            /* Stage 2: Waiting Preview */
            <section style={{
              maxWidth: 840, margin: '40px auto', textAlign: 'center', padding: '40px 24px',
              borderRadius: 24, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)'
            }}>
              <Icon name="spinner" size={44} style={{ color: 'var(--color-primary)', marginBottom: 16 }} />
              <h2 style={{ fontSize: '1.4rem', fontWeight: 850, margin: '0 0 8px' }}>داریم پیش‌نمایش داستانت را نقاشی می‌کنیم</h2>
              <p style={{ color: 'var(--color-muted)', margin: 0 }}>تمام صحنه‌ها در یک تصویر کنار هم چیده می‌شوند تا نگاه کلی به داستانت داشته باشی.</p>
            </section>
          ) : stage === 'preview' && plan ? (
            /* Stage 3: Overview Preview */
            <section>
              <div className="storyboard-maker__overview-head">
                <div>
                  <h2>پیش‌نمایش کلی صحنه‌ها: {plan.title}</h2>
                  <p style={{ color: 'var(--color-muted)', margin: '2px 0 0', fontSize: '0.86rem' }}>{plan.summary}</p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="danoa-btn danoa-btn--secondary danoa-btn--sm" onClick={resetStoryboard}>
                    داستان تازه
                  </button>
                  <button type="button" className="danoa-btn danoa-btn--primary danoa-btn--sm" onClick={confirmOverview}>
                    <Icon name="check" size={16} />
                    <span>تأیید و ساخت تک‌تک قاب‌ها</span>
                  </button>
                </div>
              </div>

              <div className="storyboard-maker__overview-image">
                <ProtectedSceneImage src={overviewImageUrl} alt={`پیش‌نمایش کامل ${plan.title}`} />
              </div>

              <div className="storyboard-maker__overview-scenes-grid">
                {plan.scenes.map((scene) => (
                  <article key={scene.id} className="storyboard-maker__overview-scene-item">
                    <span className="storyboard-maker__overview-scene-num">{scene.number}</span>
                    <div>
                      <strong>{scene.title}</strong>
                      <p>{scene.description}</p>
                    </div>
                  </article>
                ))}
              </div>

              <div className="storyboard-maker__revision-box">
                <label htmlFor="storyboard-rev-input">اگر چیزی را می‌خواهی تغییر بدهی، اینجا بنویس:</label>
                <textarea
                  id="storyboard-rev-input"
                  value={revisionRequest}
                  onChange={(e) => setRevisionRequest(e.target.value.slice(0, 800))}
                  placeholder="مثلاً: در صحنهٔ آخر هوا آفتابی‌تر باشد و شخصیت‌ها بخندند…"
                  disabled={isAnalyzing}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                  <button
                    type="button"
                    className="danoa-btn danoa-btn--primary danoa-btn--sm"
                    onClick={() => void applyRevision()}
                    disabled={isAnalyzing || revisionRequest.trim().length < 5}
                  >
                    <Icon name={isAnalyzing ? 'spinner' : 'sparkle'} size={15} />
                    <span>اعمال تغییر در پیش‌نمایش</span>
                  </button>
                </div>
              </div>
            </section>
          ) : stage === 'scenes' && plan ? (
            /* Stage 4: Scenes Board (100% Anti-Nesting Comic Cards) */
            <section>
              <div className="storyboard-maker__scenes-head">
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 850 }}>{plan.title}</h2>
                  <p style={{ margin: '3px 0 0', color: 'var(--color-muted)', fontSize: '0.86rem' }}>{plan.summary}</p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="storyboard-maker__progress-badge">
                    <Icon name="check" size={14} />
                    <span>{completed.toLocaleString('fa-IR')} از {scenes.length.toLocaleString('fa-IR')} قاب آماده است</span>
                  </span>

                  <button
                    type="button"
                    className="danoa-btn danoa-btn--primary"
                    onClick={() => void generateAll()}
                    disabled={Boolean(activeSceneId)}
                  >
                    <Icon name={activeSceneId ? 'spinner' : 'studio-image'} size={18} />
                    <span>{activeSceneId ? 'در حال ساخت یک قاب…' : completed ? 'ساخت قاب‌های باقی‌مانده' : 'ساخت همهٔ قاب‌ها'}</span>
                  </button>
                </div>
              </div>

              {/* Scenes List (Single Edge-to-Edge Cards) */}
              <div className="storyboard-maker__scenes-list">
                {scenes.map((scene) => (
                  <article className="storyboard-maker__scene-card" key={scene.id}>
                    {/* Full-bleed Frame */}
                    <div className="storyboard-maker__scene-frame">
                      {scene.status === 'completed' ? (
                        <ProtectedSceneImage src={scene.imageUrl} alt={`تصویر ${scene.title}`} />
                      ) : (
                        <div className="storyboard-maker__scene-placeholder">
                          <Icon name={scene.status === 'generating' ? 'spinner' : 'studio-image'} size={32} />
                          <span>{scene.status === 'generating' ? 'در حال نقاشی تصویر…' : 'منتظر ساخت قاب'}</span>
                        </div>
                      )}
                    </div>

                    {/* Scene Body (Zero Nested Boxes) */}
                    <div className="storyboard-maker__scene-body">
                      <span className="storyboard-maker__scene-badge">
                        <Icon name="story" size={13} />
                        <span>سکانس {scene.number.toLocaleString('fa-IR')}{scene.durationSeconds ? ` · ${scene.durationSeconds.toLocaleString('fa-IR')} ثانیه` : ''}</span>
                      </span>

                      <h3>{scene.title}</h3>
                      <p>{scene.description}</p>

                      <div className="storyboard-maker__scene-details">
                        <div className="storyboard-maker__scene-detail-item">
                          <Icon name="sparkle" size={14} />
                          <span>اتفاق: <strong>{scene.action}</strong></span>
                        </div>
                        {scene.dialogue && (
                          <div className="storyboard-maker__scene-detail-item">
                            <Icon name="chat-bubble" size={14} />
                            <span>دیالوگ: <strong>{scene.dialogue}</strong></span>
                          </div>
                        )}
                      </div>

                      {scene.error && (
                        <p style={{ color: 'var(--color-danger)', fontSize: '0.8rem', fontWeight: 750, margin: '4px 0' }}>
                          {scene.error}
                        </p>
                      )}

                      <div>
                        <button
                          type="button"
                          className="danoa-btn danoa-btn--secondary danoa-btn--sm"
                          onClick={() => void generateScene(scene)}
                          disabled={Boolean(activeSceneId)}
                        >
                          <Icon name={activeSceneId === scene.id ? 'spinner' : 'sparkle'} size={15} />
                          <span>{scene.status === 'completed' ? 'ساخت دوبارهٔ این قاب' : 'ساخت این قاب'}</span>
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>

              {/* Storyboard Handoff Banner */}
              <div className="storyboard-maker__handoff-banner">
                <div className="storyboard-maker__handoff-copy">
                  <div className="storyboard-maker__handoff-icon">
                    <Icon name="rocket" size={24} />
                  </div>
                  <div>
                    <strong>تمام قاب‌های داستان آماده شدند!</strong>
                    <p>
                      {completed === scenes.length
                        ? 'تمام قاب‌های استوری‌برد ساخته شده‌اند؛ حالا می‌توانی فیلم نهایی را بسازی.'
                        : 'برای ساخت فیلم نهایی، تمام قاب‌های باقی‌مانده را بساز.'}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  className="danoa-btn storyboard-maker__handoff-btn"
                  onClick={() => void approveStoryboard()}
                  disabled={completed !== scenes.length || Boolean(activeSceneId)}
                >
                  <Icon name="rocket" size={18} />
                  <span>تأیید و ساخت فیلم نهایی</span>
                </button>
              </div>
            </section>
          ) : null}
        </section>
      )}

      {/* Library Selection Dialog */}
      <Dialog
        open={libraryOpen}
        title="انتخاب شخصیت از کتابخانه"
        onClose={() => { if (!isAddingFromLibrary) setLibraryOpen(false); }}
        dismissible={!isAddingFromLibrary}
        showFooter={false}
        panelClassName="storyboard-library-modal"
      >
        <div className="storyboard-library-modal__content" dir="rtl">
          <p className="storyboard-library-modal__subtitle">
            روی هر شخصیتی که دوست داری در این داستان حضور داشته باشد کلیک کن:
          </p>

          {libraryLoading && (
            <div className="storyboard-library-modal__loading">
              <Icon name="spinner" size={32} />
              <p>در حال باز کردن کمد شخصیت‌ها…</p>
            </div>
          )}

          {!libraryLoading && libraryError && (
            <div className="storyboard-library-modal__error">
              <Icon name="alert-triangle" size={16} />
              <span>{libraryError}</span>
            </div>
          )}

          {!libraryLoading && librarySheets.length ? (
            <div className="storyboard-library-modal__grid">
              {librarySheets.map((sheet) => {
                const selected = selectedLibraryKeys.includes(sheet.key);
                const alreadyAdded = references.some((ref) => ref.sourceKey === sheet.key);

                return (
                  <button
                    type="button"
                    key={sheet.key}
                    className={`storyboard-library-modal__card ${selected ? 'is-selected' : ''} ${alreadyAdded ? 'is-added' : ''}`}
                    disabled={alreadyAdded || isAddingFromLibrary}
                    onClick={() => toggleLibrarySheet(sheet.key)}
                    title={alreadyAdded ? `${sheet.name} قبلاً اضافه شده است` : sheet.name}
                  >
                    {/* Checkmark when selected */}
                    {selected && (
                      <span className="storyboard-library-modal__check" aria-hidden="true">
                        <Icon name="check" size={14} />
                      </span>
                    )}

                    {/* Added badge */}
                    {alreadyAdded && (
                      <span className="storyboard-library-modal__added-badge" aria-hidden="true">
                        <Icon name="check" size={11} />
                        <span>اضافه شده</span>
                      </span>
                    )}

                    <div className="storyboard-library-modal__img-wrap">
                      <LibraryCharacterImage src={sheet.imageUrl} alt={sheet.name} />
                    </div>

                    <div className="storyboard-library-modal__card-info">
                      <strong>{sheet.name}</strong>
                      <small>{sheet.workspaceTitle || 'شخصیت آماده'}</small>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : !libraryLoading && !libraryError ? (
            <div className="storyboard-library-modal__empty">
              <Icon name="family" size={44} />
              <h4>هنوز شخصیتی با نماهای آماده نداری</h4>
              <p>ابتدا در بخش «ساخت کاراکتر»، شخصیت‌های داستانت را بساز تا در این بخش نمایش داده شوند.</p>
            </div>
          ) : null}

          <div className="storyboard-library-modal__footer">
            <span className="storyboard-library-modal__count">
              {selectedLibraryKeys.length > 0
                ? `${selectedLibraryKeys.length.toLocaleString('fa-IR')} شخصیت انتخاب شد`
                : 'شخصیت‌های مورد نظرت را انتخاب کن'}
            </span>
            <div className="storyboard-library-modal__footer-btns">
              <button
                type="button"
                className="danoa-btn danoa-btn--secondary danoa-btn--sm"
                onClick={() => setLibraryOpen(false)}
                disabled={isAddingFromLibrary}
              >
                انصراف
              </button>
              <button
                type="button"
                className="danoa-btn danoa-btn--primary danoa-btn--sm"
                disabled={!selectedLibraryKeys.length || isAddingFromLibrary}
                onClick={() => void addSelectedLibrarySheets()}
              >
                <Icon name={isAddingFromLibrary ? 'spinner' : 'plus'} size={15} />
                <span>
                  {isAddingFromLibrary
                    ? 'در حال افزودن…'
                    : selectedLibraryKeys.length > 0
                    ? `افزودن ${selectedLibraryKeys.length.toLocaleString('fa-IR')} شخصیت`
                    : 'افزودن به داستان'}
                </span>
              </button>
            </div>
          </div>
        </div>
      </Dialog>
    </main>
  );
}
