import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, useNotification } from '../design-system/components';
import Icon from '../components/Icon';
import ImageViewer from '../ImageViewer';
import { fetchProtectedImageBlobUrl, type GalleryImage, getImageGenerationStatus, startImageEdit, startImageGeneration } from '../services/imageGeneration';
import { analyzeCharacters, createCharacterWorkspace, getCharacterWorkspace, listCharacterWorkspaces, updateCharacterWorkspace } from './characterMaker.api';
import { clearCharacterScenarioHandoff, readCharacterScenarioHandoff, type CharacterScenarioHandoff } from './characterScenarioHandoff';
import { saveStoryboardScenarioHandoff } from '../storyboard-maker/storyboardScenarioHandoff';
import { transitionAnimationProject } from '../animation-maker/animationMaker.api';
import type { CharacterImageState, CharacterProfile, CharacterWorkspace, CharacterWorkspaceStatus } from './characterMaker.types';
import './CharacterMakerPage.css';

type Props = { onBack: () => void; onOpenStoryboard: () => void };
type Tab = 'create' | 'library';
type ImageEditTarget = { id: string; name: string; ratio: '1:1' | '16:9'; asset: 'image' | 'sheet' | 'setting' | 'setting-sheet' };
type ImagePreviewTarget = { id: string; name: string; imageUrl: string; ratio: '1:1' | '16:9' };

const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const imageState = (taskId: string, options: Partial<CharacterImageState> = {}): CharacterImageState => ({ taskId, status: 'QUEUE', imageUrl: null, error: null, ...options });

const statusText = (status?: CharacterImageState['status']) => {
  switch (status) {
    case 'COMPLETED':
      return 'تصویر آماده است';
    case 'ERROR':
      return 'ساخت ناموفق بود';
    case 'RUNNING':
    case 'QUEUE':
      return 'در حال ساخت تصویر…';
    default:
      return 'آماده برای ساخت';
  }
};

const isImagePending = (image?: CharacterImageState | null) => Boolean(image?.taskId && image.status !== 'COMPLETED' && image.status !== 'ERROR');

const buildStyleLockedPrompt = (stylePrompt: string, assetPrompt: string) => `PROJECT STYLE LOCK — mandatory for every image in this story:
${stylePrompt || 'High-quality stylized 3D animated family-film visual language, cohesive non-photoreal rendering, warm cinematic lighting, cute friendly appeal, never live action or photography.'}

Generate this asset in exactly that one visual world. All characters and environments must look like they belong to the same animated production. Never switch medium, rendering level, or realism. Never generate a photograph, live action, a real person, or photorealistic skin. If the asset brief conflicts with the project style lock, preserve the character or scene information but ignore the conflicting stylistic instruction.

ASSET BRIEF:
${assetPrompt}`;

const buildCharacterSheetPrompt = (stylePrompt: string, character: CharacterProfile) => `ANIMATION CHARACTER MODEL SHEET — use the supplied reference image as the sole canonical identity for ${character.name}.

${buildStyleLockedPrompt(stylePrompt, `Create one polished 16:9 professional animation character sheet for ${character.name}. The sheet must show the exact same character only, in a clean and spacious grid on a plain neutral background: full-body front view, three-quarter view, side profile, rear view, high-angle view, low-angle view, a row of expressive head studies (neutral, happy, surprised, laughing), and one full-body natural action pose. Preserve these immutable identity traits: ${character.identityLock || character.appearance || character.name}. Preserve wardrobe: ${character.wardrobe || 'the supplied reference wardrobe'}. Keep the design, proportions, face, hair, colors and accessories identical in every view. No other characters, no scene background, no typography, captions, logos, arrows, duplicate identities, cropped body parts or collaged photo elements.`)}`;

const buildSettingSheetPrompt = (stylePrompt: string, name: string, description: string) => `ANIMATION ENVIRONMENT MODEL SHEET — use the supplied reference image as the sole canonical identity for the story location: ${name}.

${buildStyleLockedPrompt(stylePrompt, `Create one polished 16:9 environment sheet for ${name}. Show this exact same location only, arranged as a clear professional reference board: a wide establishing view, a medium eye-level view, an entrance or reverse angle, a side angle, a high-angle view, a low-angle view, and three close-up detail studies of defining props or materials. Preserve the exact layout, architecture, prop placement, color palette, lighting mood, scale and all recognizable details from the reference. Location description: ${description || name}. No characters, people, animals, new rooms, alternate locations, text, captions, logos, arrows, collaged images or unrelated objects.`)}`;

const EDIT_SUGGESTIONS = [
  'یک کلاه بامزه به سرش اضافه کن',
  'لباسش را به یک لباس فضانوردی رنگی تبدیل کن',
  'یک عینک گرد فانتزی به چشمش بزن',
  'یک تاج طلایی کوچک روی سرش بگذار',
  'یک کوله‌پشتی ماجراجویی با رنگ شاد به او بده'
];

function SecureImage({ src, alt }: { src?: string | null; alt: string }) {
  const [blobUrl, setBlobUrl] = useState('');
  useEffect(() => {
    let current = true;
    let objectUrl = '';
    if (!src) { setBlobUrl(''); return; }
    void fetchProtectedImageBlobUrl(src).then((url) => {
      objectUrl = url;
      if (current) setBlobUrl(url);
    }).catch(() => {
      if (current) setBlobUrl('');
    });
    return () => {
      current = false;
      if (objectUrl.startsWith('blob:')) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);
  return blobUrl ? (
    <img src={blobUrl} alt={alt} />
  ) : (
    <span className="character-maker__image-placeholder">
      <Icon name="sparkle" size={32} />
    </span>
  );
}

export default function CharacterMakerPage({ onBack, onOpenStoryboard }: Props) {
  const [tab, setTab] = useState<Tab>('create');
  const [scenario, setScenario] = useState('');
  const [scenarioHandoff, setScenarioHandoff] = useState<CharacterScenarioHandoff | null>(() => readCharacterScenarioHandoff());
  const [workspace, setWorkspace] = useState<CharacterWorkspace | null>(null);
  const [library, setLibrary] = useState<CharacterWorkspace[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isImageGenerationConfirmOpen, setIsImageGenerationConfirmOpen] = useState(false);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [error, setError] = useState('');
  const [imageEditTarget, setImageEditTarget] = useState<ImageEditTarget | null>(null);
  const [imageEditRequest, setImageEditRequest] = useState('');
  const [imageEditError, setImageEditError] = useState('');
  const [isEditingImage, setIsEditingImage] = useState(false);
  const [creatingSheetFor, setCreatingSheetFor] = useState<string | null>(null);
  const [isCreatingSettingSheet, setIsCreatingSettingSheet] = useState(false);
  const [imagePreview, setImagePreview] = useState<ImagePreviewTarget | null>(null);

  // In-card view state: switch between single portrait and multi-angle sheet seamlessly
  const [cardViews, setCardViews] = useState<Record<string, 'portrait' | 'sheet'>>({});
  const [settingView, setSettingView] = useState<'image' | 'sheet'>('image');

  const saveTimer = useRef<number | null>(null);
  const resultsRef = useRef<HTMLElement | null>(null);
  const shouldAutoScrollResults = useRef(false);
  const { notify } = useNotification();
  const analysis = workspace?.analysis || null;

  const activeItems = useMemo(() => analysis ? [
    ...analysis.characters.map((character) => ({
      id: character.id,
      prompt: buildStyleLockedPrompt(analysis.stylePrompt, character.imagePrompt),
      ratio: '1:1' as const,
      kind: 'character' as const
    })),
    {
      id: 'setting',
      prompt: buildStyleLockedPrompt(analysis.stylePrompt, analysis.setting.imagePrompt),
      ratio: '16:9' as const,
      kind: 'setting' as const
    }
  ] : [], [analysis]);

  const completedCount = activeItems.filter((item) => (item.kind === 'setting' ? analysis?.setting.image : analysis?.characters.find((character) => character.id === item.id)?.image)?.status === 'COMPLETED').length;
  const pendingImageCount = activeItems.filter((item) => isImagePending(item.kind === 'setting' ? analysis?.setting.image : analysis?.characters.find((character) => character.id === item.id)?.image)).length;
  const completedSheetCount = analysis?.characters.filter((character) => character.characterSheet?.status === 'COMPLETED').length || 0;
  const allCharacterSheetsReady = Boolean(analysis?.characters.length) && completedSheetCount === analysis?.characters.length;

  const imageEditSource = imageEditTarget
    ? imageEditTarget.asset === 'setting'
      ? analysis?.setting.image
      : imageEditTarget.asset === 'setting-sheet'
        ? analysis?.setting.settingSheet
      : imageEditTarget.asset === 'sheet'
        ? analysis?.characters.find((character) => character.id === imageEditTarget.id)?.characterSheet
        : analysis?.characters.find((character) => character.id === imageEditTarget.id)?.image
    : null;

  const imagePreviewItem: GalleryImage | null = imagePreview ? {
    id: imagePreview.id, taskId: imagePreview.id, originalPrompt: imagePreview.name, refinedPrompt: imagePreview.name,
    aspectRatio: imagePreview.ratio, operation: 'generate', status: 'COMPLETED', imageUrl: imagePreview.imageUrl,
    createdAt: '', updatedAt: ''
  } : null;

  const refreshLibrary = async () => {
    setLoadingLibrary(true);
    try { setLibrary(await listCharacterWorkspaces()); } catch { /* Offline fallback */ } finally { setLoadingLibrary(false); }
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

  const workspacePayload = (next: CharacterWorkspace, status: CharacterWorkspaceStatus = next.status) => ({
    title: next.title, scenario: next.scenario, status, analysis: next.analysis
  });

  const persist = async (next: CharacterWorkspace, status?: CharacterWorkspaceStatus) => {
    const saved = await updateCharacterWorkspace(next.id, workspacePayload(next, status));
    setWorkspace(saved);
    setLibrary((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
    return saved;
  };

  useEffect(() => () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); }, []);

  const handleAnalyze = async () => {
    const text = scenario.trim();
    if (!text) { setError('لطفاً داستان خود را بنویسید.'); return; }
    const animation = scenarioHandoff;
    setError('');
    setIsAnalyzing(true);
    try {
      if (animation?.animationProjectId) {
        await transitionAnimationProject(animation.animationProjectId, 'characters_generating', {
          storyWorkspaceId: animation.storyWorkspaceId, scenarioVersion: animation.scenarioVersion
        });
      }
      const nextAnalysis = await analyzeCharacters(text);
      const saved = await createCharacterWorkspace({ title: nextAnalysis.title, scenario: text, status: 'review', analysis: nextAnalysis });
      if (animation?.animationProjectId) {
        await transitionAnimationProject(animation.animationProjectId, 'characters_review', { characterWorkspaceId: saved.id });
      }
      shouldAutoScrollResults.current = true;
      setWorkspace(saved);
      setScenario(text);
      setTab('create');
      setIsImageGenerationConfirmOpen(true);
      clearCharacterScenarioHandoff();
      setScenarioHandoff(null);
      void refreshLibrary();
      notify.success(`قهرمان‌های داستان با موفقیت مشخص شدند.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تشخیص قهرمان‌ها انجام نشد.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const updateImageState = (source: CharacterWorkspace, targetId: string, nextImage: CharacterImageState): CharacterWorkspace => {
    if (!source.analysis) return source;
    return targetId === 'setting'
      ? { ...source, analysis: { ...source.analysis, setting: { ...source.analysis.setting, image: nextImage } } }
      : { ...source, analysis: { ...source.analysis, characters: source.analysis.characters.map((character) => character.id === targetId ? { ...character, image: nextImage } : character) } };
  };

  const updateCharacterSheet = (source: CharacterWorkspace, targetId: string, nextSheet: CharacterImageState): CharacterWorkspace => {
    if (!source.analysis) return source;
    return { ...source, analysis: { ...source.analysis, characters: source.analysis.characters.map((character) => character.id === targetId ? { ...character, characterSheet: nextSheet } : character) } };
  };

  const updateSettingSheet = (source: CharacterWorkspace, nextSheet: CharacterImageState): CharacterWorkspace => {
    if (!source.analysis) return source;
    return { ...source, analysis: { ...source.analysis, setting: { ...source.analysis.setting, settingSheet: nextSheet } } };
  };

  const openImageEditor = (target: ImageEditTarget) => {
    const character = analysis?.characters.find((item) => item.id === target.id);
    const image = target.asset === 'setting'
      ? analysis?.setting.image
      : target.asset === 'setting-sheet'
        ? analysis?.setting.settingSheet
        : target.asset === 'sheet'
          ? character?.characterSheet
          : character?.image;
    if (!image?.taskId || image.status !== 'COMPLETED') {
      notify.error('لطفاً تا پایان ساخت تصویر منتظر بمانید.');
      return;
    }
    setImageEditTarget(target);
    setImageEditRequest('');
    setImageEditError('');
  };

  const downloadPreview = async (item: GalleryImage) => {
    if (!item.imageUrl) return;
    try {
      const url = await fetchProtectedImageBlobUrl(item.imageUrl);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${item.originalPrompt || 'character-image'}.jpg`;
      link.click();
      if (url.startsWith('blob:')) window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      notify.error('دانلود تصویر انجام نشد.');
    }
  };

  const submitImageEdit = async () => {
    if (!workspace?.analysis || !imageEditTarget || isEditingImage) return;
    const request = imageEditRequest.trim();
    if (request.length < 5) { setImageEditError('لطفاً تغییر مورد نظر خود را بنویسید.'); return; }
    const character = workspace.analysis.characters.find((item) => item.id === imageEditTarget.id);
    const currentImage = imageEditTarget.asset === 'setting'
      ? workspace.analysis.setting.image
      : imageEditTarget.asset === 'setting-sheet'
        ? workspace.analysis.setting.settingSheet
      : imageEditTarget.asset === 'sheet' ? character?.characterSheet : character?.image;

    if (!currentImage?.taskId || currentImage.status !== 'COMPLETED') {
      setImageEditError('تصویر آماده نیست؛ لطفاً یک‌بار صفحه را تازه کنید.');
      return;
    }
    setIsEditingImage(true);
    setImageEditError('');
    setError('');
    try {
      const result = await startImageEdit(currentImage.taskId, request, imageEditTarget.ratio, makeId(`character-edit-${imageEditTarget.id}`));
      const nextImage = imageState(result.taskId, {
        operation: 'edit', previousImageUrl: currentImage.imageUrl || currentImage.previousImageUrl || null
      });
      const next = imageEditTarget.asset === 'setting-sheet'
        ? updateSettingSheet(workspace, nextImage)
        : imageEditTarget.asset === 'sheet'
        ? updateCharacterSheet(workspace, imageEditTarget.id, nextImage)
        : imageEditTarget.asset === 'image'
          ? { ...workspace, analysis: { ...workspace.analysis, characters: workspace.analysis.characters.map((item) => item.id === imageEditTarget.id ? { ...item, image: nextImage, characterSheet: undefined } : item) } }
          : updateImageState(workspace, imageEditTarget.id, nextImage);

      await persist(next, 'generating');
      if (scenarioHandoff?.animationProjectId) {
        await transitionAnimationProject(scenarioHandoff.animationProjectId, 'characters_review', {
          characterWorkspaceId: next.id, revisionRequest: `${imageEditTarget.name}: ${request}`
        });
      }
      setImageEditTarget(null);
      setImageEditRequest('');
      notify.success(`ویرایش تصویر ${imageEditTarget.name} شروع شد.`);
    } catch (cause) {
      setImageEditError(cause instanceof Error ? cause.message : 'تغییر تصویر شروع نشد.');
    } finally {
      setIsEditingImage(false);
    }
  };

  const createCharacterSheet = async (character: CharacterProfile) => {
    if (!workspace?.analysis || creatingSheetFor) return;
    const sourceImage = character.image;
    if (!sourceImage?.taskId || sourceImage.status !== 'COMPLETED') {
      notify.error('ابتدا تصویر چهره اصلی باید آماده شود.');
      return;
    }
    if (character.characterSheet?.taskId && character.characterSheet.status !== 'ERROR') {
      setCardViews((prev) => ({ ...prev, [character.id]: 'sheet' }));
      return;
    }
    setCreatingSheetFor(character.id);
    setError('');
    setCardViews((prev) => ({ ...prev, [character.id]: 'sheet' }));
    try {
      const result = await startImageEdit(sourceImage.taskId, buildCharacterSheetPrompt(workspace.analysis.stylePrompt, character), '16:9', makeId(`character-sheet-${character.id}`));
      const next = updateCharacterSheet(workspace, character.id, imageState(result.taskId, { operation: 'sheet' }));
      setWorkspace(next);
      await persist(next, 'generating');
      if (scenarioHandoff?.animationProjectId) {
        await transitionAnimationProject(scenarioHandoff.animationProjectId, 'characters_review', {
          characterWorkspaceId: next.id, revisionRequest: `بازتولید نماهای ${character.name}`
        });
      }
      notify.success(`ساخت نماهای مختلف ${character.name} شروع شد.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ساخت نماهای مختلف شروع نشد.');
    } finally {
      setCreatingSheetFor(null);
    }
  };

  const createSettingSheet = async () => {
    if (!workspace?.analysis || isCreatingSettingSheet) return;
    const setting = workspace.analysis.setting;
    if (!setting.image?.taskId || setting.image.status !== 'COMPLETED') {
      notify.error('ابتدا تصویر محیط داستان باید آماده شود.');
      return;
    }
    if (setting.settingSheet?.taskId && setting.settingSheet.status !== 'ERROR') {
      setSettingView('sheet');
      return;
    }
    setIsCreatingSettingSheet(true);
    setSettingView('sheet');
    setError('');
    try {
      const result = await startImageEdit(setting.image.taskId, buildSettingSheetPrompt(workspace.analysis.stylePrompt, setting.name, setting.description), '16:9', makeId('setting-sheet'));
      const next = updateSettingSheet(workspace, imageState(result.taskId, { operation: 'setting-sheet' }));
      setWorkspace(next);
      await persist(next, 'generating');
      notify.success(`ساخت نماهای مختلف ${setting.name} شروع شد.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ساخت نماهای محیط شروع نشد.');
    } finally {
      setIsCreatingSettingSheet(false);
    }
  };

  const approveCharactersAndOpenStoryboard = async () => {
    if (!workspace?.analysis) return;
    const sheetsReady = workspace.analysis.characters.every((character) => character.characterSheet?.status === 'COMPLETED');
    if (!sheetsReady) {
      notify.error('ابتدا نماهای مختلف همهٔ شخصیت‌ها را کامل کنید تا در فیلم یکپارچه بمانند.');
      return;
    }
    try {
      if (scenarioHandoff?.animationProjectId) {
        await transitionAnimationProject(scenarioHandoff.animationProjectId, 'characters_approved', { characterWorkspaceId: workspace.id });
      }
      saveStoryboardScenarioHandoff(scenario, analysis?.title || workspace.title, {
        animationProjectId: scenarioHandoff?.animationProjectId,
        storyWorkspaceId: scenarioHandoff?.storyWorkspaceId,
        characterWorkspaceId: workspace.id,
        scenarioVersion: scenarioHandoff?.scenarioVersion,
        durationSeconds: scenarioHandoff?.durationSeconds
      });
      onOpenStoryboard();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تأیید شخصیت‌ها انجام نشد.');
    }
  };

  const generateImages = async () => {
    if (!workspace?.analysis || isGenerating) return;
    setIsGenerating(true);
    setError('');
    let next = workspace;
    try {
      for (const item of activeItems) {
        const existing = item.kind === 'setting'
          ? next.analysis?.setting.image
          : next.analysis?.characters.find((character) => character.id === item.id)?.image;
        if (existing?.taskId && existing.status !== 'ERROR') continue;
        const result = await startImageGeneration(item.prompt, {
          aspectRatio: item.ratio, idempotencyKey: makeId(`character-${item.id}`)
        });
        next = updateImageState(next, item.id, imageState(result.taskId));
        setWorkspace(next);
      }
      await persist(next, 'generating');
      notify.success('ساخت تصاویر شروع شد؛ کارت‌ها خودکار به‌روزرسانی می‌شوند.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ارسال ساخت تصاویر انجام نشد.');
    } finally {
      setIsGenerating(false);
    }
  };

  const confirmImageGeneration = () => {
    setIsImageGenerationConfirmOpen(false);
    void generateImages();
  };

  // Polling for generation status
  useEffect(() => {
    const isPending = (image?: CharacterImageState) => Boolean(image?.taskId && image.status !== 'COMPLETED' && image.status !== 'ERROR');
    if (!workspace?.analysis || (!activeItems.some((item) => isPending(item.kind === 'setting' ? workspace.analysis?.setting.image : workspace.analysis?.characters.find((character) => character.id === item.id)?.image)) && !workspace.analysis.characters.some((character) => isPending(character.characterSheet)) && !isPending(workspace.analysis.setting.settingSheet))) return;

    const poll = async () => {
      let next = workspace;
      let changed = false;
      for (const item of activeItems) {
        const previous = item.kind === 'setting' ? next.analysis?.setting.image : next.analysis?.characters.find((character) => character.id === item.id)?.image;
        if (!previous?.taskId || previous.status === 'COMPLETED' || previous.status === 'ERROR') continue;
        try {
          const status = await getImageGenerationStatus(previous.taskId);
          if (status.status !== previous.status || status.imageUrl !== previous.imageUrl || status.error !== previous.error) {
            next = updateImageState(next, item.id, { ...previous, status: status.status, imageUrl: status.imageUrl, error: status.error });
            changed = true;
          }
        } catch { /* Retry later */ }
      }
      for (const character of next.analysis?.characters || []) {
        const previous = character.characterSheet;
        if (!previous?.taskId || previous.status === 'COMPLETED' || previous.status === 'ERROR') continue;
        try {
          const status = await getImageGenerationStatus(previous.taskId);
          if (status.status !== previous.status || status.imageUrl !== previous.imageUrl || status.error !== previous.error) {
            next = updateCharacterSheet(next, character.id, { ...previous, status: status.status, imageUrl: status.imageUrl, error: status.error });
            changed = true;
          }
        } catch { /* Retry later */ }
      }
      const settingSheet = next.analysis?.setting.settingSheet;
      if (settingSheet?.taskId && settingSheet.status !== 'COMPLETED' && settingSheet.status !== 'ERROR') {
        try {
          const status = await getImageGenerationStatus(settingSheet.taskId);
          if (status.status !== settingSheet.status || status.imageUrl !== settingSheet.imageUrl || status.error !== settingSheet.error) {
            next = updateSettingSheet(next, { ...settingSheet, status: status.status, imageUrl: status.imageUrl, error: status.error });
            changed = true;
          }
        } catch { /* Retry later */ }
      }
      if (changed) {
        const allDone = activeItems.every((item) => {
          const image = item.kind === 'setting' ? next.analysis?.setting.image : next.analysis?.characters.find((character) => character.id === item.id)?.image;
          return image?.status === 'COMPLETED' || image?.status === 'ERROR';
        });
        const sheetsDone = (next.analysis?.characters || []).every((character) => !character.characterSheet || character.characterSheet.status === 'COMPLETED' || character.characterSheet.status === 'ERROR') && (!next.analysis?.setting.settingSheet || next.analysis.setting.settingSheet.status === 'COMPLETED' || next.analysis.setting.settingSheet.status === 'ERROR');
        try { await persist(next, allDone && sheetsDone ? 'completed' : 'generating'); } catch { setWorkspace(next); }
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3200);
    return () => window.clearInterval(timer);
  }, [workspace?.id, workspace?.analysis, activeItems]);

  const openLibraryItem = async (id: string) => {
    try {
      const next = await getCharacterWorkspace(id);
      setWorkspace(next);
      setScenario(next.scenario);
      setTab('create');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'پروژه باز نشد.');
    }
  };

  return (
    <main className="character-maker" dir="rtl" id="main-content">
      {/* Header */}
      <header className="character-maker__header">
        <button
          type="button"
          className="character-maker__back"
          onClick={onBack}
          aria-label="بازگشت به استودیو"
          title="بازگشت به استودیو"
        >
          <Icon name="chevron-right" size={20} />
        </button>

        <div className="character-maker__brand">
          <span className="character-maker__brand-mark">
            <Icon name="family" size={22} />
          </span>
          <div className="character-maker__brand-copy">
            <strong>ساخت شخصیت‌ها</strong>
            <small>هویت تصویری برای داستان‌های تو</small>
          </div>
        </div>

        <span className="character-maker__header-spacer" aria-hidden="true" />
      </header>

      {/* Navigation Tabs */}
      <nav className="character-maker__tabs" role="tablist" aria-label="بخش‌های ساخت شخصیت‌ها">
        <button
          id="character-create-tab"
          type="button"
          role="tab"
          aria-selected={tab === 'create'}
          tabIndex={tab === 'create' ? 0 : -1}
          onClick={() => setTab('create')}
        >
          <Icon name="sparkles" size={16} />
          <span>کارگاه ساخت</span>
        </button>
        <button
          id="character-library-tab"
          type="button"
          role="tab"
          aria-selected={tab === 'library'}
          tabIndex={tab === 'library' ? 0 : -1}
          onClick={() => setTab('library')}
        >
          <Icon name="book" size={16} />
          <span>قهرمان‌های من</span>
          <i>{library.length}</i>
        </button>
      </nav>

      {/* Library Panel */}
      {tab === 'library' ? (
        <section aria-label="کتابخانه کاراکترها">
          <div className="character-maker__results-head">
            <div className="character-maker__results-title">
              <Icon name="book" size={24} />
              <div>
                <h2>کتابخانهٔ کاراکترها</h2>
                <p>قهرمان‌هایی که تا امروز ساخته‌ای اینجا ذخیره شده‌اند.</p>
              </div>
            </div>
            <button type="button" className="danoa-btn danoa-btn--primary" onClick={() => setTab('create')}>
              <Icon name="plus" size={16} />
              <span>ساخت شخصیت جدید</span>
            </button>
          </div>

          {loadingLibrary ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-muted)' }}>
              <Icon name="spinner" size={32} />
              <p style={{ marginTop: 12, fontWeight: 700 }}>در حال بارگذاری کتابخانه…</p>
            </div>
          ) : library.length ? (
            <div className="character-maker__library-grid">
              {library.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="character-maker__storybook-card"
                  onClick={() => void openLibraryItem(item.id)}
                >
                  <div className="character-maker__storybook-icon">
                    <Icon name="story" size={24} />
                  </div>
                  <div className="character-maker__storybook-info">
                    <strong>{item.title || 'داستان بدون عنوان'}</strong>
                    <small>
                      {item.status === 'completed' ? 'تکمیل‌شده' : item.status === 'generating' ? 'در حال ساخت' : 'آماده بررسی'}
                    </small>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '60px 20px', background: 'var(--color-surface-2)', borderRadius: 22, border: '1px solid var(--color-border)' }}>
              <Icon name="family" size={40} style={{ color: 'var(--color-muted)', marginBottom: 12 }} />
              <h3 style={{ fontWeight: 800, fontSize: '1.15rem' }}>هنوز کاراکتری ذخیره نشده است</h3>
              <p style={{ color: 'var(--color-muted)', margin: '6px 0 20px' }}>داستان اولت را وارد کن تا قهرمان‌هایت ساخته شوند.</p>
              <button type="button" className="danoa-btn danoa-btn--primary" onClick={() => setTab('create')}>
                <Icon name="sparkles" size={16} />
                <span>شروع ساخت</span>
              </button>
            </div>
          )}
        </section>
      ) : (
        /* Create Panel */
        <section>
          {/* Hero Section */}
          <section className="character-maker__hero">
            <div className="character-maker__hero-copy">
              <span className="character-maker__eyebrow">
                <Icon name="sparkle" size={14} />
                قدم ۲: خلق قهرمان‌های داستان
              </span>
              <h1>قهرمان‌های داستانت را بساز</h1>
              <p>داستانت را بگو تا هویت تصویری، لباس‌ها و دنیای قشنگشان را برایت آماده کنیم.</p>
            </div>
          </section>

          {/* Scenario Input: Direct Canvas Surface (Zero Nested Boxes) */}
          <section className="character-maker__story-panel">
            <div className="character-maker__story-intro">
              <span className="character-maker__step">۱</span>
              <div>
                <h2>داستانت را برامون بگو</h2>
                <p>می‌توانی چند خط داستانت را بنویسی:</p>
              </div>
            </div>

            {/* The single writing surface */}
            <textarea
              className="character-maker__textarea"
              value={scenario}
              onChange={(e) => setScenario(e.target.value.slice(0, 8000))}
              placeholder="مثلاً: یه بچه خرس کوچولو به اسم فندقی با کلاه زرد و عینک گرد، با دوستش یه پرنده آبی پرواز می‌کنند به شهر ابرها…"
              rows={4}
              disabled={isAnalyzing}
            />

            <div className="character-maker__story-footer">
              <span className="character-maker__char-count">
                {new Intl.NumberFormat('fa-IR').format(scenario.length)} / ۸٬۰۰۰ کاراکتر
              </span>

              <button
                type="button"
                className="danoa-btn danoa-btn--primary"
                onClick={() => void handleAnalyze()}
                disabled={isAnalyzing || !scenario.trim()}
              >
                <Icon name={isAnalyzing ? 'spinner' : 'sparkles'} size={18} />
                <span>{isAnalyzing ? 'در حال ساخت شخصیت‌ها…' : 'ساخت شخصیت‌ها'}</span>
              </button>
            </div>
          </section>

          {error && (
            <div style={{
              maxWidth: 1120, margin: '0 auto 20px', background: 'color-mix(in srgb, var(--color-danger) 8%, var(--color-surface-2))',
              border: '1px solid color-mix(in srgb, var(--color-danger) 30%, var(--color-border))', borderRadius: 14,
              padding: '12px 16px', color: 'var(--color-danger)', fontWeight: 750, display: 'flex', alignItems: 'center', gap: 10
            }}>
              <Icon name="alert-triangle" size={18} />
              <span>{error}</span>
            </div>
          )}

          {/* Results Stage: Direct Canvas Flow (NO NESTED BOXES) */}
          {analysis && (
            <section ref={resultsRef}>
              <div className="character-maker__results-head">
                <div className="character-maker__results-title">
                  <span className="character-maker__step">۲</span>
                  <div>
                    <h2>{analysis.title}</h2>
                    <p>{analysis.summary}</p>
                  </div>
                </div>

                <div className="character-maker__results-actions">
                  <span className="character-maker__count-badge">
                    <Icon name="check" size={14} />
                    <span>{completedCount} از {activeItems.length} تصویر آماده</span>
                  </span>

                  <button
                    type="button"
                    className="danoa-btn danoa-btn--primary"
                    onClick={() => setIsImageGenerationConfirmOpen(true)}
                    disabled={isGenerating || pendingImageCount > 0}
                  >
                    <Icon name={isGenerating || pendingImageCount > 0 ? 'spinner' : 'studio-image'} size={18} />
                    <span>
                      {isGenerating ? 'در حال ارسال…' : pendingImageCount ? 'تصاویر در حال ساختند' : completedCount ? 'تکمیل تصاویر' : 'ساخت همهٔ تصاویر'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Characters Grid: Single Edge-to-Edge Cards */}
              <div className="character-maker__grid">
                {analysis.characters.map((character, index) => {
                  const showingSheet = cardViews[character.id] === 'sheet' && character.characterSheet;
                  const activeImg = showingSheet ? character.characterSheet : character.image;
                  const activeRatio = showingSheet ? '16:9' : '1:1';
                  const activeName = showingSheet ? `همهٔ زاویه‌های ${character.name}` : character.name;
                  const isImageProcessing = activeImg?.status === 'RUNNING' || activeImg?.status === 'QUEUE';

                  return (
                    <article key={character.id} className="character-maker__card">
                      {/* Full-bleed Edge-to-Edge Image (No Inset Box) */}
                      <div
                        className={`character-maker__display ${showingSheet ? 'is-sheet' : ''}`}
                        aria-busy={isImageProcessing}
                      >
                        <SecureImage src={activeImg?.imageUrl || activeImg?.previousImageUrl} alt={activeName} />

                        {isImageProcessing && (
                          <div className="character-maker__image-loading" role="status" aria-label="تصویر در حال ساخت است">
                            <span className="character-maker__image-loading-orb" aria-hidden="true">
                              <Icon name="spinner" size={30} />
                            </span>
                          </div>
                        )}

                        {activeImg?.imageUrl && (
                          <button
                            type="button"
                            onClick={() => {
                              const url = activeImg.imageUrl || activeImg.previousImageUrl;
                              if (url) setImagePreview({ id: activeImg.taskId || character.id, name: activeName, imageUrl: url, ratio: activeRatio });
                            }}
                            style={{
                              position: 'absolute', inset: 0, border: 0, background: 'transparent',
                              cursor: 'zoom-in', width: '100%', height: '100%'
                            }}
                            title="نمایش بزرگ تصویر"
                            aria-label={`نمایش بزرگ ${activeName}`}
                          />
                        )}

                        {/* Floating View Switcher Over Image (No row inside card) */}
                        <div className="character-maker__floating-switcher">
                          <button
                            type="button"
                            className={!showingSheet ? 'is-active' : ''}
                            onClick={() => setCardViews((prev) => ({ ...prev, [character.id]: 'portrait' }))}
                          >
                            <Icon name="user" size={13} />
                            <span>چهره</span>
                          </button>
                          <button
                            type="button"
                            className={showingSheet ? 'is-active' : ''}
                            onClick={() => {
                              if (!character.characterSheet) {
                                void createCharacterSheet(character);
                              } else {
                                setCardViews((prev) => ({ ...prev, [character.id]: 'sheet' }));
                              }
                            }}
                          >
                            <Icon name="grid" size={13} />
                            <span>{character.characterSheet ? 'نماها' : 'ساخت نماها'}</span>
                          </button>
                        </div>

                        {/* Floating Status Pill */}
                        {!isImageProcessing && (
                          <span className={`character-maker__status-pill is-${activeImg?.status || 'idle'}`}>
                            <Icon name={activeImg?.status === 'COMPLETED' ? 'check' : activeImg?.status === 'ERROR' ? 'alert-triangle' : 'sparkle'} size={14} />
                            <span>{statusText(activeImg?.status)}</span>
                          </span>
                        )}
                      </div>

                      {/* Card Body: Clean Typography (ZERO nested colored boxes) */}
                      <div className="character-maker__card-body">
                        <div className="character-maker__card-title-row">
                          <h3>{character.name}</h3>
                          <span className="character-maker__card-num">قهرمان {index + 1}</span>
                        </div>

                        <div className="character-maker__card-desc">
                          <div className="character-maker__card-info-item">
                            <Icon name="sparkle" size={14} />
                            <span>نقش: <strong>{character.role || 'قهرمان داستانی'}</strong></span>
                          </div>
                          <div className="character-maker__card-info-item">
                            <Icon name="heart" size={14} />
                            <span>شخصیت: <strong>{character.personality || 'شجاع و کنجکاو'}</strong></span>
                          </div>
                        </div>
                      </div>

                      {/* Card Actions */}
                      <div className="character-maker__card-actions">
                        <button
                          type="button"
                          className="danoa-btn danoa-btn--secondary danoa-btn--sm"
                          onClick={() => openImageEditor({
                            id: character.id,
                            name: activeName,
                            ratio: activeRatio,
                            asset: showingSheet ? 'sheet' : 'image'
                          })}
                          disabled={activeImg?.status !== 'COMPLETED'}
                        >
                          <Icon name="edit" size={15} />
                          <span>ویرایش تصویر</span>
                        </button>

                        <button
                          type="button"
                          className="danoa-btn danoa-btn--primary danoa-btn--sm"
                          onClick={() => void createCharacterSheet(character)}
                          disabled={character.image?.status !== 'COMPLETED' || Boolean(creatingSheetFor) || (Boolean(character.characterSheet?.taskId) && character.characterSheet?.status !== 'ERROR')}
                        >
                          <Icon name={creatingSheetFor === character.id ? 'spinner' : 'sparkles'} size={15} />
                          <span>{character.characterSheet?.status === 'COMPLETED' ? 'زاویه‌ها آماده است' : 'ساخت زاویه‌ها'}</span>
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>

              {/* Setting Card: Edge-to-Edge Single Card (NO NESTED BOXES) */}
              <div className="character-maker__setting-card">
                <div className="character-maker__setting-display">
                  <SecureImage
                    src={settingView === 'sheet' && analysis.setting.settingSheet
                      ? (analysis.setting.settingSheet.imageUrl || analysis.setting.settingSheet.previousImageUrl)
                      : (analysis.setting.image?.imageUrl || analysis.setting.image?.previousImageUrl)}
                    alt={`محیط داستان: ${analysis.setting.name}`}
                  />
                  <span className={`character-maker__status-pill is-${(settingView === 'sheet' ? analysis.setting.settingSheet : analysis.setting.image)?.status || 'idle'}`}>
                    <Icon name={(settingView === 'sheet' ? analysis.setting.settingSheet : analysis.setting.image)?.status === 'COMPLETED' ? 'check' : 'sparkle'} size={14} />
                    <span>{statusText((settingView === 'sheet' ? analysis.setting.settingSheet : analysis.setting.image)?.status)}</span>
                  </span>
                </div>

                <div className="character-maker__setting-info">
                  <span className="character-maker__setting-badge">
                    <Icon name="story" size={14} />
                    <span>دنیای داستان</span>
                  </span>
                  <h3>{analysis.setting.name}</h3>
                  <p>{analysis.setting.description}</p>

                  <div className="character-maker__setting-actions">
                    <button
                      type="button"
                      className="danoa-btn danoa-btn--secondary danoa-btn--sm"
                      onClick={() => openImageEditor({
                        id: 'setting',
                        name: analysis.setting.name,
                        ratio: '16:9',
                        asset: settingView === 'sheet' ? 'setting-sheet' : 'setting'
                      })}
                      disabled={(settingView === 'sheet' ? analysis.setting.settingSheet : analysis.setting.image)?.status !== 'COMPLETED'}
                    >
                      <Icon name="edit" size={15} />
                      <span>ویرایش تصویر</span>
                    </button>

                    <button
                      type="button"
                      className="danoa-btn danoa-btn--primary danoa-btn--sm"
                      onClick={() => void createSettingSheet()}
                      disabled={analysis.setting.image?.status !== 'COMPLETED' || isCreatingSettingSheet}
                    >
                      <Icon name={isCreatingSettingSheet ? 'spinner' : 'sparkles'} size={15} />
                      <span>{analysis.setting.settingSheet?.status === 'COMPLETED' ? 'نماهای محیط آماده است' : 'ساخت نماهای محیط'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Storyboard Handoff Banner */}
              <div className="character-maker__handoff-banner">
                <div className="character-maker__handoff-copy">
                  <div className="character-maker__handoff-icon">
                    <Icon name="rocket" size={24} />
                  </div>
                  <div>
                    <strong>قهرمان‌ها آماده هستند!</strong>
                    <p>
                      {allCharacterSheetsReady
                        ? 'همهٔ نماهای شخصیت‌ها آماده شده‌اند؛ اکنون می‌توانید وارد ساخت کارتون و استوری‌برد شوید.'
                        : 'برای ساخت کارتون، نماهای مختلف همهٔ قهرمان‌ها را آماده کنید تا در فیلم یکپارچه بمانند.'}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  className="danoa-btn character-maker__handoff-btn"
                  onClick={() => void approveCharactersAndOpenStoryboard()}
                  disabled={!allCharacterSheetsReady}
                >
                  <Icon name="rocket" size={18} />
                  <span>تأیید و رفتن به استوری‌برد</span>
                </button>
              </div>
            </section>
          )}
        </section>
      )}

      {/* Edit Dialog */}
      <Dialog
        open={Boolean(imageEditTarget)}
        title={imageEditTarget ? `ویرایش تصویر ${imageEditTarget.name}` : 'ویرایش تصویر'}
        onClose={() => { if (!isEditingImage) setImageEditTarget(null); }}
        dismissible={!isEditingImage}
        showFooter={false}
      >
        {imageEditTarget && (
          <div dir="rtl" style={{ display: 'grid', gap: 16 }}>
            <div style={{
              width: 140, height: 140, margin: '0 auto', borderRadius: 16,
              overflow: 'hidden', border: '1px solid var(--color-border)', background: 'var(--color-surface-container-lowest)'
            }}>
              <SecureImage src={imageEditSource?.imageUrl || imageEditSource?.previousImageUrl} alt="تصویر فعلی" />
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              <label htmlFor="edit-req-input" style={{ fontWeight: 800, fontSize: '0.9rem' }}>
                چه تغییری در قیافه یا لباس این شخصیت اعمال شود؟
              </label>
              <textarea
                id="edit-req-input"
                className="character-maker__textarea"
                style={{ minHeight: 90 }}
                value={imageEditRequest}
                onChange={(e) => { setImageEditRequest(e.target.value.slice(0, 900)); setImageEditError(''); }}
                placeholder="مثلاً: کلاه قرمزی بر سرش بگذار، یا رنگ لباسش را به آبی تغییر بده…"
                rows={3}
                disabled={isEditingImage}
              />

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                {EDIT_SUGGESTIONS.map((sug, i) => (
                  <button
                    key={i}
                    type="button"
                    className="character-maker__starter-chip"
                    onClick={() => setImageEditRequest((prev) => prev ? `${prev} و ${sug}` : sug)}
                  >
                    <span>{sug}</span>
                  </button>
                ))}
              </div>
            </div>

            {imageEditError && (
              <p style={{ color: 'var(--color-danger)', fontWeight: 700, fontSize: '0.82rem', margin: 0 }}>
                {imageEditError}
              </p>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
              <button
                type="button"
                className="danoa-btn danoa-btn--secondary danoa-btn--sm"
                onClick={() => setImageEditTarget(null)}
                disabled={isEditingImage}
              >
                انصراف
              </button>
              <button
                type="button"
                className="danoa-btn danoa-btn--primary danoa-btn--sm"
                onClick={() => void submitImageEdit()}
                disabled={isEditingImage || imageEditRequest.trim().length < 5}
              >
                <Icon name={isEditingImage ? 'spinner' : 'sparkles'} size={16} />
                <span>{isEditingImage ? 'در حال اعمال تغییر…' : 'اعمال تغییر'}</span>
              </button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Confirmation Dialog for Image Generation */}
      <Dialog
        open={isImageGenerationConfirmOpen}
        title="تصاویر قهرمان‌ها ساخته شوند؟"
        onClose={() => setIsImageGenerationConfirmOpen(false)}
        onConfirm={confirmImageGeneration}
        confirmText="تأیید و ساخت تصاویر"
        cancelText="انصراف"
      >
        <div style={{ padding: '10px 0', textAlign: 'center' }}>
          <Icon name="sparkles" size={40} style={{ color: 'var(--color-primary)', marginBottom: 8 }} />
          <p style={{ fontSize: '1rem', fontWeight: 750, color: 'var(--color-text)' }}>
            {analysis
              ? `${new Intl.NumberFormat('fa-IR').format(analysis.characters.length)} کاراکتر و فضای داستان آماده هستند. با تأیید شما ساخت تصاویر شروع می‌شود.`
              : 'با تأیید شما ساخت تصاویر شروع می‌شود.'}
          </p>
        </div>
      </Dialog>

      {/* Full-screen Image Viewer */}
      {imagePreviewItem && (
        <ImageViewer
          item={imagePreviewItem}
          onClose={() => setImagePreview(null)}
          onDownload={(item) => void downloadPreview(item)}
        />
      )}
    </main>
  );
}
