import { type FormEvent } from 'react';
import { Button, InlineMessage } from '../design-system/components';
import Icon from '../components/Icon';
import MultiImageUploader from './MultiImageUploader';
import type { MultiImageState, VideoCapabilityOption, VideoInputMedia, VideoPromptProfile } from './video-generation.types';

type Props = {
  capability: VideoCapabilityOption | null;
  profile: VideoPromptProfile;
  featureEnabled?: boolean;
  loading: boolean;
  error: string;
  onRetry: () => void;
  prompt: string;
  setPrompt: (value: string) => void;
  aspectRatio: string;
  setAspectRatio: (value: string) => void;
  duration: string;
  setDuration: (value: string) => void;
  resolution: string;
  setResolution: (value: string) => void;
  media: VideoInputMedia | null;
  mediaPreviewUrl?: string;
  mediaFilename?: string;
  images: MultiImageState[];
  imagesUploading: boolean;
  multiAvailable: boolean;
  onFilesAdded: (files: File[]) => void;
  onMediaFile: (file: File) => void;
  onRemoveImage: (localId: string) => void;
  onRetryImage: (localId: string) => void;
  onReorder: (localId: string, direction: -1 | 1) => void;
  onRemoveMedia: () => void;
  mediaUploading: boolean;
  mediaError: string;
  submitting: boolean;
  onBack: () => void;
  onReview: () => void;
};

const ratioClass = (ratio: string) => `video-ratio-shape video-ratio-shape--${ratio.replace(':', '-')}`;
const faNumber = (value: number | string) => Number(value).toLocaleString('fa-IR');

export default function VideoGenerationForm(props: Props) {
  const maxPromptLength = props.capability?.maxPromptLength ?? 2000;
  const promptError = !props.prompt.trim() ? 'حرکت موردنظر را توضیح دهید.' : props.prompt.trim().length < 3 ? 'توضیح حرکت باید حداقل ۳ کاراکتر باشد.' : props.prompt.length > maxPromptLength ? `حداکثر ${maxPromptLength} کاراکتر مجاز است.` : '';
  const readyCount = props.images.filter((img) => img.uploadStatus === 'ready').length;
  const hasAnyUploading = props.imagesUploading || props.images.some((img) => img.uploadStatus === 'pending' || img.uploadStatus === 'uploading');
  const hasAnyError = props.images.some((img) => img.uploadStatus === 'error');
  const mediaReady = !hasAnyUploading && !hasAnyError && readyCount >= 1;
  const submit = (event: FormEvent) => { event.preventDefault(); props.onReview(); };
  const ratioTitle = (ratio: string) => ratio === '16:9' ? 'افقی' : ratio === '9:16' ? 'عمودی' : 'مربع';
  const disabled = props.mediaUploading || props.submitting;
  const maxRefs = props.capability?.maxReferences || 7;
  const durationValues = [...new Set((props.capability?.allowedDurations || []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  const durationMin = durationValues[0] ?? 1;
  const durationMax = durationValues[durationValues.length - 1] ?? 15;
  const continuousDurations = durationValues.length === durationMax - durationMin + 1 && durationValues.every((value, index) => value === durationMin + index);
  const selectedDuration = Number(props.duration) || durationMin;
  const setDuration = (rawValue: string) => {
    const numericValue = Math.max(durationMin, Math.min(durationMax, Math.round(Number(rawValue))));
    if (durationValues.includes(numericValue)) props.setDuration(String(numericValue));
  };
  return <form className="video-studio-create" onSubmit={submit} noValidate aria-busy={props.submitting || props.imagesUploading}>
    {props.loading ? <p className="video-loading" role="status">در حال دریافت تنظیمات معتبر…</p> : props.error ? <div className="video-form-message"><p className="video-error" role="alert">{props.error}</p><Button type="button" variant="secondary" onClick={props.onRetry}>دریافت دوباره</Button></div> : props.featureEnabled === false || !props.capability ? <InlineMessage variant="help" text="ساخت ویدیو از تصویر فعلاً توسط مدیر سامانه فعال نشده است." /> : <div className="video-studio-create__grid">
      <section className="video-prompt-card" aria-labelledby="video-prompt-heading">
        <div className="video-selected-style"><span aria-hidden="true"><Icon name="sparkle" size="1em" /></span><div><small>سبک انتخاب‌شده</small><strong>{props.profile.displayName}</strong></div><button type="button" onClick={props.onBack}>تغییر سبک</button></div>
        <div className="video-prompt-card__heading"><div><span className="video-step-kicker">مرحله ۲ از ۳</span><h2 id="video-prompt-heading">عکس را چطور زنده کنیم؟</h2><p>حرکت سوژه، دوربین و فضای صحنه را روشن و کوتاه توضیح دهید.</p></div><Icon name="sparkle" size="1em" className="video-spark" aria-hidden="true" /></div>

        <MultiImageUploader
          images={props.images}
          uploading={props.imagesUploading}
          onFilesAdded={props.onFilesAdded}
          onRemove={props.onRemoveImage}
          onRetry={props.onRetryImage}
          onReorder={props.onReorder}
          disabled={disabled}
          maxCount={maxRefs}
        />

        {!props.multiAvailable && readyCount >= 2 ? <InlineMessage variant="help" text="ساخت ویدیو با چند تصویر در حال حاضر فعال نیست." /> : null}

        <label className="video-prompt-label" htmlFor="video-prompt"><span>توضیح حرکت <b aria-hidden="true">*</b></span><small>{props.prompt.length}/{maxPromptLength}</small></label>
        <div className="video-textarea-wrap"><Icon name="sparkle" size="1em" className="video-textarea-spark" aria-hidden="true" /><textarea id="video-prompt" value={props.prompt} onChange={(event) => props.setPrompt(event.target.value)} placeholder="مثلاً شخص آرام سرش را برگرداند و لبخند بزند؛ دوربین کمی نزدیک شود…" rows={6} maxLength={maxPromptLength} required aria-invalid={Boolean(promptError)} aria-describedby={promptError ? 'video-prompt-error' : 'video-prompt-help'} /></div>
        {promptError ? <p id="video-prompt-error" className="video-prompt-error" role="alert">{promptError}</p> : <p id="video-prompt-help" className="video-prompt-help">قواعد حفظ هویت و سبک به‌صورت امن در سرور اعمال می‌شوند.</p>}
        <div className="video-submit-dock video-submit-dock--split"><Button type="button" variant="secondary" onClick={props.onBack}>بازگشت</Button><Button type="submit" className="video-generation-form__submit" disabled={Boolean(promptError) || !mediaReady || props.mediaUploading || props.submitting}>ادامه و بازبینی</Button></div>
      </section>

      <aside className="video-settings-card" aria-label="تنظیمات ویدیو">
        <div className="video-settings-heading"><Icon name="settings" size="1em" className="video-settings-icon" aria-hidden="true" /><div><h2>تنظیمات ویدیو</h2><p>اندازه و مدت خروجی را مشخص کنید</p></div></div>
        <fieldset className="video-setting-field"><legend>نسبت تصویر</legend><div className="video-option-cards">{props.capability.allowedAspectRatios.map((ratio) => <button key={ratio} type="button" className={props.aspectRatio === ratio ? 'is-selected' : ''} onClick={() => props.setAspectRatio(ratio)} aria-pressed={props.aspectRatio === ratio}><span className={ratioClass(ratio)} aria-hidden="true" /><span>{ratioTitle(ratio)}</span><small>{ratio}</small>{props.aspectRatio === ratio ? <b><Icon name="check" size="1em" aria-hidden="true" /></b> : null}</button>)}</div></fieldset>
        <fieldset className="video-setting-field"><legend>مدت ویدیو</legend>{continuousDurations ? <div className="video-duration-control"><div className="video-duration-control__value"><span>مدت خروجی</span><output htmlFor="video-duration-range">{faNumber(selectedDuration)} <small>ثانیه</small></output></div><input id="video-duration-range" type="range" min={durationMin} max={durationMax} step="1" value={selectedDuration} onChange={(event) => setDuration(event.target.value)} aria-label="مدت ویدیو به ثانیه" /><div className="video-duration-control__limits" aria-hidden="true"><span>{faNumber(durationMin)} ثانیه</span><span>{faNumber(durationMax)} ثانیه</span></div><label className="video-duration-number" htmlFor="video-duration-number"><span>ورود عددی</span><span><input id="video-duration-number" type="number" inputMode="numeric" min={durationMin} max={durationMax} step="1" value={selectedDuration} onChange={(event) => setDuration(event.target.value)} /><b>ثانیه</b></span></label></div> : <div className="video-duration-options">{props.capability.allowedDurations.map((value) => <button key={value} type="button" className={props.duration === value ? 'is-selected' : ''} onClick={() => props.setDuration(value)} aria-pressed={props.duration === value}><strong>{faNumber(value)}</strong><span>ثانیه</span></button>)}</div>}</fieldset>
        {props.capability.allowedResolutions.length ? <fieldset className="video-setting-field"><legend>وضوح ویدیو</legend><div className="video-resolution-options">{props.capability.allowedResolutions.map((value) => <button key={value} type="button" className={props.resolution === value ? 'is-selected' : ''} onClick={() => props.setResolution(value)} aria-pressed={props.resolution === value} aria-label={`وضوح ${value}`}><span><strong>{value.toUpperCase()}</strong><small>{value === '480p' ? 'سبک و مناسب پیش‌نمایش' : value === '720p' ? 'شفاف با جزئیات بیشتر' : 'وضوح مسیر فعال'}</small></span>{props.resolution === value ? <b><Icon name="check" size="1em" aria-hidden="true" /></b> : null}</button>)}</div></fieldset> : null}
        <div className="video-output-summary"><span>خروجی انتخاب‌شده</span><strong>{ratioTitle(props.aspectRatio)} <em>{props.aspectRatio}</em></strong><p>{faNumber(props.duration)} ثانیه · {props.resolution || 'وضوح مسیر فعال'} · بدون صدا</p></div>
      </aside>
    </div>}
  </form>;
}
