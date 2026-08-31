import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button, InlineMessage } from '../design-system/components';
import Icon from '../components/Icon';
import { formatDecimalFa, multiplyDecimal } from '../noa/decimal';
import { getInsufficientBalanceDetails, isInsufficientBalanceError, type InsufficientBalanceDetails } from '../noa/insufficientBalance';
import { ACTIVE_GENERATION_HINT_KEY, POLL_DELAYS_MS } from './video-generation.constants';
import VideoGenerationForm from './VideoGenerationForm';
import VideoGenerationGallery from './VideoGenerationGallery';
import VideoGenerationProgressModal from './VideoGenerationProgressModal';
import VideoGenerationStatus from './VideoGenerationStatus';
import VideoStyleSelection from './VideoStyleSelection';
import { videoGenerationService } from './video-generation.service';
import type { VideoCapabilityOption, VideoGenerationDetail, VideoGenerationListItem, VideoInputMedia, VideoPromptProfile } from './video-generation.types';
import { formatElapsed, isTerminalVideoStatus, newIdempotencyKey } from './video-generation.utils';
import './VideoGenerationPage.css';

type Props = {
  onBack: () => void;
  localDemoEnabled?: boolean;
  onInsufficientBalance?: (details: InsufficientBalanceDetails) => void;
};
type CreateStep = 'style' | 'form' | 'review';
const ALLOWED_DURATIONS = Array.from({ length: 15 }, (_, index) => String(index + 1));
const ALLOWED_RATIOS = ['9:16', '16:9', '1:1'];
const ALLOWED_RESOLUTIONS = ['480p'];
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const LOCAL_DEMO_CAPABILITY: VideoCapabilityOption = Object.freeze({ allowedAspectRatios: ['9:16', '16:9', '1:1'], allowedDurations: ALLOWED_DURATIONS, allowedQualities: [], allowedResolutions: ALLOWED_RESOLUTIONS, maxPromptLength: 4000, supportsNegativePrompt: false, supportsAudio: false });
const sanitizeCapability = (routeCapability?: VideoCapabilityOption): VideoCapabilityOption | null => routeCapability ? {
  ...routeCapability,
  allowedDurations: routeCapability.allowedDurations.map(String).filter((value) => ALLOWED_DURATIONS.includes(value)),
  allowedAspectRatios: routeCapability.allowedAspectRatios.filter((value) => ALLOWED_RATIOS.includes(value)),
  allowedResolutions: routeCapability.allowedResolutions.filter((value) => ALLOWED_RESOLUTIONS.includes(value))
} : null;
const capabilityReady = (capability: VideoCapabilityOption | null, unavailable: boolean, enabled: boolean) => Boolean(enabled && !unavailable && capability?.allowedDurations.length && capability.allowedAspectRatios.length && capability.allowedResolutions.length);
const safelyReadHint = () => { try { return localStorage.getItem(ACTIVE_GENERATION_HINT_KEY) || ''; } catch { return ''; } };
const saveHint = (id?: string) => { try { if (id) localStorage.setItem(ACTIVE_GENERATION_HINT_KEY, id); else localStorage.removeItem(ACTIVE_GENERATION_HINT_KEY); } catch { /* Optional convenience only. */ } };
const VIDEO_STUDIO_SESSION_KEY = 'danoa:video-studio-state';
type VideoStudioSessionState = {
  createStep: CreateStep;
  styleKey: string;
  prompt: string;
  aspectRatio: string;
  duration: string;
  resolution: string;
  inputMedia: VideoInputMedia | null;
  inputMediaFileName: string;
};
const readVideoStudioSession = (): VideoStudioSessionState => {
  const fallback: VideoStudioSessionState = { createStep: 'style', styleKey: '', prompt: '', aspectRatio: '', duration: '', resolution: '', inputMedia: null, inputMediaFileName: '' };
  try {
    const raw = sessionStorage.getItem(VIDEO_STUDIO_SESSION_KEY);
    if (!raw) return fallback;
    const value = JSON.parse(raw) as Partial<VideoStudioSessionState>;
    const inputMedia = value.inputMedia && typeof value.inputMedia.mediaId === 'string' && typeof value.inputMedia.mimeType === 'string' && typeof value.inputMedia.sizeBytes === 'number'
      ? value.inputMedia
      : null;
    return {
      createStep: value.createStep === 'form' || value.createStep === 'review' ? value.createStep : 'style',
      styleKey: typeof value.styleKey === 'string' ? value.styleKey : '',
      prompt: typeof value.prompt === 'string' ? value.prompt.slice(0, 2000) : '',
      aspectRatio: typeof value.aspectRatio === 'string' ? value.aspectRatio : '',
      duration: typeof value.duration === 'string' ? value.duration : '',
      resolution: typeof value.resolution === 'string' ? value.resolution : '',
      inputMedia,
      inputMediaFileName: typeof value.inputMediaFileName === 'string' ? value.inputMediaFileName : ''
    };
  } catch {
    return fallback;
  }
};
const clearVideoStudioSession = () => { try { sessionStorage.removeItem(VIDEO_STUDIO_SESSION_KEY); } catch { /* Best effort only. */ } };

export default function VideoGenerationPage({ onBack, localDemoEnabled = import.meta.env.MODE === 'development', onInsufficientBalance }: Props) {
  const [savedSession] = useState(readVideoStudioSession);
  const [featureEnabled, setFeatureEnabled] = useState(true);
  const [activeTab, setActiveTab] = useState<'create' | 'history'>('create');
  const [createStep, setCreateStep] = useState<CreateStep>(savedSession.createStep);
  const [capability, setCapability] = useState<VideoCapabilityOption | null>(null);
  const [imageCapability, setImageCapability] = useState<VideoCapabilityOption | null>(null);
  const [profiles, setProfiles] = useState<VideoPromptProfile[]>([]);
  const [styleKey, setStyleKey] = useState(savedSession.styleKey);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState('');
  const [routeUnavailable, setRouteUnavailable] = useState(false);
  const [unitPriceNoa, setUnitPriceNoa] = useState('');
  const [localDemoMode, setLocalDemoMode] = useState(false);
  const [demoComplete, setDemoComplete] = useState(false);
  const [history, setHistory] = useState<VideoGenerationListItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [active, setActive] = useState<VideoGenerationDetail | null>(null);
  const [progressModalOpen, setProgressModalOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [prompt, setPrompt] = useState(savedSession.prompt);
  const [aspectRatio, setAspectRatio] = useState(savedSession.aspectRatio);
  const [duration, setDuration] = useState(savedSession.duration);
  const [resolution, setResolution] = useState(savedSession.resolution);
  const [inputMedia, setInputMedia] = useState<VideoInputMedia | null>(savedSession.inputMedia);
  const [inputMediaFileName, setInputMediaFileName] = useState(savedSession.inputMediaFileName);
  const [inputMediaPreviewUrl, setInputMediaPreviewUrl] = useState('');
  const [mediaUploading, setMediaUploading] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKey = useRef(newIdempotencyKey());
  const activeIdRef = useRef<string | null>(null);
  const selectionAbortRef = useRef<AbortController | null>(null);
  const mediaUploadAbortRef = useRef<AbortController | null>(null);
  const mediaPreviewUrlRef = useRef('');
  const submitInFlightRef = useRef(false);
  const lastSubmitAtRef = useRef(0);
  const selectedProfile = useMemo(() => profiles.find((profile) => profile.profileKey === styleKey) || null, [profiles, styleKey]);
  const activeCapability = inputMedia && imageCapability ? imageCapability : capability;

  useEffect(() => {
    try {
      sessionStorage.setItem(VIDEO_STUDIO_SESSION_KEY, JSON.stringify({
        createStep,
        styleKey,
        prompt,
        aspectRatio,
        duration,
        resolution,
        inputMedia,
        inputMediaFileName
      } satisfies VideoStudioSessionState));
    } catch { /* Best effort only. */ }
  }, [createStep, styleKey, prompt, aspectRatio, duration, resolution, inputMedia, inputMediaFileName]);

  const loadOptions = useCallback(async () => {
    setOptionsLoading(true); setOptionsError('');
    try {
      const data = await videoGenerationService.getVideoOptions();
      setUnitPriceNoa(data.pricing?.unitPriceNoa || '');
      const safeCapability = sanitizeCapability(data.capabilities?.['video.text_to_video']);
      const safeImageCapability = sanitizeCapability(data.capabilities?.['video.image_to_video']);
      const publicProfiles = (data.promptProfiles || []).filter((profile) => ['cinematic', 'animation'].includes(profile.profileKey));
      const routeIsUnavailable = data.readiness?.['video.text_to_video']?.available === false;
      const imageRouteIsUnavailable = data.readiness?.['video.image_to_video']?.available === false;
      const routeReady = capabilityReady(safeCapability, routeIsUnavailable, data.enabled !== false);
      const imageRouteReady = capabilityReady(safeImageCapability, imageRouteIsUnavailable, data.enabled !== false);
      const profilesReady = publicProfiles.length === 2;
      const demoReady = Boolean(import.meta.env.MODE !== 'production' && localDemoEnabled && profilesReady && !routeReady);
      const effectiveCapability = routeReady ? safeCapability : demoReady ? LOCAL_DEMO_CAPABILITY : null;
      setRouteUnavailable(Boolean(routeIsUnavailable && !demoReady));
      setFeatureEnabled(profilesReady); setCapability(effectiveCapability); setImageCapability(imageRouteReady ? safeImageCapability : demoReady ? LOCAL_DEMO_CAPABILITY : null); setProfiles(publicProfiles); setLocalDemoMode(demoReady);
      if (styleKey && !publicProfiles.some((profile) => profile.profileKey === styleKey)) setCreateStep('style');
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

  const releaseMediaPreview = useCallback(() => {
    if (mediaPreviewUrlRef.current && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(mediaPreviewUrlRef.current);
    mediaPreviewUrlRef.current = '';
    setInputMediaPreviewUrl('');
  }, []);
  const handleMediaRemove = useCallback(() => {
    mediaUploadAbortRef.current?.abort();
    mediaUploadAbortRef.current = null;
    releaseMediaPreview();
    setInputMedia(null); setInputMediaFileName(''); setMediaUploading(false); setMediaError('');
    idempotencyKey.current = newIdempotencyKey(); setDemoComplete(false);
  }, [releaseMediaPreview]);
  const handleMediaSelect = useCallback(async (file: File) => {
    if (!imageCapability) { setMediaError('ساخت ویدیو از تصویر فعلاً در دسترس نیست.'); return; }
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) { setMediaError('فقط تصویر JPEG، PNG یا WebP قابل انتخاب است.'); return; }
    if (!file.size || file.size > MAX_IMAGE_BYTES) { setMediaError('حجم تصویر باید حداکثر ۵ مگابایت باشد.'); return; }
    mediaUploadAbortRef.current?.abort();
    releaseMediaPreview();
    const previewUrl = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : '';
    mediaPreviewUrlRef.current = previewUrl;
    setInputMediaPreviewUrl(previewUrl); setInputMedia(null); setInputMediaFileName(file.name); setMediaError(''); setMediaUploading(true);
    idempotencyKey.current = newIdempotencyKey(); setDemoComplete(false);
    if (localDemoMode) {
      setInputMedia({ mediaId: `local-demo-${Date.now()}`, mimeType: file.type, sizeBytes: file.size });
      setMediaUploading(false);
      return;
    }
    const controller = new AbortController(); mediaUploadAbortRef.current = controller;
    try {
      const media = await videoGenerationService.uploadInputMedia(file, controller.signal);
      if (mediaUploadAbortRef.current === controller) setInputMedia(media);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError') && mediaUploadAbortRef.current === controller) {
        releaseMediaPreview(); setInputMediaFileName(''); setMediaError(error instanceof Error ? error.message : 'تصویر آپلود نشد. دوباره تلاش کنید.');
      }
    } finally {
      if (mediaUploadAbortRef.current === controller) { mediaUploadAbortRef.current = null; setMediaUploading(false); }
    }
  }, [imageCapability, localDemoMode, releaseMediaPreview]);

  useEffect(() => () => { selectionAbortRef.current?.abort(); mediaUploadAbortRef.current?.abort(); if (mediaPreviewUrlRef.current && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(mediaPreviewUrlRef.current); }, []);
  useEffect(() => {
    if (!activeCapability) return;
    setDuration((value) => activeCapability.allowedDurations.includes(value) ? value : activeCapability.allowedDurations.includes('5') ? '5' : activeCapability.allowedDurations[0] || '');
    setAspectRatio((value) => activeCapability.allowedAspectRatios.includes(value) ? value : activeCapability.allowedAspectRatios.includes('9:16') ? '9:16' : activeCapability.allowedAspectRatios[0] || '');
    setResolution((value) => activeCapability.allowedResolutions.includes(value) ? value : activeCapability.allowedResolutions.includes('480p') ? '480p' : activeCapability.allowedResolutions[0] || '');
  }, [activeCapability]);
  useEffect(() => { void loadOptions(); void loadHistory().then((items) => { const hint = safelyReadHint(); const resume = hint && items.some((item) => item.id === hint) ? hint : items.find((item) => !isTerminalVideoStatus(item.status))?.id; if (hint && !resume) saveHint(); if (resume) void selectGeneration(resume); }); }, [loadHistory, loadOptions, selectGeneration]);
  useEffect(() => {
    if (!active || isTerminalVideoStatus(active.status)) return;
    let cancelled = false; let timer = 0; let attempt = 0; let requestInFlight = false; const controller = new AbortController();
    const poll = async () => { if (cancelled || requestInFlight) return; requestInFlight = true; try { const detail = await videoGenerationService.getVideoGeneration(active.id, controller.signal); if (cancelled) return; setActive(detail); setHistory((items) => items.map((item) => item.id === detail.id ? { ...item, ...detail } : item)); if (isTerminalVideoStatus(detail.status)) { saveHint(); window.dispatchEvent(new Event('noa:wallet-changed')); void loadOptions(); return; } attempt += 1; timer = window.setTimeout(() => void poll(), POLL_DELAYS_MS[Math.min(attempt, POLL_DELAYS_MS.length - 1)]); } catch (error) { if (!cancelled && !(error instanceof DOMException && error.name === 'AbortError')) { attempt += 1; timer = window.setTimeout(() => void poll(), POLL_DELAYS_MS[Math.min(attempt, POLL_DELAYS_MS.length - 1)]); } } finally { requestInFlight = false; } };
    void poll(); return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [active?.id, active?.status, loadOptions]);

  const handleSubmit = async () => {
    const maxPromptLength = activeCapability?.maxPromptLength ?? 2000;
    if (!activeCapability || !selectedProfile || submitting || mediaUploading || submitInFlightRef.current || (lastSubmitAtRef.current && Date.now() - lastSubmitAtRef.current < 500) || prompt.trim().length < 3 || prompt.length > maxPromptLength) return;
    if (localDemoMode) { setDemoComplete(true); return; }
    lastSubmitAtRef.current = Date.now() || 1; submitInFlightRef.current = true; setSubmitting(true); setDetailError('');
    try {
      const input = inputMedia
        ? { mode: 'image_to_video' as const, mediaId: inputMedia.mediaId, styleKey:selectedProfile.profileKey, prompt:prompt.trim(), duration, resolution, aspectRatio }
        : { mode: 'text_to_video' as const, styleKey:selectedProfile.profileKey, prompt:prompt.trim(), duration, resolution, aspectRatio };
      let response;
      try {
        response = await videoGenerationService.createVideoGeneration(input, idempotencyKey.current);
      } catch (error) {
        if ((error as { code?: string }).code !== 'VIDEO_GENERATION_IDEMPOTENCY_CONFLICT') throw error;
        // The user changed a previously submitted review. This is a new, explicit request.
        idempotencyKey.current = newIdempotencyKey();
        response = await videoGenerationService.createVideoGeneration(input, idempotencyKey.current);
      }
      window.dispatchEvent(new Event('noa:wallet-changed'));
      idempotencyKey.current = newIdempotencyKey(); saveHint(response.generationId); clearVideoStudioSession(); await loadHistory(); await selectGeneration(response.generationId); handleMediaRemove(); setActiveTab('history'); setCreateStep('style'); setProgressModalOpen(true);
    } catch (error) {
      if (isInsufficientBalanceError(error) && onInsufficientBalance) {
        onInsufficientBalance(getInsufficientBalanceDetails(error));
        return;
      }
      setDetailError(error instanceof Error ? error.message : 'درخواست ثبت نشد. تنظیمات و اینترنت را بررسی کنید و دوباره تلاش کنید.');
    }
    finally { submitInFlightRef.current = false; setSubmitting(false); }
  };
  const change = <T,>(setter: (value: T) => void) => (value: T) => { idempotencyKey.current = newIdempotencyKey(); setDemoComplete(false); setter(value); };
  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = event.key === 'Home' || event.key === 'ArrowRight' ? 'create' : event.key === 'End' || event.key === 'ArrowLeft' ? 'history' : null;
    if (!next) return;
    event.preventDefault();
    setActiveTab(next);
    window.requestAnimationFrame(() => document.getElementById(next === 'create' ? 'video-create-tab' : 'video-history-tab')?.focus());
  };

  return <main className={`video-generation-page ${activeTab === 'create' && createStep === 'style' ? 'video-generation-page--style-selection' : ''}`} dir="rtl"><div className="video-generation-page__shell">
    <header className="video-generation-page__header"><div className="video-generation-page__brand"><span className="video-brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2Zm7 13 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" /></svg></span><span><h1>استودیوی ویدیو</h1><small>ایده‌ات را بنویس و ویدیوی تازه بساز</small></span></div><Button type="button" variant="ghost" className="video-generation-page__back" onClick={onBack} aria-label="بازگشت به استودیو" title="بازگشت به استودیو"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18 9 12l6-6" /></svg><span className="video-generation-page__back-label">بازگشت به استودیو</span></Button><span className="video-generation-page__header-spacer" aria-hidden="true" /></header>
    <nav className="video-generation-tabs" role="tablist" aria-label="بخش‌های استودیوی ویدیو"><button id="video-create-tab" type="button" role="tab" aria-selected={activeTab === 'create'} aria-controls="video-create-panel" tabIndex={activeTab === 'create' ? 0 : -1} className={activeTab === 'create' ? 'is-active' : ''} onKeyDown={handleTabKey} onClick={() => setActiveTab('create')}>ساخت ویدیو</button><button id="video-history-tab" type="button" role="tab" aria-selected={activeTab === 'history'} aria-controls="video-history-panel" tabIndex={activeTab === 'history' ? 0 : -1} className={activeTab === 'history' ? 'is-active' : ''} onKeyDown={handleTabKey} onClick={() => setActiveTab('history')}>ویدیوهای من</button></nav>
    <div id={activeTab === 'create' ? 'video-create-panel' : 'video-history-panel'} role="tabpanel" aria-labelledby={activeTab === 'create' ? 'video-create-tab' : 'video-history-tab'} className="video-generation-workspace">{detailError ? <InlineMessage variant="error" text={detailError} /> : null}{localDemoMode ? <InlineMessage variant={demoComplete ? 'success' : 'help'} text={demoComplete ? 'تست محلی با موفقیت کامل شد؛ هیچ درخواست خارجی ارسال نشد.' : 'حالت تست محلی فعال است؛ فرم و بازبینی قابل آزمایش‌اند و هیچ اعتبار یا API خارجی مصرف نمی‌شود.'} /> : null}
      {activeTab === 'create' ? <>
        {optionsLoading ? <p className="video-loading" role="status">در حال آماده‌سازی استودیو…</p> : optionsError ? <div className="video-form-message"><InlineMessage variant="error" text={optionsError} /><Button variant="secondary" onClick={() => void loadOptions()}>دریافت دوباره</Button></div> : !featureEnabled ? <InlineMessage variant="help" text="سبک‌های ساخت ویدیو هنوز آماده نیستند." /> : routeUnavailable ? <div className="video-form-message"><InlineMessage variant="warning" text="سرویس ساخت ویدیو فعلاً آماده نیست؛ هزینه‌ای از شما کم نمی‌شود. کمی بعد دوباره بررسی کنید." /><Button variant="secondary" onClick={() => void loadOptions()}>بررسی دوباره</Button></div> : createStep === 'style' ? <VideoStyleSelection profiles={profiles} selectedKey={styleKey} onSelect={change(setStyleKey)} onContinue={() => setCreateStep('form')} /> : createStep === 'form' && selectedProfile ? <VideoGenerationForm capability={activeCapability} profile={selectedProfile} featureEnabled={featureEnabled} loading={false} error="" onRetry={() => void loadOptions()} prompt={prompt} setPrompt={change(setPrompt)} aspectRatio={aspectRatio} setAspectRatio={change(setAspectRatio)} duration={duration} setDuration={change(setDuration)} resolution={resolution} setResolution={change(setResolution)} inputMedia={inputMedia} inputMediaFileName={inputMediaFileName} inputMediaPreviewUrl={inputMediaPreviewUrl} imageInputAvailable={Boolean(imageCapability)} mediaUploading={mediaUploading} mediaError={mediaError} onMediaSelect={(file) => void handleMediaSelect(file)} onMediaRemove={handleMediaRemove} submitting={submitting} onBack={() => setCreateStep('style')} onReview={() => setCreateStep('review')} /> : selectedProfile ? <section className="video-review" aria-labelledby="video-review-title"><span>مرحله ۳ از ۳</span><h2 id="video-review-title">بازبینی درخواست</h2><p className="video-ai-disclosure"><Icon name="sparkle" size="1em" aria-hidden="true" /> این ویدیو با هوش مصنوعی ساخته می‌شود.</p><dl><div><dt>روش ساخت</dt><dd>{inputMedia ? 'تصویر به ویدیو' : 'متن به ویدیو'}</dd></div>{inputMedia ? <div><dt>تصویر شروع</dt><dd>{inputMediaFileName || 'تصویر انتخاب‌شده'}</dd></div> : null}<div><dt>سبک</dt><dd>{selectedProfile.displayName}</dd></div><div><dt>ایده</dt><dd>{prompt}</dd></div><div><dt>خروجی</dt><dd>{duration} ثانیه · {resolution} · {aspectRatio}</dd></div><div><dt>هزینه</dt><dd>{localDemoMode ? 'بدون هزینه در تست محلی' : unitPriceNoa ? `${formatDecimalFa(multiplyDecimal(unitPriceNoa, duration))} نوآ` : 'در حال دریافت قیمت'}</dd></div></dl><p>{localDemoMode ? 'این بازبینی فقط برای تست رابط کاربری است و به Provider ارسال نمی‌شود.' : unitPriceNoa ? `قیمت هر ثانیه ${formatDecimalFa(unitPriceNoa)} نوآ است و هنگام ثبت نهایی محاسبه می‌شود.` : 'قیمت نهایی پیش از ثبت درخواست نمایش داده می‌شود.'}</p><div><Button variant="secondary" onClick={() => { setDemoComplete(false); setCreateStep('form'); }} disabled={submitting}>ویرایش</Button><Button onClick={() => void handleSubmit()} loading={submitting} disabled={submitting || mediaUploading || demoComplete}>{localDemoMode ? demoComplete ? 'تست تکمیل شد' : 'تکمیل تست محلی' : 'ساخت ویدیو'}</Button></div></section> : null}
        {active ? <section className="video-active-status" aria-live="polite"><h2>آخرین درخواست</h2><VideoGenerationStatus status={active.status} live /><span className="video-active-status__elapsed">زمان سپری‌شده: {formatElapsed(active.created_at)}</span>{detailLoading ? <span className="video-loading">در حال دریافت جزئیات…</span> : null}<Button type="button" variant="secondary" onClick={() => setProgressModalOpen(true)}>نمایش وضعیت ساخت</Button></section> : null}
      </> : <VideoGenerationGallery active={active} error={historyError} items={history} loading={historyLoading} onRetry={() => void loadHistory()} onSelect={(id) => void selectGeneration(id)} selectedId={active?.id} />}
    </div>
    {progressModalOpen && active ? <VideoGenerationProgressModal
      generation={active}
      onClose={() => setProgressModalOpen(false)}
      onView={() => { setProgressModalOpen(false); setActiveTab('history'); }}
      onBackToForm={() => { setProgressModalOpen(false); setActiveTab('create'); setCreateStep('form'); }}
    /> : null}
  </div></main>;
}
