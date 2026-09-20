import { useEffect, useId, useRef, useState } from 'react';
import { Button, InlineMessage } from '../design-system/components';
import Icon from '../components/Icon';
import { fetchProtectedImageBlobUrl } from '../services/imageGeneration';
import { videoGenerationService } from '../video-generation/video-generation.service';
import type { VideoGenerationStatus, VideoInputMedia } from '../video-generation/video-generation.types';
import { listStoryboardWorkspaces, getStoryboardWorkspace } from '../storyboard-maker/storyboardMaker.api';
import type { StoryboardWorkspace } from '../storyboard-maker/storyboardMaker.types';
import { composeDirectSceneVideo, createDirectSceneVideoPlan } from './directSceneVideo.service';
import { readAnimationVideoHandoff } from '../animation-maker/animationVideoHandoff';
import { getAnimationVideoJob, retryAnimationVideoScene, transitionAnimationProject, type AnimationVideoJob } from '../animation-maker/animationMaker.api';
import type { DirectSceneSource, DirectSceneVideoPlan } from './directSceneVideo.types';
import './DirectSceneVideoPage.css';

type Props = { onBack: () => void };
type SourceMode = 'workspace' | 'upload';

const toSources = (workspace: StoryboardWorkspace): DirectSceneSource[] => (workspace.scenes || []).map((scene, index) => ({
  id: scene.id,
  number: scene.number || index + 1,
  title: scene.title,
  description: scene.description,
  action: scene.action,
  camera: scene.camera,
  dialogue: scene.dialogue,
  mood: scene.mood,
  imageUrl: scene.imageUrl
}));

const uploadSources = (files: File[]): DirectSceneSource[] => files.map((file, index) => ({
  id: `uploaded-scene-${index + 1}`,
  number: index + 1,
  title: `قاب ${index + 1}`,
  description: `تصویر استوری‌برد بارگذاری‌شده: ${file.name}`,
  imageUrl: URL.createObjectURL(file)
}));

const completeStatuses = new Set<VideoGenerationStatus>(['succeeded', 'failed', 'cancelled', 'expired']);
async function waitForSceneVideo(generationId: string): Promise<{ id: string; status: string }> {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const current = await videoGenerationService.getVideoGeneration(generationId);
    if (completeStatuses.has(current.status as VideoGenerationStatus)) return { id: generationId, status: current.status };
    await new Promise<void>((resolve) => window.setTimeout(resolve, Math.min(8_000, 1_500 + attempt * 250)));
  }
  return { id: generationId, status: 'expired' };
}

export default function DirectSceneVideoPage({ onBack }: Props) {
  const [animationHandoff] = useState(() => readAnimationVideoHandoff());
  const [animationJob, setAnimationJob] = useState<AnimationVideoJob | null>(null);
  const fileInputId = useId();
  const [mode, setMode] = useState<SourceMode>('workspace');
  const [workspaces, setWorkspaces] = useState<StoryboardWorkspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspace, setWorkspace] = useState<StoryboardWorkspace | null>(null);
  const [uploadedScenes, setUploadedScenes] = useState<DirectSceneSource[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<Record<string, File>>({});
  const [scenario, setScenario] = useState('');
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<DirectSceneVideoPlan | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderState, setRenderState] = useState('');
  const [finalVideo, setFinalVideo] = useState<{ contentUrl: string; downloadUrl: string } | null>(null);
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    void (async () => {
      try { setWorkspaces(await listStoryboardWorkspaces()); }
      catch (reason) { setError(reason instanceof Error ? reason.message : 'دریافت استوری‌بردها انجام نشد.'); }
      finally { setLoadingLibrary(false); }
    })();
    return () => urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => { if (animationHandoff?.storyboardWorkspaceId) void selectWorkspace(animationHandoff.storyboardWorkspaceId); }, [animationHandoff?.storyboardWorkspaceId]);
  useEffect(() => {
    if (!animationHandoff) return;
    let active = true;
    const refresh = async () => { try { const job = await getAnimationVideoJob(animationHandoff.animationProjectId); if (active && job) setAnimationJob(job); } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : 'دریافت وضعیت ویدیو انجام نشد.'); } };
    void refresh(); const timer = window.setInterval(() => { void refresh(); }, 4_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [animationHandoff]);

  const sources = mode === 'workspace' ? (workspace ? toSources(workspace) : []) : uploadedScenes;

  const selectWorkspace = async (nextId: string) => {
    setWorkspaceId(nextId); setWorkspace(null); setPlan(null); setError('');
    if (!nextId) return;
    try {
      const next = await getStoryboardWorkspace(nextId);
      setWorkspace(next);
      setScenario((current) => current.trim() ? current : next.script);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'بازکردن استوری‌برد انجام نشد.'); }
  };
  const chooseFiles = (next: FileList | null) => {
    const selected = Array.from(next || []).filter((file) => ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)).slice(0, 24);
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    const scenes = uploadSources(selected);
    urlsRef.current = scenes.map((scene) => scene.imageUrl).filter((url): url is string => Boolean(url));
    setUploadedScenes(scenes); setUploadedFiles(Object.fromEntries(scenes.map((scene, index) => [scene.id, selected[index]]))); setPlan(null); setError('');
  };
  const sourceFile = async (source: DirectSceneSource): Promise<File> => {
    const existing = uploadedFiles[source.id];
    if (existing) return existing;
    if (!source.imageUrl) throw new Error(`تصویر مرجع «${source.title}» آماده نیست.`);
    const protectedUrl = await fetchProtectedImageBlobUrl(source.imageUrl);
    try {
      const response = await fetch(protectedUrl);
      if (!response.ok) throw new Error(`دریافت تصویر «${source.title}» انجام نشد.`);
      const blob = await response.blob();
      return new File([blob], `${source.id}.png`, { type: blob.type || 'image/png' });
    } finally { if (protectedUrl.startsWith('blob:')) URL.revokeObjectURL(protectedUrl); }
  };
  const startRendering = async () => {
    if (!plan || rendering) return;
    setRendering(true); setError(''); setFinalVideo(null);
    try {
      const options = await videoGenerationService.getVideoOptions();
      const capability = options.capabilities?.['video.image_to_video'];
      if (!capability) throw new Error('ساخت ویدیو از تصویر در حال حاضر در دسترس نیست.');
      const profile = options.promptProfiles?.find((item) => item.profileKey === 'cinematic') || options.promptProfiles?.[0];
      if (!profile) throw new Error('سبک ساخت ویدیو آماده نیست.');
      const resolution = capability.allowedResolutions[0] || capability.allowedQualities[0] || '480p';
      const aspectRatio = workspace?.aspectRatio || '16:9';
      const ids: string[] = [];
      if (animationHandoff) throw new Error('ویدیوی این پروژه در صف Worker است؛ وضعیت را از همین صفحه دنبال کن.');
      for (let index = 0; index < plan.scenes.length; index += 1) {
        const item = plan.scenes[index];
        const source = sources.find((scene) => scene.id === item.sourceSceneId);
        if (!source) throw new Error(`مرجع صحنه ${index + 1} پیدا نشد.`);
        setRenderState(`در حال آماده‌سازی صحنه ${(index + 1).toLocaleString('fa-IR')} از ${plan.scenes.length.toLocaleString('fa-IR')}…`);
        const media: VideoInputMedia = await videoGenerationService.uploadInputMedia(await sourceFile(source));
        const submitted = await videoGenerationService.createVideoGeneration({ mode: 'image-to-video', styleKey: profile.profileKey, mediaId: media.mediaId, prompt: item.videoPrompt, aspectRatio, duration: String(item.durationSeconds), resolution, generateAudio: capability.supportsAudio === true }, `direct-scene-${crypto.randomUUID()}`);
        ids.push(submitted.generationId);
      }
      setRenderState('همهٔ صحنه‌ها در صف ساخت هستند…');
      const settled = await Promise.all(ids.map(waitForSceneVideo));
      if (settled.some((item) => item.status !== 'succeeded')) throw new Error('ساخت حداقل یکی از صحنه‌ها کامل نشد؛ فقط صحنه‌های موفق هزینه دارند.');
      setRenderState('در حال اتصال حرفه‌ای صحنه‌ها…');
      const result = await composeDirectSceneVideo(ids);
      setFinalVideo(result); setRenderState('ویدیوی نهایی آماده است.');
    } catch (reason) { if (animationHandoff) void transitionAnimationProject(animationHandoff.animationProjectId, 'failed').catch(() => {}); setError(reason instanceof Error ? reason.message : 'ساخت ویدیو انجام نشد.'); setRenderState(''); }
    finally { setRendering(false); }
  };
  const makePlan = async () => {
    if (scenario.trim().length < 3) { setError('سناریو را کمی کامل‌تر بنویس.'); return; }
    if (!sources.length) { setError(mode === 'workspace' ? 'یک استوری‌برد انتخاب کن.' : 'تصاویر استوری‌برد را اضافه کن.'); return; }
    setLoadingPlan(true); setError('');
    try {
      const next = await createDirectSceneVideoPlan({
        workspaceId: mode === 'workspace' ? workspaceId : undefined,
        title: workspace?.title || 'ویدیوی استوری‌برد', scenario,
        aspectRatio: workspace?.aspectRatio || '16:9', scenes: mode === 'workspace' ? undefined : sources
      });
      setPlan(next);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'برنامهٔ ساخت ویدیو آماده نشد.'); }
    finally { setLoadingPlan(false); }
  };

  if (animationHandoff) return <main className="direct-scene-video" dir="rtl"><header className="direct-scene-video__header"><Button type="button" variant="ghost" onClick={onBack}>بازگشت</Button><div><span>ویدیوی انیمیشن</span><h1>ساخت ویدیوی واقعی</h1></div></header><section className="direct-scene-video__review" aria-live="polite"><div className="direct-scene-video__intro"><span>وضعیت پروژه</span><h2>{animationJob?.status === 'completed' ? 'ویدیوی تو آماده است' : animationJob?.status === 'failed' ? 'یک مرحله نیاز به تلاش دوباره دارد' : 'داریم ویدیو را می‌سازیم'}</h2><p>{animationJob?.status === 'processing' ? 'ساخت صحنه‌ها و سپس مونتاژ در حال انجام است.' : 'آماده‌سازی پروژه ← ساخت صحنه‌ها ← مونتاژ ← آماده‌سازی خروجی'}</p></div>{animationJob?.scenes?.map((scene) => <article className="direct-scene-video__audio" key={scene.sourceSceneId}><div><strong>صحنه {scene.order.toLocaleString('fa-IR')} · {scene.durationSeconds.toLocaleString('fa-IR')} ثانیه</strong><p>{scene.status === 'failed' ? scene.errorMessage || 'ساخت این صحنه انجام نشد.' : scene.status}</p></div>{scene.status === 'failed' ? <Button type="button" onClick={() => void retryAnimationVideoScene(animationHandoff.animationProjectId, scene.sourceSceneId).then(() => setError('')).catch((reason) => setError(reason instanceof Error ? reason.message : 'تلاش دوباره انجام نشد.'))}>دوباره بساز</Button> : null}</article>)}{error ? <InlineMessage variant="error" text={error} /> : null}{animationJob?.finalContentUrl ? <section className="direct-scene-video__final"><video controls src={animationJob.finalContentUrl} /><a href={`${animationJob.finalContentUrl}?download=1`}>دانلود ویدیوی نهایی</a></section> : null}</section></main>;

  return <main className="direct-scene-video" dir="rtl">
    <header className="direct-scene-video__header">
      <Button type="button" variant="ghost" iconOnly onClick={onBack} aria-label="بازگشت به استودیو" startIcon={<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>} />
      <div><span>استودیوی ویدیو</span><h1>تبدیل مستقیم صحنه به ویدیو</h1></div><i aria-hidden="true"><Icon name="sparkle" size="1.2em" /></i>
    </header>

    {!plan ? <section className="direct-scene-video__setup" aria-labelledby="direct-scene-title">
      <div className="direct-scene-video__intro"><span>مرحله ۱ از ۲</span><h2 id="direct-scene-title">استوری‌برد و سناریو را بده</h2><p>دانوآ صحنه‌ها، ریتم، دوربین، اتصال‌ها و صدا را خودش برنامه‌ریزی می‌کند.</p></div>
      <div className="direct-scene-video__mode" role="tablist" aria-label="روش ورود استوری‌برد">
        <button type="button" role="tab" aria-selected={mode === 'workspace'} onClick={() => { setMode('workspace'); setPlan(null); setError(''); }}>استوری‌بردهای دانوآ</button>
        <button type="button" role="tab" aria-selected={mode === 'upload'} onClick={() => { setMode('upload'); setPlan(null); setError(''); }}>آپلود تصاویر استوری‌برد</button>
      </div>
      <div className="direct-scene-video__panel">
        {mode === 'workspace' ? <label className="direct-scene-video__field"><span>استوری‌برد</span><select value={workspaceId} onChange={(event) => void selectWorkspace(event.target.value)} disabled={loadingLibrary}><option value="">{loadingLibrary ? 'در حال دریافت استوری‌بردها…' : 'یک استوری‌برد انتخاب کن'}</option>{workspaces.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><small>{workspace ? `${sources.length.toLocaleString('fa-IR')} صحنه برای ساخت پیدا شد.` : 'استوری‌بردی را که قاب‌های نهایی‌اش آماده است انتخاب کن.'}</small></label> : <div className="direct-scene-video__upload"><input id={fileInputId} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => chooseFiles(event.target.files)} /><label htmlFor={fileInputId}><Icon name="upload" size="1.2em" aria-hidden="true" /><strong>تصاویر استوری‌برد را انتخاب کن</strong><small>JPG، PNG یا WEBP · حداکثر ۲۴ قاب</small></label>{sources.length ? <div className="direct-scene-video__frames">{sources.map((scene) => <figure key={scene.id}>{scene.imageUrl ? <img src={scene.imageUrl} alt={`قاب ${scene.number}`} /> : null}<figcaption>صحنه {scene.number.toLocaleString('fa-IR')}</figcaption></figure>)}</div> : null}</div>}
        <label className="direct-scene-video__field"><span>سناریو</span><textarea value={scenario} onChange={(event) => { setScenario(event.target.value.slice(0, 12000)); setPlan(null); }} placeholder="داستان یا سناریوی کامل ویدیو را این‌جا وارد کن…" rows={8} /><small>{scenario.length.toLocaleString('fa-IR')} از ۱۲٬۰۰۰ کاراکتر</small></label>
        {error ? <InlineMessage variant="error" text={error} /> : null}
        <div className="direct-scene-video__actions"><Button type="button" variant="secondary" onClick={onBack}>بازگشت</Button><Button type="button" onClick={() => void makePlan()} loading={loadingPlan} disabled={loadingPlan || !sources.length || scenario.trim().length < 3} startIcon={<Icon name="sparkle" size="1em" aria-hidden="true" />}>برنامه‌ریزی هوشمند ویدیو</Button></div>
      </div>
    </section> : <section className="direct-scene-video__review" aria-labelledby="direct-scene-review-title"><div className="direct-scene-video__intro"><span>مرحله ۲ از ۲ · آمادهٔ تأیید</span><h2 id="direct-scene-review-title">برنامهٔ ساخت «{plan.title}»</h2><p>{plan.summary}</p></div><article className="direct-scene-video__audio"><Icon name="sparkle" size="1.1em" aria-hidden="true" /><div><strong>صدا و ریتم</strong><p>{plan.audioDirection}</p></div></article><ol>{plan.scenes.map((item, index) => { const source = sources.find((scene) => scene.id === item.sourceSceneId); return <li key={item.sourceSceneId}><span>{(index + 1).toLocaleString('fa-IR')}</span><div>{source?.imageUrl ? <img src={source.imageUrl} alt={`قاب ${index + 1}`} /> : null}<strong>{source?.title || `صحنه ${index + 1}`}</strong><p>{item.action}</p><dl><div><dt>دوربین</dt><dd>{item.camera}</dd></div><div><dt>اتصال</dt><dd>{item.transition}</dd></div><div><dt>صدا</dt><dd>{item.audioDirection}</dd></div></dl><small>{item.durationSeconds.toLocaleString('fa-IR')} ثانیه</small></div></li>; })}</ol><div className="direct-scene-video__actions"><Button type="button" variant="secondary" onClick={() => setPlan(null)} disabled={rendering}>تحلیل دوباره</Button><Button type="button" onClick={() => void startRendering()} loading={rendering} disabled={rendering || Boolean(finalVideo)} startIcon={<Icon name="studio-image" size="1em" aria-hidden="true" />}>{finalVideo ? 'ویدیو آماده است' : 'تأیید و شروع ساخت'}</Button></div>{renderState ? <p role="status">{renderState}</p> : null}{finalVideo ? <section className="direct-scene-video__final"><video controls src={finalVideo.contentUrl} /><a href={finalVideo.downloadUrl}>دانلود ویدیوی نهایی</a></section> : null}{error ? <InlineMessage variant="error" text={error} /> : null}</section>}
  </main>;
}
