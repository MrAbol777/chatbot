import { useState, type DragEvent, type FormEvent } from 'react';
import { Button, InlineMessage } from '../design-system/components';
import Icon from '../components/Icon';
import type { VideoCapabilityOption, VideoInputMedia, VideoPromptProfile } from './video-generation.types';

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
  onMediaFile: (file: File) => void;
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
  const [dragActive, setDragActive] = useState(false);
  const maxPromptLength = props.capability?.maxPromptLength ?? 2000;
  const promptError = !props.prompt.trim() ? 'حرکت موردنظر را توضیح دهید.' : props.prompt.trim().length < 3 ? 'توضیح حرکت باید حداقل ۳ کاراکتر باشد.' : props.prompt.length > maxPromptLength ? `حداکثر ${maxPromptLength} کاراکتر مجاز است.` : '';
  const mediaMissing = !props.media;
  const submit = (event: FormEvent) => { event.preventDefault(); props.onReview(); };
  const ratioTitle = (ratio: string) => ratio === '16:9' ? 'افقی' : ratio === '9:16' ? 'عمودی' : 'مربع';
  const disabled = props.mediaUploading || props.submitting;
  const durationValues = [...new Set((props.capability?.allowedDurations || []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  const durationMin = durationValues[0] ?? 1;
  const durationMax = durationValues[durationValues.length - 1] ?? 15;
  const continuousDurations = durationValues.length === durationMax - durationMin + 1 && durationValues.every((value, index) => value === durationMin + index);
  const selectedDuration = Number(props.duration) || durationMin;
  const setDuration = (rawValue: string) => {
    const numericValue = Math.max(durationMin, Math.min(durationMax, Math.round(Number(rawValue))));
    if (durationValues.includes(numericValue)) props.setDuration(String(numericValue));
  };
  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragActive(false);
    if (disabled) return;
    const file = event.dataTransfer.files?.[0];
    if (file) props.onMediaFile(file);
  };

  return <form className="video-studio-create" onSubmit={submit} noValidate aria-busy={props.submitting || props.mediaUploading}>
    {props.loading ? <p className="video-loading" role="status">در حال دریافت تنظیمات معتبر…</p> : props.error ? <div className="video-form-message"><p className="video-error" role="alert">{props.error}</p><Button type="button" variant="secondary" onClick={props.onRetry}>دریافت دوباره</Button></div> : props.featureEnabled === false || !props.capability ? <InlineMessage variant="help" text="ساخت ویدیو از تصویر فعلاً توسط مدیر سامانه فعال نشده است." /> : <div className="video-studio-create__grid">
      <section className="video-prompt-card" aria-labelledby="video-prompt-heading">
        <div className="video-selected-style"><span aria-hidden="true"><Icon name="sparkle" size="1em" /></span><div><small>سبک انتخاب‌شده</small><strong>{props.profile.displayName}</strong></div><button type="button" onClick={props.onBack}>تغییر سبک</button></div>
        <div className="video-prompt-card__heading"><div><span className="video-step-kicker">مرحله ۲ از ۳</span><h2 id="video-prompt-heading">عکس را چطور زنده کنیم؟</h2><p>حرکت سوژه، دوربین و فضای صحنه را روشن و کوتاه توضیح دهید.</p></div><Icon name="sparkle" size="1em" className="video-spark" aria-hidden="true" /></div>

        <div className="video-media-field">
          <div className="video-media-field__heading"><label htmlFor="video-input-media">تصویر ورودی خصوصی <b aria-hidden="true">*</b></label><span>اولین فریم ویدیو</span></div>
          <input className="video-upload-input" id="video-input-media" type="file" required accept="image/jpeg,image/png,image/webp" disabled={disabled} aria-describedby="video-media-help" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file) props.onMediaFile(file); }} />
          {!props.media ? <label htmlFor="video-input-media" className={`video-upload-dropzone${dragActive ? ' is-dragging' : ''}${disabled ? ' is-disabled' : ''}`} aria-disabled={disabled} onDragEnter={(event) => { event.preventDefault(); if (!disabled) setDragActive(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false); }} onDrop={handleDrop}>
            <span className="video-upload-dropzone__icon" aria-hidden="true"><Icon name="upload" size="1.6em" /></span>
            <strong>{props.mediaUploading ? 'در حال آماده‌سازی تصویر…' : 'تصویر را اینجا رها کنید'}</strong>
            <span>{props.mediaUploading ? 'چند لحظه صبر کنید' : 'یا برای انتخاب فایل کلیک کنید'}</span>
            <span className="video-upload-dropzone__formats"><b>JPG</b><b>PNG</b><b>WEBP</b><small>حداکثر ۵ مگابایت</small></span>
          </label> : <div className="video-media-preview">
            <div className="video-media-preview__visual">{props.mediaPreviewUrl ? <img src={props.mediaPreviewUrl} alt={`پیش‌نمایش ${props.mediaFilename || 'تصویر ورودی'}`} /> : <Icon name="studio-image" size="2.4em" aria-hidden="true" />}<span aria-hidden="true"><Icon name="check" size="1em" /></span></div>
            <div className="video-media-preview__copy"><strong title={props.mediaFilename}>{props.mediaFilename || 'تصویر ورودی آماده است'}</strong><small>{(props.media.sizeBytes / 1024).toLocaleString('fa-IR', { maximumFractionDigits: 0 })} کیلوبایت · آماده برای ساخت ویدیو</small></div>
            <div className="video-media-preview__actions"><label htmlFor="video-input-media" aria-disabled={disabled}><Icon name="edit" size="1em" aria-hidden="true" /> تعویض تصویر</label><button type="button" onClick={props.onRemoveMedia} disabled={disabled}><Icon name="delete" size="1em" aria-hidden="true" /> حذف</button></div>
          </div>}
          <small id="video-media-help" className="video-media-field__help">فایل فقط برای ساخت همین ویدیو استفاده می‌شود؛ JPEG، PNG یا WebP.</small>
          {props.mediaError ? <p role="alert" className="video-prompt-error">{props.mediaError}</p> : null}
        </div>

        <label className="video-prompt-label" htmlFor="video-prompt"><span>توضیح حرکت <b aria-hidden="true">*</b></span><small>{props.prompt.length}/{maxPromptLength}</small></label>
        <div className="video-textarea-wrap"><Icon name="sparkle" size="1em" className="video-textarea-spark" aria-hidden="true" /><textarea id="video-prompt" value={props.prompt} onChange={(event) => props.setPrompt(event.target.value)} placeholder="مثلاً شخص آرام سرش را برگرداند و لبخند بزند؛ دوربین کمی نزدیک شود…" rows={6} maxLength={maxPromptLength} required aria-invalid={Boolean(promptError)} aria-describedby={promptError ? 'video-prompt-error' : 'video-prompt-help'} /></div>
        {promptError ? <p id="video-prompt-error" className="video-prompt-error" role="alert">{promptError}</p> : <p id="video-prompt-help" className="video-prompt-help">قواعد حفظ هویت و سبک به‌صورت امن در سرور اعمال می‌شوند.</p>}
        <div className="video-submit-dock video-submit-dock--split"><Button type="button" variant="secondary" onClick={props.onBack}>بازگشت</Button><Button type="submit" className="video-generation-form__submit" disabled={Boolean(promptError) || mediaMissing || props.mediaUploading || props.submitting}>ادامه و بازبینی</Button></div>
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
