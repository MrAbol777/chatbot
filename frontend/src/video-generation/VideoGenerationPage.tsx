import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, InlineMessage } from '../design-system/components';
import { formatDecimalFa, multiplyDecimal } from '../noa/decimal';
import { ACTIVE_GENERATION_HINT_KEY, POLL_DELAYS_MS } from './video-generation.constants';
import VideoGenerationForm from './VideoGenerationForm';
import VideoGenerationGallery from './VideoGenerationGallery';
import VideoGenerationStatus from './VideoGenerationStatus';
import VideoStyleSelection from './VideoStyleSelection';
import { videoGenerationService } from './video-generation.service';
import type { VideoCapabilityOption, VideoGenerationDetail, VideoGenerationListItem, VideoInputMedia, VideoPromptProfile } from './video-generation.types';
import { formatElapsed, isTerminalVideoStatus, newIdempotencyKey } from './video-generation.utils';
import './VideoGenerationPage.css';

type Props = { onBack: () => void; localDemoEnabled?: boolean };
type CreateStep = 'style' | 'form' | 'review';
const ALLOWED_DURATIONS = Array.from({ length: 15 }, (_, index) => String(index + 1));
const ALLOWED_RATIOS = ['9:16', '16:9', '1:1'];
const ALLOWED_RESOLUTIONS = ['480p'];
const LOCAL_DEMO_CAPABILITY: VideoCapabilityOption = Object.freeze({ allowedAspectRatios: ['9:16', '16:9', '1:1'], allowedDurations: ALLOWED_DURATIONS, allowedQualities: [], allowedResolutions: ALLOWED_RESOLUTIONS, maxPromptLength: 2000, supportsNegativePrompt: false, supportsAudio: false });
const safelyReadHint = () => { try { return localStorage.getItem(ACTIVE_GENERATION_HINT_KEY) || ''; } catch { return ''; } };
const saveHint = (id?: string) => { try { if (id) localStorage.setItem(ACTIVE_GENERATION_HINT_KEY, id); else localStorage.removeItem(ACTIVE_GENERATION_HINT_KEY); } catch { /* Optional convenience only. */ } };

export default function VideoGenerationPage({ onBack, localDemoEnabled = import.meta.env.MODE === 'development' }: Props) {
  const [featureEnabled, setFeatureEnabled] = useState(true);
  const [activeTab, setActiveTab] = useState<'create' | 'history'>('create');
  const [createStep, setCreateStep] = useState<CreateStep>('style');
  const [capability, setCapability] = useState<VideoCapabilityOption | null>(null);
  const [profiles, setProfiles] = useState<VideoPromptProfile[]>([]);
  const [styleKey, setStyleKey] = useState('');
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState('');
  const [unitPriceNoa, setUnitPriceNoa] = useState('');
  const [localDemoMode, setLocalDemoMode] = useState(false);
  const [demoComplete, setDemoComplete] = useState(false);
  const [history, setHistory] = useState<VideoGenerationListItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [active, setActive] = useState<VideoGenerationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('');
  const [duration, setDuration] = useState('');
  const [resolution, setResolution] = useState('');
  const [media, setMedia] = useState<VideoInputMedia | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState('');
  const [mediaFilename, setMediaFilename] = useState('');
  const [mediaUploading, setMediaUploading] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKey = useRef(newIdempotencyKey());
  const activeIdRef = useRef<string | null>(null);
  const selectionAbortRef = useRef<AbortController | null>(null);
  const mediaPreviewUrlRef = useRef('');
  const mediaUploadSequenceRef = useRef(0);
  const submitInFlightRef = useRef(false);
  const lastSubmitAtRef = useRef(0);
  const selectedProfile = useMemo(() => profiles.find((profile) => profile.profileKey === styleKey) || null, [profiles, styleKey]);
  const replaceMediaPreview = useCallback((file?: File) => {
    if (mediaPreviewUrlRef.current && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(mediaPreviewUrlRef.current);
    const nextUrl = file && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : '';
    mediaPreviewUrlRef.current = nextUrl;
    setMediaPreviewUrl(nextUrl);
    setMediaFilename(file?.name || '');
  }, []);

  const loadOptions = useCallback(async () => {
    setOptionsLoading(true); setOptionsError('');
    try {
      const data = await videoGenerationService.getVideoOptions();
      setUnitPriceNoa(data.pricing?.unitPriceNoa || '');
      const routeCapability = data.capabilities?.['video.image_to_video'];
      const safeCapability: VideoCapabilityOption | null = routeCapability ? {
        ...routeCapability,
        allowedDurations: routeCapability.allowedDurations.map(String).filter((value) => ALLOWED_DURATIONS.includes(value)),
        allowedAspectRatios: routeCapability.allowedAspectRatios.filter((value) => ALLOWED_RATIOS.includes(value)),
        allowedResolutions: routeCapability.allowedResolutions.filter((value) => ALLOWED_RESOLUTIONS.includes(value))
      } : null;
      const publicProfiles = (data.promptProfiles || []).filter((profile) => ['cinematic', 'animation'].includes(profile.profileKey));
      const routeReady = Boolean(data.enabled !== false && safeCapability && safeCapability.allowedDurations.length && safeCapability.allowedAspectRatios.length && safeCapability.allowedResolutions.length);
      const profilesReady = publicProfiles.length === 2;
      const demoReady = Boolean(import.meta.env.MODE !== 'production' && localDemoEnabled && profilesReady && !routeReady);
      const effectiveCapability = routeReady ? safeCapability : demoReady ? LOCAL_DEMO_CAPABILITY : null;
      setFeatureEnabled(profilesReady); setCapability(effectiveCapability); setProfiles(publicProfiles); setLocalDemoMode(demoReady);
      if (effectiveCapability) {
        setDuration((value) => effectiveCapability.allowedDurations.includes(value) ? value : effectiveCapability.allowedDurations.includes('5') ? '5' : effectiveCapability.allowedDurations[0] || '');
        setAspectRatio((value) => effectiveCapability.allowedAspectRatios.includes(value) ? value : effectiveCapability.allowedAspectRatios.includes('9:16') ? '9:16' : effectiveCapability.allowedAspectRatios[0] || '');
        setResolution((value) => effectiveCapability.allowedResolutions.includes(value) ? value : effectiveCapability.allowedResolutions.includes('480p') ? '480p' : effectiveCapability.allowedResolutions[0] || '');
      }
    } catch (error) { setLocalDemoMode(false); setOptionsError(error instanceof Error ? error.message : 'استودیو آماده نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.'); }
    finally { setOptionsLoading(false); }
  }, [localDemoEnabled]);
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true); setHistoryError('');
    try { const data = await videoGenerationService.listVideoGenerations(); setHistory(data.items); return data.items; }
    catch (error) { setHistoryError(error instanceof Error ? error.message : 'ویدیوها دریافت نشدند. اینترنت را بررسی کنید و دوباره تلاش کنید.'); return []; }
    finally { setHistoryLoading(false); }
  }, []);
  const selectGeneration = useCallback(async (id: string) => {
    selectionAbortRef.current?.abort(); const controller = new AbortController(); selectionAbortRef.current = controller;
    activeIdRef.current = id; setDetailLoading(true); setDetailError('');
    try { const detail = await videoGenerationService.getVideoGeneration(id, controller.signal); if (activeIdRef.current === id) { setActive(detail); saveHint(isTerminalVideoStatus(detail.status) ? undefined : id); } }
    catch (error) { if (activeIdRef.current === id && !(error instanceof DOMException && error.name === 'AbortError')) { setDetailError(error instanceof Error ? error.message : 'جزئیات ویدیو دریافت نشد. دوباره تلاش کنید.'); if ((error as { code?: string }).code === 'VIDEO_GENERATION_NOT_FOUND') saveHint(); } }
    finally { if (selectionAbortRef.current === controller) selectionAbortRef.current = null; if (activeIdRef.current === id) setDetailLoading(false); }
  }, []);

  useEffect(() => () => {
    selectionAbortRef.current?.abort();
    if (mediaPreviewUrlRef.current && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(mediaPreviewUrlRef.current);
  }, []);
  useEffect(() => { void loadOptions(); void loadHistory().then((items) => { const hint = safelyReadHint(); const resume = hint && items.some((item) => item.id === hint) ? hint : items.find((item) => !isTerminalVideoStatus(item.status))?.id; if (hint && !resume) saveHint(); if (resume) void selectGeneration(resume); }); }, [loadHistory, loadOptions, selectGeneration]);
  useEffect(() => {
    if (!active || isTerminalVideoStatus(active.status)) return;
    let cancelled = false; let timer = 0; let attempt = 0; let requestInFlight = false; const controller = new AbortController();
    const poll = async () => { if (cancelled || requestInFlight) return; requestInFlight = true; try { const detail = await videoGenerationService.getVideoGeneration(active.id, controller.signal); if (cancelled) return; setActive(detail); setHistory((items) => items.map((item) => item.id === detail.id ? { ...item, ...detail } : item)); if (isTerminalVideoStatus(detail.status)) { saveHint(); window.dispatchEvent(new Event('noa:wallet-changed')); void loadOptions(); return; } attempt += 1; timer = window.setTimeout(() => void poll(), POLL_DELAYS_MS[Math.min(attempt, POLL_DELAYS_MS.length - 1)]); } catch (error) { if (!cancelled && !(error instanceof DOMException && error.name === 'AbortError')) { attempt += 1; timer = window.setTimeout(() => void poll(), POLL_DELAYS_MS[Math.min(attempt, POLL_DELAYS_MS.length - 1)]); } } finally { requestInFlight = false; } };
    void poll(); return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [active?.id, active?.status, loadOptions]);

  const handleSubmit = async () => {
    const maxPromptLength = capability?.maxPromptLength ?? 2000;
    if (!capability || !selectedProfile || !media || submitting || submitInFlightRef.current || (lastSubmitAtRef.current && Date.now() - lastSubmitAtRef.current < 500) || prompt.trim().length < 3 || prompt.length > maxPromptLength) return;
    if (localDemoMode) { setDemoComplete(true); return; }
    lastSubmitAtRef.current = Date.now() || 1; submitInFlightRef.current = true; setSubmitting(true); setDetailError('');
    try {
      const response = await videoGenerationService.createVideoGeneration({ mode: 'image_to_video', styleKey:selectedProfile.profileKey, mediaId:media.mediaId, prompt:prompt.trim(), duration, resolution, aspectRatio }, idempotencyKey.current);
      window.dispatchEvent(new Event('noa:wallet-changed'));
      idempotencyKey.current = newIdempotencyKey(); saveHint(response.generationId); await loadHistory(); await selectGeneration(response.generationId); setActiveTab('history'); setCreateStep('style');
    } catch (error) { setDetailError(error instanceof Error ? error.message : 'درخواست ثبت نشد. تنظیمات و اینترنت را بررسی کنید و دوباره تلاش کنید.'); }
    finally { submitInFlightRef.current = false; setSubmitting(false); }
  };
  const handleMediaFile = async (file: File) => {
    const sequence = ++mediaUploadSequenceRef.current;
    replaceMediaPreview(file); setMediaUploading(true); setMediaError(''); setMedia(null); setDemoComplete(false); idempotencyKey.current = newIdempotencyKey();
    try {
      const nextMedia = localDemoMode
        ? (() => { if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size <= 0 || file.size > 5 * 1024 * 1024) throw new Error('برای تست محلی، تصویر JPEG، PNG یا WebP تا سقف ۵ مگابایت انتخاب کنید.'); return { mediaId: 'local-demo-input', mimeType: file.type, sizeBytes: file.size }; })()
        : await videoGenerationService.uploadInputMedia(file);
      if (sequence === mediaUploadSequenceRef.current) setMedia(nextMedia);
    } catch (error) {
      if (sequence === mediaUploadSequenceRef.current) { replaceMediaPreview(); setMediaError(error instanceof Error ? error.message : 'بارگذاری امن تصویر ناموفق بود.'); }
    } finally { if (sequence === mediaUploadSequenceRef.current) setMediaUploading(false); }
  };
  const handleRemoveMedia = () => {
    mediaUploadSequenceRef.current += 1; replaceMediaPreview(); setMedia(null); setMediaError(''); setMediaUploading(false); setDemoComplete(false); idempotencyKey.current = newIdempotencyKey();
  };
  const change = <T,>(setter: (value: T) => void) => (value: T) => { idempotencyKey.current = newIdempotencyKey(); setDemoComplete(false); setter(value); };

  return <main className="video-generation-page" dir="rtl"><div className="video-generation-page__shell">
    <header className="video-generation-page__header"><div className="video-generation-page__brand"><span className="video-brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2Zm7 13 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" /></svg></span><span><h1>استودیوی ویدیو</h1><small>عکست را با حرکت حرفه‌ای زنده کن</small></span></div><Button type="button" variant="ghost" className="video-generation-page__back" onClick={onBack}>بازگشت به استودیو</Button></header>
    <nav className="video-generation-tabs" role="tablist" aria-label="بخش‌های استودیوی ویدیو"><button type="button" role="tab" aria-selected={activeTab === 'create'} className={activeTab === 'create' ? 'is-active' : ''} onClick={() => setActiveTab('create')}>ساخت ویدیو</button><button type="button" role="tab" aria-selected={activeTab === 'history'} className={activeTab === 'history' ? 'is-active' : ''} onClick={() => setActiveTab('history')}>ویدیوهای من</button></nav>
    <div className="video-generation-workspace">{detailError ? <InlineMessage variant="error" text={detailError} /> : null}{localDemoMode ? <InlineMessage variant={demoComplete ? 'success' : 'help'} text={demoComplete ? 'تست محلی با موفقیت کامل شد؛ هیچ درخواست خارجی ارسال نشد.' : 'حالت تست محلی فعال است؛ فرم و بازبینی قابل آزمایش‌اند و هیچ اعتبار یا API خارجی مصرف نمی‌شود.'} /> : null}
      {activeTab === 'create' ? <>
        {optionsLoading ? <p className="video-loading" role="status">در حال آماده‌سازی استودیو…</p> : optionsError ? <div className="video-form-message"><InlineMessage variant="error" text={optionsError} /><Button variant="secondary" onClick={() => void loadOptions()}>دریافت دوباره</Button></div> : !featureEnabled ? <InlineMessage variant="help" text="پروفایل‌های عمومی ساخت ویدیو هنوز کامل نیستند." /> : createStep === 'style' ? <VideoStyleSelection profiles={profiles} selectedKey={styleKey} onSelect={change(setStyleKey)} onContinue={() => setCreateStep('form')} /> : createStep === 'form' && selectedProfile ? <VideoGenerationForm capability={capability} profile={selectedProfile} featureEnabled={featureEnabled} loading={false} error="" onRetry={() => void loadOptions()} prompt={prompt} setPrompt={change(setPrompt)} aspectRatio={aspectRatio} setAspectRatio={change(setAspectRatio)} duration={duration} setDuration={change(setDuration)} resolution={resolution} setResolution={change(setResolution)} media={media} mediaPreviewUrl={mediaPreviewUrl} mediaFilename={mediaFilename} onMediaFile={(file) => void handleMediaFile(file)} onRemoveMedia={handleRemoveMedia} mediaUploading={mediaUploading} mediaError={mediaError} submitting={submitting} onBack={() => setCreateStep('style')} onReview={() => setCreateStep('review')} /> : selectedProfile && media ? <section className="video-review" aria-labelledby="video-review-title"><span>مرحله ۳ از ۳</span><h2 id="video-review-title">بازبینی درخواست</h2><dl><div><dt>سبک</dt><dd>{selectedProfile.displayName}</dd></div><div><dt>حرکت</dt><dd>{prompt}</dd></div><div><dt>خروجی</dt><dd>{duration} ثانیه · {resolution} · {aspectRatio} · بدون صدا</dd></div><div><dt>هزینه</dt><dd>{localDemoMode ? 'بدون هزینه در تست محلی' : unitPriceNoa ? `${formatDecimalFa(multiplyDecimal(unitPriceNoa, duration))} نوآ` : 'در حال دریافت قیمت'}</dd></div><div><dt>تصویر</dt><dd>{mediaFilename || (localDemoMode ? 'فایل محلی آزمایشی آماده است' : 'فایل خصوصی آماده است')}</dd></div></dl><p>{localDemoMode ? 'این بازبینی فقط برای تست رابط کاربری است و به Provider ارسال نمی‌شود.' : `قیمت هر ثانیه ${formatDecimalFa(unitPriceNoa)} نوآ است و هنگام ثبت از تنظیم زندهٔ پایگاه داده محاسبه می‌شود.`}</p><div><Button variant="secondary" onClick={() => { setDemoComplete(false); setCreateStep('form'); }} disabled={submitting}>ویرایش</Button><Button onClick={() => void handleSubmit()} loading={submitting} disabled={submitting || demoComplete}>{localDemoMode ? demoComplete ? 'تست تکمیل شد' : 'تکمیل تست محلی' : 'ثبت درخواست ساخت ویدیو'}</Button></div></section> : null}
        {active && !isTerminalVideoStatus(active.status) ? <section className="video-active-status" aria-live="polite"><h2>آخرین درخواست</h2><VideoGenerationStatus status={active.status} live /><span className="video-active-status__elapsed">زمان سپری‌شده: {formatElapsed(active.created_at)}</span>{detailLoading ? <span className="video-loading">در حال دریافت جزئیات…</span> : null}</section> : null}
      </> : <VideoGenerationGallery active={active} error={historyError} items={history} loading={historyLoading} onRetry={() => void loadHistory()} onSelect={(id) => void selectGeneration(id)} selectedId={active?.id} />}
    </div>
  </div></main>;
}
