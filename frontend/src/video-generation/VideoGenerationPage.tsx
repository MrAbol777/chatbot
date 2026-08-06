import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, InlineMessage } from '../design-system/components';
import { formatDecimalFa, multiplyDecimal } from '../noa/decimal';
import { ACTIVE_GENERATION_HINT_KEY, POLL_DELAYS_MS } from './video-generation.constants';
import VideoGenerationForm from './VideoGenerationForm';
import VideoGenerationGallery from './VideoGenerationGallery';
import VideoGenerationStatus from './VideoGenerationStatus';
import VideoStyleSelection from './VideoStyleSelection';
import { videoGenerationService } from './video-generation.service';
import type { MultiImageState, VideoCapabilityOption, VideoGenerationDetail, VideoGenerationListItem, VideoPromptProfile } from './video-generation.types';
import { formatElapsed, isTerminalVideoStatus, newIdempotencyKey } from './video-generation.utils';
import './VideoGenerationPage.css';

type Props = { onBack: () => void; localDemoEnabled?: boolean };
type CreateStep = 'style' | 'form' | 'review';
const ALLOWED_DURATIONS = Array.from({ length: 15 }, (_, index) => String(index + 1));
const ALLOWED_RATIOS = ['9:16', '16:9', '1:1'];
const ALLOWED_RESOLUTIONS = ['480p'];
const MULTI_ALLOWED_RATIOS = ['9:16', '16:9', '1:1', '4:3', '3:4', '3:2', '2:3'];
const MULTI_ALLOWED_RESOLUTIONS = ['480p', '720p'];
const LOCAL_DEMO_CAPABILITY: VideoCapabilityOption = Object.freeze({ allowedAspectRatios: MULTI_ALLOWED_RATIOS, allowedDurations: ALLOWED_DURATIONS, allowedQualities: [], allowedResolutions: MULTI_ALLOWED_RESOLUTIONS, maxPromptLength: 2000, supportsNegativePrompt: false, supportsAudio: false, maxReferences: 7, minReferences: 2, supportsImageToVideoMulti: true });
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
  const [images, setImages] = useState<MultiImageState[]>([]);
  const [imagesUploading, setImagesUploading] = useState(false);
  const [multiAvailable, setMultiAvailable] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKey = useRef(newIdempotencyKey());
  const localDemoRef = useRef(false);
  const activeIdRef = useRef<string | null>(null);
  const selectionAbortRef = useRef<AbortController | null>(null);
  const submitInFlightRef = useRef(false);
  const lastSubmitAtRef = useRef(0);
  const selectedProfile = useMemo(() => profiles.find((profile) => profile.profileKey === styleKey) || null, [profiles, styleKey]);

  const revokePreviews = useCallback(() => {
    setImages((prev) => { for (const img of prev) { if (img.previewUrl) try { URL.revokeObjectURL(img.previewUrl); } catch {} } return prev; });
  }, []);

  const loadOptions = useCallback(async () => {
    setOptionsLoading(true); setOptionsError('');
    try {
      const data = await videoGenerationService.getVideoOptions();
      setUnitPriceNoa(data.pricing?.unitPriceNoa || '');
      const routeCapability = data.capabilities?.['video.image_to_video'];
      const multiCap = data.capabilities?.['video.image_to_video_multi'];
      const multiAvail = Boolean(multiCap?.supportsImageToVideoMulti && data.multiPricing);
      setMultiAvailable(multiAvail);
      const safeCapability: VideoCapabilityOption | null = routeCapability ? {
        ...routeCapability,
        allowedDurations: routeCapability.allowedDurations.map(String).filter((value) => ALLOWED_DURATIONS.includes(value)),
        allowedAspectRatios: routeCapability.allowedAspectRatios.filter((value) => ALLOWED_RATIOS.includes(value)),
        allowedResolutions: routeCapability.allowedResolutions.filter((value) => ALLOWED_RESOLUTIONS.includes(value)),
        maxReferences: multiCap?.maxReferences || multiAvail ? 7 : undefined,
        minReferences: multiCap?.minReferences || multiAvail ? 2 : undefined,
        supportsImageToVideoMulti: multiAvail || undefined
      } : null;
      const publicProfiles = (data.promptProfiles || []).filter((profile) => ['cinematic', 'animation'].includes(profile.profileKey));
      const routeReady = Boolean(data.enabled !== false && safeCapability && safeCapability.allowedDurations.length && safeCapability.allowedAspectRatios.length && safeCapability.allowedResolutions.length);
      const profilesReady = publicProfiles.length === 2;
      const demoReady = Boolean(import.meta.env.MODE !== 'production' && localDemoEnabled && profilesReady && !routeReady);
      const effectiveCapability = routeReady ? safeCapability : demoReady ? LOCAL_DEMO_CAPABILITY : null;
      setFeatureEnabled(profilesReady); setCapability(effectiveCapability); setProfiles(publicProfiles); setLocalDemoMode(demoReady); localDemoRef.current = demoReady;
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
    revokePreviews();
  }, [revokePreviews]);
  useEffect(() => { void loadOptions(); void loadHistory().then((items) => { const hint = safelyReadHint(); const resume = hint && items.some((item) => item.id === hint) ? hint : items.find((item) => !isTerminalVideoStatus(item.status))?.id; if (hint && !resume) saveHint(); if (resume) void selectGeneration(resume); }); }, [loadHistory, loadOptions, selectGeneration]);
  useEffect(() => {
    if (!active || isTerminalVideoStatus(active.status)) return;
    let cancelled = false; let timer = 0; let attempt = 0; let requestInFlight = false; const controller = new AbortController();
    const poll = async () => { if (cancelled || requestInFlight) return; requestInFlight = true; try { const detail = await videoGenerationService.getVideoGeneration(active.id, controller.signal); if (cancelled) return; setActive(detail); setHistory((items) => items.map((item) => item.id === detail.id ? { ...item, ...detail } : item)); if (isTerminalVideoStatus(detail.status)) { saveHint(); window.dispatchEvent(new Event('noa:wallet-changed')); void loadOptions(); return; } attempt += 1; timer = window.setTimeout(() => void poll(), POLL_DELAYS_MS[Math.min(attempt, POLL_DELAYS_MS.length - 1)]); } catch (error) { if (!cancelled && !(error instanceof DOMException && error.name === 'AbortError')) { attempt += 1; timer = window.setTimeout(() => void poll(), POLL_DELAYS_MS[Math.min(attempt, POLL_DELAYS_MS.length - 1)]); } } finally { requestInFlight = false; } };
    void poll(); return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [active?.id, active?.status, loadOptions]);

  const handleSubmit = async () => {
    const readyImages = images.filter((img) => img.uploadStatus === 'ready');
    const maxPromptLength = capability?.maxPromptLength ?? 2000;
    if (!capability || !selectedProfile || readyImages.length < 1 || submitting || submitInFlightRef.current || (lastSubmitAtRef.current && Date.now() - lastSubmitAtRef.current < 500) || prompt.trim().length < 3 || prompt.length > maxPromptLength) return;
    if (localDemoMode) { setDemoComplete(true); return; }
    lastSubmitAtRef.current = Date.now() || 1; submitInFlightRef.current = true; setSubmitting(true); setDetailError('');
    try {
      const mediaIds = readyImages.map((img) => img.mediaId!).filter(Boolean);
      const input: Record<string, unknown> = { mode: 'image_to_video' as const, styleKey: selectedProfile.profileKey, prompt: prompt.trim(), duration, resolution, aspectRatio };
      if (mediaIds.length >= 2) input.mediaIds = mediaIds;
      else input.mediaId = mediaIds[0] || '';
      let response;
      try {
        response = await videoGenerationService.createVideoGeneration(input as Parameters<typeof videoGenerationService.createVideoGeneration>[0], idempotencyKey.current);
      } catch (error) {
        if ((error as { code?: string }).code !== 'VIDEO_GENERATION_IDEMPOTENCY_CONFLICT') throw error;
        idempotencyKey.current = newIdempotencyKey();
        response = await videoGenerationService.createVideoGeneration(input as Parameters<typeof videoGenerationService.createVideoGeneration>[0], idempotencyKey.current);
      }
      window.dispatchEvent(new Event('noa:wallet-changed'));
      idempotencyKey.current = newIdempotencyKey(); saveHint(response.generationId); await loadHistory(); await selectGeneration(response.generationId); setActiveTab('history'); setCreateStep('style'); setImages([]); setDemoComplete(false);
    } catch (error) { setDetailError(error instanceof Error ? error.message : 'درخواست ثبت نشد. تنظیمات و اینترنت را بررسی کنید و دوباره تلاش کنید.'); }
    finally { submitInFlightRef.current = false; setSubmitting(false); }
  };
  const addImages = useCallback((files: File[]) => {
    setImages((prev) => {
      const remaining = 7 - prev.length;
      const toAdd = files.slice(0, remaining).map((file) => {
        if (localDemoRef.current) {
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size <= 0 || file.size > 5 * 1024 * 1024) {
            return { localId: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file), fileName: file.name, uploadStatus: 'error' as const, uploadError: 'برای تست محلی، تصویر JPEG، PNG یا WebP تا سقف ۵ مگابایت انتخاب کنید.' };
          }
          return { localId: crypto.randomUUID(), previewUrl: URL.createObjectURL(file), fileName: file.name, uploadStatus: 'ready' as const, mediaId: 'local-demo-input', mimeType: file.type, sizeBytes: file.size };
        }
        return { localId: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file), fileName: file.name, uploadStatus: 'pending' as const };
      });
      const next = [...prev, ...toAdd];
      if (files.length > remaining && remaining > 0) {
        setMediaError(`حداکثر ۷ تصویر مجاز است. ${files.length - remaining} تصویر اضافه حذف شد.`);
      } else if (files.length > remaining) {
        setMediaError('حداکثر ۷ تصویر مجاز است.');
      }
      if (toAdd.length) {
        setDemoComplete(false);
        idempotencyKey.current = newIdempotencyKey();
        if (!localDemoRef.current) uploadPendingImages(next);
      }
      return next;
    });
  }, []);

  const uploadPendingImages = useCallback(async (currentImages: MultiImageState[]) => {
    setImagesUploading(true); setMediaError('');
    const uploads = currentImages.map((img) => img.uploadStatus === 'pending' ? img : null).filter(Boolean) as MultiImageState[];
    for (const img of uploads) {
      if (!img.file) continue;
      try {
        setImages((prev) => prev.map((p) => p.localId === img.localId ? { ...p, uploadStatus: 'uploading' as const } : p));
        const result = await videoGenerationService.uploadInputMedia(img.file);
        setImages((prev) => prev.map((p) => p.localId === img.localId ? { ...p, uploadStatus: 'ready' as const, mediaId: result.mediaId, mimeType: result.mimeType, sizeBytes: result.sizeBytes, file: undefined } : p));
      } catch (error) {
        setImages((prev) => prev.map((p) => p.localId === img.localId ? { ...p, uploadStatus: 'error' as const, uploadError: error instanceof Error ? error.message : 'بارگذاری ناموفق بود' } : p));
      }
    }
    setImagesUploading(false);
  }, []);

  const handleRemoveImage = useCallback((localId: string) => {
    setImages((prev) => {
      const img = prev.find((p) => p.localId === localId);
      if (img?.previewUrl) try { URL.revokeObjectURL(img.previewUrl); } catch {}
      const next = prev.filter((p) => p.localId !== localId);
      if (next.length > 0) { setDemoComplete(false); idempotencyKey.current = newIdempotencyKey(); }
      return next;
    });
  }, []);

  const handleRetryImage = useCallback((localId: string) => {
    setImages((prev) => {
      const img = prev.find((p) => p.localId === localId);
      if (!img?.file) return prev;
      const updated = prev.map((p) => p.localId === localId ? { ...p, uploadStatus: 'pending' as const, uploadError: undefined } : p);
      setTimeout(() => void uploadPendingImages(updated), 0);
      return updated;
    });
  }, [uploadPendingImages]);

  const handleReorder = useCallback((localId: string, direction: -1 | 1) => {
    setImages((prev) => {
      const idx = prev.findIndex((p) => p.localId === localId);
      if (idx < 0 || (direction === -1 && idx === 0) || (direction === 1 && idx === prev.length - 1)) return prev;
      const next = [...prev];
      const target = idx + direction;
      [next[idx], next[target]] = [next[target], next[idx]];
      idempotencyKey.current = newIdempotencyKey();
      return next;
    });
  }, []);
  const change = <T,>(setter: (value: T) => void) => (value: T) => { idempotencyKey.current = newIdempotencyKey(); setDemoComplete(false); setter(value); };
  const selectActiveTab = (nextTab: 'create' | 'history') => setActiveTab(nextTab);
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const tabs: Array<'create' | 'history'> = ['create', 'history'];
    const currentIndex = tabs.indexOf(activeTab);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else return;

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    selectActiveTab(nextTab);
    window.requestAnimationFrame(() => document.getElementById(`video-studio-tab-${nextTab}`)?.focus());
  };

  return <main className="video-generation-page" dir="rtl"><div className="video-generation-page__shell">
    <header className="video-generation-page__header"><div className="video-generation-page__brand"><span className="video-brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2Zm7 13 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" /></svg></span><span><h1>استودیوی ویدیو</h1><small>عکست را با حرکت حرفه‌ای زنده کن</small></span></div><Button type="button" variant="ghost" className="video-generation-page__back" onClick={onBack}>بازگشت به استودیو</Button></header>
    <nav className="video-generation-tabs" role="tablist" aria-label="بخش‌های استودیوی ویدیو"><button id="video-studio-tab-create" type="button" role="tab" aria-selected={activeTab === 'create'} aria-controls={activeTab === 'create' ? 'video-studio-create-panel' : undefined} tabIndex={activeTab === 'create' ? 0 : -1} className={activeTab === 'create' ? 'is-active' : ''} onClick={() => selectActiveTab('create')} onKeyDown={handleTabKeyDown}>ساخت ویدیو</button><button id="video-studio-tab-history" type="button" role="tab" aria-selected={activeTab === 'history'} aria-controls={activeTab === 'history' ? 'video-studio-history-panel' : undefined} tabIndex={activeTab === 'history' ? 0 : -1} className={activeTab === 'history' ? 'is-active' : ''} onClick={() => selectActiveTab('history')} onKeyDown={handleTabKeyDown}>ویدیوهای من</button></nav>
    <div className="video-generation-workspace" id={activeTab === 'create' ? 'video-studio-create-panel' : 'video-studio-history-panel'} role="tabpanel" aria-labelledby={activeTab === 'create' ? 'video-studio-tab-create' : 'video-studio-tab-history'}>{detailError ? <InlineMessage variant="error" text={detailError} /> : null}{localDemoMode ? <InlineMessage variant={demoComplete ? 'success' : 'help'} text={demoComplete ? 'تست محلی با موفقیت کامل شد؛ هیچ درخواست خارجی ارسال نشد.' : 'حالت تست محلی فعال است؛ فرم و بازبینی قابل آزمایش‌اند و هیچ اعتبار یا API خارجی مصرف نمی‌شود.'} /> : null}
      {activeTab === 'create' ? <>
        {optionsLoading ? <p className="video-loading" role="status">در حال آماده‌سازی استودیو…</p> : optionsError ? <div className="video-form-message"><InlineMessage variant="error" text={optionsError} /><Button variant="secondary" onClick={() => void loadOptions()}>دریافت دوباره</Button></div> : !featureEnabled ? <InlineMessage variant="help" text="پروفایل‌های عمومی ساخت ویدیو هنوز کامل نیستند." /> : createStep === 'style' ? <VideoStyleSelection profiles={profiles} selectedKey={styleKey} onSelect={change(setStyleKey)} onContinue={() => setCreateStep('form')} /> : createStep === 'form' && selectedProfile ? <VideoGenerationForm capability={capability} profile={selectedProfile} featureEnabled={featureEnabled} loading={false} error="" onRetry={() => void loadOptions()} prompt={prompt} setPrompt={change(setPrompt)} aspectRatio={aspectRatio} setAspectRatio={change(setAspectRatio)} duration={duration} setDuration={change(setDuration)} resolution={resolution} setResolution={change(setResolution)} media={null} images={images} imagesUploading={imagesUploading} multiAvailable={multiAvailable} onFilesAdded={addImages} onMediaFile={() => {}} onRemoveImage={handleRemoveImage} onRetryImage={handleRetryImage} onReorder={handleReorder} onRemoveMedia={() => { setImages([]); revokePreviews(); idempotencyKey.current = newIdempotencyKey(); setDemoComplete(false); }} mediaUploading={imagesUploading} mediaError={mediaError} submitting={submitting} onBack={() => setCreateStep('style')} onReview={() => setCreateStep('review')} /> : selectedProfile && images.some((img) => img.uploadStatus === 'ready') ? <section className="video-review" aria-labelledby="video-review-title"><span>مرحله ۳ از ۳</span><h2 id="video-review-title">بازبینی درخواست</h2><dl><div><dt>سبک</dt><dd>{selectedProfile.displayName}</dd></div><div><dt>حرکت</dt><dd>{prompt}</dd></div><div><dt>خروجی</dt><dd>{duration} ثانیه · {resolution} · {aspectRatio} · بدون صدا</dd></div><div><dt>هزینه</dt><dd>{localDemoMode ? 'بدون هزینه در تست محلی' : unitPriceNoa ? `${formatDecimalFa(multiplyDecimal(unitPriceNoa, duration))} نوآ` : 'در حال دریافت قیمت'}</dd></div><div><dt>تصاویر</dt><dd>{images.filter((img) => img.uploadStatus === 'ready').length} تصویر آماده</dd></div></dl>            <div className="video-submit-dock video-submit-dock--split"><Button variant="secondary" onClick={() => setCreateStep('form')}>ویرایش</Button><Button className="video-generation-form__submit" onClick={() => void handleSubmit()} disabled={submitting}>{submitting ? 'در حال ثبت…' : localDemoMode ? 'تکمیل تست محلی' : 'تایید و ساخت ویدیو'}</Button></div></section> : null}
        {active && !isTerminalVideoStatus(active.status) ? <section className="video-active-status" aria-live="polite"><h2>آخرین درخواست</h2><VideoGenerationStatus status={active.status} live /><span className="video-active-status__elapsed">زمان سپری‌شده: {formatElapsed(active.created_at)}</span>{detailLoading ? <span className="video-loading">در حال دریافت جزئیات…</span> : null}</section> : null}
      </> : <VideoGenerationGallery active={active} error={historyError} items={history} loading={historyLoading} onRetry={() => void loadHistory()} onSelect={(id) => void selectGeneration(id)} selectedId={active?.id} />}
    </div>
  </div></main>;
}
