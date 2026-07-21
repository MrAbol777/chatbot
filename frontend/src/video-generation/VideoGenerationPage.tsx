import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, InlineMessage } from '../design-system/components';
import { ACTIVE_GENERATION_HINT_KEY, POLL_DELAYS_MS } from './video-generation.constants';
import VideoGenerationForm from './VideoGenerationForm';
import VideoGenerationGallery from './VideoGenerationGallery';
import VideoGenerationStatus from './VideoGenerationStatus';
import { videoGenerationService } from './video-generation.service';
import type { VideoGenerationDetail, VideoGenerationListItem, VideoGenerationOption } from './video-generation.types';
import { formatElapsed, isTerminalVideoStatus, newIdempotencyKey } from './video-generation.utils';
import './VideoGenerationPage.css';

type Props = { onBack: () => void };
const safelyReadHint = () => { try { return localStorage.getItem(ACTIVE_GENERATION_HINT_KEY) || ''; } catch { return ''; } };
const saveHint = (id?: string) => { try { if (id) localStorage.setItem(ACTIVE_GENERATION_HINT_KEY, id); else localStorage.removeItem(ACTIVE_GENERATION_HINT_KEY); } catch { /* Optional convenience only. */ } };

export default function VideoGenerationPage({ onBack }: Props) {
  const [models, setModels] = useState<VideoGenerationOption[]>([]);
  const [featureEnabled, setFeatureEnabled] = useState(true);
  const [activeTab, setActiveTab] = useState<'create' | 'history'>('create');
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState('');
  const [history, setHistory] = useState<VideoGenerationListItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [active, setActive] = useState<VideoGenerationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [modelKey, setModelKey] = useState('');
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('');
  const [duration, setDuration] = useState('');
  const [quality, setQuality] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKey = useRef(newIdempotencyKey());
  const activeIdRef = useRef<string | null>(null);
  const selectionAbortRef = useRef<AbortController | null>(null);
  const submitInFlightRef = useRef(false);
  const lastSubmitAtRef = useRef(0);
  const selectedModel = useMemo(() => models.find((model) => model.internalKey === modelKey), [models, modelKey]);

  const loadOptions = useCallback(async () => {
    setOptionsLoading(true); setOptionsError('');
    try {
      const data = await videoGenerationService.getVideoOptions();
      const available = data.models.filter((model) => model.supportsTextToVideo);
      setFeatureEnabled(data.enabled !== false); setModels(available);
      setModelKey((current) => available.some((model) => model.internalKey === current) ? current : available[0]?.internalKey || '');
    } catch (error) { setOptionsError(error instanceof Error ? error.message : 'خطایی رخ داد. کمی بعد دوباره تلاش کنید.'); }
    finally { setOptionsLoading(false); }
  }, []);
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true); setHistoryError('');
    try { const data = await videoGenerationService.listVideoGenerations(); setHistory(data.items); return data.items; }
    catch (error) { setHistoryError(error instanceof Error ? error.message : 'خطایی رخ داد. کمی بعد دوباره تلاش کنید.'); return []; }
    finally { setHistoryLoading(false); }
  }, []);
  const selectGeneration = useCallback(async (id: string) => {
    selectionAbortRef.current?.abort(); const controller = new AbortController(); selectionAbortRef.current = controller;
    activeIdRef.current = id; setDetailLoading(true); setDetailError('');
    try {
      const detail = await videoGenerationService.getVideoGeneration(id, controller.signal);
      if (activeIdRef.current === id) { setActive(detail); saveHint(isTerminalVideoStatus(detail.status) ? undefined : id); }
    } catch (error) {
      if (activeIdRef.current === id && !(error instanceof DOMException && error.name === 'AbortError')) {
        setDetailError(error instanceof Error ? error.message : 'خطایی رخ داد. کمی بعد دوباره تلاش کنید.');
        if ((error as { code?: string }).code === 'VIDEO_GENERATION_NOT_FOUND') saveHint();
      }
    } finally {
      if (selectionAbortRef.current === controller) selectionAbortRef.current = null;
      if (activeIdRef.current === id) setDetailLoading(false);
    }
  }, []);

  useEffect(() => () => selectionAbortRef.current?.abort(), []);
  useEffect(() => { void loadOptions(); void loadHistory().then((items) => { const hint = safelyReadHint(); const resume = hint && items.some((item) => item.id === hint) ? hint : items.find((item) => !isTerminalVideoStatus(item.status))?.id; if (hint && !resume) saveHint(); if (resume) void selectGeneration(resume); }); }, [loadHistory, loadOptions, selectGeneration]);
  useEffect(() => { if (!selectedModel) return; setAspectRatio((value) => selectedModel.allowedAspectRatios.includes(value) ? value : selectedModel.allowedAspectRatios[0] || ''); setDuration((value) => selectedModel.allowedDurations.includes(value) ? value : selectedModel.allowedDurations[0] || ''); setQuality((value) => selectedModel.allowedQualities.includes(value) ? value : selectedModel.allowedQualities[0] || ''); }, [selectedModel]);
  useEffect(() => {
    if (!active || isTerminalVideoStatus(active.status)) return;
    let cancelled = false; let timer = 0; let attempt = 0; let requestInFlight = false; const controller = new AbortController();
    const poll = async () => {
      if (cancelled || requestInFlight) return; requestInFlight = true;
      try {
        const detail = await videoGenerationService.getVideoGeneration(active.id, controller.signal);
        if (cancelled) return; setActive(detail); setHistory((items) => items.map((item) => item.id === detail.id ? { ...item, ...detail } : item));
        if (isTerminalVideoStatus(detail.status)) { saveHint(); void loadOptions(); return; }
        attempt += 1; timer = window.setTimeout(() => void poll(), POLL_DELAYS_MS[Math.min(attempt, POLL_DELAYS_MS.length - 1)]);
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException && error.name === 'AbortError')) { attempt += 1; timer = window.setTimeout(() => void poll(), POLL_DELAYS_MS[Math.min(attempt, POLL_DELAYS_MS.length - 1)]); }
      } finally { requestInFlight = false; }
    };
    void poll(); return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [active?.id, active?.status, loadOptions]);

  const handleSubmit = async () => {
    if (!selectedModel || submitting || submitInFlightRef.current || (lastSubmitAtRef.current && Date.now() - lastSubmitAtRef.current < 500) || prompt.trim().length < 3 || (selectedModel.maxPromptLength != null && prompt.length > selectedModel.maxPromptLength)) return;
    lastSubmitAtRef.current = Date.now() || 1; submitInFlightRef.current = true; setSubmitting(true); setDetailError('');
    try {
      const response = await videoGenerationService.createVideoGeneration({ mode: 'text-to-video', modelKey, prompt: prompt.trim(), aspectRatio, duration, quality }, idempotencyKey.current);
      idempotencyKey.current = newIdempotencyKey(); saveHint(response.generationId); await loadHistory(); await selectGeneration(response.generationId); setActiveTab('history');
    } catch (error) { setDetailError(error instanceof Error ? error.message : 'خطایی رخ داد. کمی بعد دوباره تلاش کنید.'); }
    finally { submitInFlightRef.current = false; setSubmitting(false); }
  };
  const change = <T,>(setter: (value: T) => void) => (value: T) => { idempotencyKey.current = newIdempotencyKey(); setter(value); };

  return <main className="video-generation-page" dir="rtl"><div className="video-generation-page__shell">
    <header className="video-generation-page__header"><div className="video-generation-page__brand"><span className="video-brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2Zm7 13 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" /></svg></span><span><strong>استودیوی ویدیو</strong><small>ایده‌ات را به یک ویدیوی کوتاه تبدیل کن</small></span></div><Button type="button" variant="ghost" className="video-generation-page__back" onClick={onBack}>بازگشت به استودیو</Button></header>
    <nav className="video-generation-tabs" role="tablist" aria-label="بخش‌های استودیوی ویدیو"><button type="button" role="tab" aria-label="تب ساخت ویدیو" aria-selected={activeTab === 'create'} className={activeTab === 'create' ? 'is-active' : ''} onClick={() => setActiveTab('create')}>ساخت ویدیو</button><button type="button" role="tab" aria-selected={activeTab === 'history'} className={activeTab === 'history' ? 'is-active' : ''} onClick={() => setActiveTab('history')}>ویدیوهای من</button></nav>
    <div className="video-generation-workspace">
      {detailError ? <InlineMessage variant="error" text={detailError} /> : null}
      {activeTab === 'create' ? <>
        <VideoGenerationForm models={models} featureEnabled={featureEnabled} loading={optionsLoading} error={optionsError} onRetry={() => void loadOptions()} modelKey={modelKey} setModelKey={change(setModelKey)} prompt={prompt} setPrompt={change(setPrompt)} aspectRatio={aspectRatio} setAspectRatio={change(setAspectRatio)} duration={duration} setDuration={change(setDuration)} quality={quality} setQuality={change(setQuality)} submitting={submitting} onSubmit={() => void handleSubmit()} />
        {active && !isTerminalVideoStatus(active.status) ? <section className="video-active-status" aria-live="polite"><h2>آخرین درخواست</h2><VideoGenerationStatus status={active.status} live /><span className="video-active-status__elapsed">زمان سپری‌شده: {formatElapsed(active.created_at)}</span>{detailLoading ? <span className="video-loading">در حال دریافت جزئیات…</span> : null}</section> : null}
      </> : <VideoGenerationGallery active={active} error={historyError} items={history} loading={historyLoading} onRetry={() => void loadHistory()} onSelect={(id) => void selectGeneration(id)} selectedId={active?.id} />}
    </div>
  </div></main>;
}
