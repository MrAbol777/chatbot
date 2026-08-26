import { useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
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
  setResolution?: (value: string) => void;
  inputMedia: VideoInputMedia | null;
  inputMediaFileName: string;
  inputMediaPreviewUrl: string;
  imageInputAvailable: boolean;
  mediaUploading: boolean;
  mediaError: string;
  onMediaSelect: (file: File) => void;
  onMediaRemove: () => void;
  submitting: boolean;
  onBack: () => void;
  onReview: () => void;
};

const PROMPT_IDEAS = [
  'یک شهر آینده‌نگر در شب، نورهای نئونی و حرکت آرام دوربین',
  'یک گربهٔ فضانورد روی ماه، سبک شاد و رنگارنگ',
  'موج‌های آرام دریا هنگام طلوع، نمای سینمایی و مه ملایم'
];
const ratioClass = (ratio: string) => `video-ratio-shape video-ratio-shape--${ratio.replace(':', '-')}`;
const faNumber = (value: number | string) => Number(value).toLocaleString('fa-IR');

export default function VideoGenerationForm(props: Props) {
  const [promptTouched, setPromptTouched] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const settingsPanelId = useId();
  const fileInputId = useId();
  const maxPromptLength = props.capability?.maxPromptLength ?? 2000;
  const promptError = !props.prompt.trim() ? 'ایدهٔ ویدیو را بنویسید.' : props.prompt.trim().length < 3 ? 'ایده باید حداقل ۳ کاراکتر باشد.' : props.prompt.length > maxPromptLength ? `حداکثر ${maxPromptLength} کاراکتر مجاز است.` : '';
  const submit = (event: FormEvent) => { event.preventDefault(); if (!promptError && !props.mediaUploading) props.onReview(); };
  const ratioTitle = (ratio: string) => ratio === '16:9' ? 'افقی' : ratio === '9:16' ? 'عمودی' : 'مربع';
  const durationValues = [...new Set((props.capability?.allowedDurations || []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  const durationMin = durationValues[0] ?? 1;
  const durationMax = durationValues[durationValues.length - 1] ?? 15;
  const selectedDuration = Number(props.duration) || durationMin;
  const setDuration = (rawValue: string) => {
    const numericValue = Math.max(durationMin, Math.min(durationMax, Math.round(Number(rawValue))));
    if (durationValues.includes(numericValue)) props.setDuration(String(numericValue));
  };
  const selectMedia = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = '';
    if (file) props.onMediaSelect(file);
  };
  const usingImage = Boolean(props.inputMedia || props.mediaUploading);

  return <form className="video-studio-create" onSubmit={submit} noValidate aria-busy={props.submitting || props.mediaUploading}>
    {props.loading ? <p className="video-loading" role="status">در حال دریافت تنظیمات معتبر…</p> : props.error ? <div className="video-form-message"><p className="video-error" role="alert">{props.error}</p><Button type="button" variant="secondary" onClick={props.onRetry}>دریافت دوباره</Button></div> : props.featureEnabled === false || !props.capability ? <InlineMessage variant="help" text="ساخت ویدیو از متن فعلاً توسط مدیر سامانه فعال نشده است." /> : <div className="video-studio-create__grid">
      <section className="video-prompt-card video-prompt-card--text" aria-labelledby="video-prompt-heading">
        <div className="video-selected-style"><span aria-hidden="true"><Icon name="sparkle" size="1em" /></span><div><small>سبک انتخاب‌شده</small><strong>{props.profile.displayName}</strong></div><button type="button" onClick={props.onBack}>تغییر سبک</button></div>
        <div className="video-mode-banner"><span aria-hidden="true"><Icon name="sparkle" size="1.1em" /></span><div><strong>{usingImage ? 'تصویر به ویدیو' : 'متن یا تصویر به ویدیو'}</strong><small>{usingImage ? 'تصویر، قاب شروع ویدیو است؛ با متن حرکت و اتفاق صحنه را توضیح بده.' : 'ایده را بنویس یا از بخش کناری یک تصویر مرجع اضافه کن.'}</small></div><b>AI</b></div>
        <div className="video-prompt-card__heading"><div><span className="video-step-kicker">مرحله ۲ از ۳</span><h2 id="video-prompt-heading">چه ویدیویی بسازیم؟</h2><p>سوژه، فضا و نوع حرکت را ساده و روشن توصیف کن.</p></div><Icon name="sparkle" size="1em" className="video-spark" aria-hidden="true" /></div>

        <label className="video-prompt-label" htmlFor="video-prompt"><span>ایدهٔ ویدیو <b aria-hidden="true">*</b></span><small>{faNumber(props.prompt.length)}/{faNumber(maxPromptLength)}</small></label>
        <div className="video-textarea-wrap"><Icon name="sparkle" size="1em" className="video-textarea-spark" aria-hidden="true" /><textarea id="video-prompt" value={props.prompt} onChange={(event) => props.setPrompt(event.target.value)} onBlur={() => setPromptTouched(true)} placeholder="مثلاً یک روباه کوچک در جنگل مه‌آلود قدم می‌زند و دوربین آرام دنبالش می‌کند…" rows={7} maxLength={maxPromptLength} required aria-invalid={promptTouched && Boolean(promptError)} aria-describedby={promptTouched && promptError ? 'video-prompt-error' : 'video-prompt-help'} /></div>
        {promptTouched && promptError ? <p id="video-prompt-error" className="video-prompt-error" role="alert">{promptError}</p> : <p id="video-prompt-help" className="video-prompt-help">جزئیات کوتاه مثل نور، حرکت دوربین و حال‌وهوای صحنه نتیجه را بهتر می‌کند.</p>}

        <div className="video-idea-section" aria-labelledby="video-idea-heading"><span id="video-idea-heading">برای شروع، یکی از این ایده‌ها را امتحان کن</span><div className="video-ideas">{PROMPT_IDEAS.map((idea) => <button key={idea} type="button" onClick={() => props.setPrompt(idea)}>{idea}</button>)}</div></div>
        <div className="video-submit-dock video-submit-dock--split"><Button type="button" variant="secondary" onClick={props.onBack}>بازگشت</Button><Button type="submit" className="video-generation-form__submit" disabled={Boolean(promptError) || props.submitting || props.mediaUploading}>{props.mediaUploading ? 'در حال آماده‌سازی تصویر…' : 'ادامه و بازبینی'}</Button></div>
      </section>

      <aside className="video-settings-card" aria-label="تنظیمات و ورودی تصویر ویدیو">
        <section className="video-settings-accordion" aria-label="تنظیمات ویدیو">
          <button type="button" className="video-settings-accordion__summary" onClick={() => setSettingsOpen((open) => !open)} aria-expanded={settingsOpen} aria-controls={settingsPanelId}>
            <span className="video-settings-accordion__title"><span className="video-settings-icon" aria-hidden="true"><Icon name="settings" size="1em" /></span><span><strong>تنظیمات ویدیو</strong><small>قاب، مدت و وضوح خروجی</small></span></span>
            <span className="video-settings-accordion__value"><b>{ratioTitle(props.aspectRatio)} · {faNumber(props.duration)} ثانیه</b><small>{props.resolution || '480p'}</small></span>
            <span className={`video-settings-accordion__chevron${settingsOpen ? ' is-open' : ''}`} aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m7 10 5 5 5-5" /></svg></span>
          </button>
          {settingsOpen ? <div id={settingsPanelId} className="video-settings-accordion__content">
            <fieldset className="video-setting-field"><legend>نسبت تصویر</legend><div className="video-option-cards">{props.capability.allowedAspectRatios.map((ratio) => <button key={ratio} type="button" className={props.aspectRatio === ratio ? 'is-selected' : ''} onClick={() => props.setAspectRatio(ratio)} aria-label={`نسبت ${ratioTitle(ratio)} ${ratio}`} aria-pressed={props.aspectRatio === ratio}><span className={ratioClass(ratio)} aria-hidden="true" /><span>{ratioTitle(ratio)}</span><small>{ratio}</small>{props.aspectRatio === ratio ? <b><Icon name="check" size="1em" aria-hidden="true" /></b> : null}</button>)}</div></fieldset>
            <fieldset className="video-setting-field"><legend>مدت ویدیو</legend><div className="video-duration-control"><div className="video-duration-control__value"><span>مدت خروجی</span><output htmlFor="video-duration-range">{faNumber(selectedDuration)} <small>ثانیه</small></output></div><input id="video-duration-range" type="range" min={durationMin} max={durationMax} step="1" value={selectedDuration} onChange={(event) => setDuration(event.target.value)} aria-label="مدت ویدیو به ثانیه" /><div className="video-duration-control__limits" aria-hidden="true"><span>{faNumber(durationMin)} ثانیه</span><span>{faNumber(durationMax)} ثانیه</span></div></div></fieldset>
            <section className="video-fixed-output" aria-labelledby="video-resolution-heading"><div><span id="video-resolution-heading">وضوح خروجی</span><strong>{props.resolution.toUpperCase()}</strong></div><p><Icon name="check" size="1em" aria-hidden="true" /> خروجی استاندارد برای اشتراک‌گذاری</p></section>
            <div className="video-output-summary"><span>خروجی انتخاب‌شده</span><strong>{ratioTitle(props.aspectRatio)} <em>{props.aspectRatio}</em></strong><p>{faNumber(props.duration)} ثانیه · {props.resolution || '480p'}</p></div>
          </div> : null}
        </section>

        <section className={`video-reference-picker${props.inputMedia ? ' has-media' : ''}`} aria-labelledby="video-reference-title">
          <input ref={fileInputRef} id={fileInputId} className="video-reference-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={selectMedia} disabled={!props.imageInputAvailable || props.mediaUploading || props.submitting} tabIndex={-1} aria-label="انتخاب تصویر مرجع برای ساخت ویدیو" aria-describedby="video-reference-help" />
          {!props.inputMedia ? <button type="button" className="video-reference-picker__empty" onClick={() => fileInputRef.current?.click()} disabled={!props.imageInputAvailable || props.mediaUploading || props.submitting}>
            <span className="video-reference-picker__icon" aria-hidden="true"><Icon name="upload" size="1em" /></span>
            <span><strong id="video-reference-title">افزودن تصویر مرجع</strong><small id="video-reference-help">اختیاری · عکس، قاب شروع ویدیو می‌شود</small></span>
            <span className="video-reference-picker__action" aria-hidden="true">{props.mediaUploading ? 'در حال آپلود…' : 'انتخاب عکس'}</span>
          </button> : <div className="video-reference-picker__preview">
            <div className="video-reference-picker__visual">{props.inputMediaPreviewUrl ? <img src={props.inputMediaPreviewUrl} alt="تصویر مرجع انتخاب‌شده برای ویدیو" /> : <Icon name="upload" size="1.2em" aria-hidden="true" />}</div>
            <div className="video-reference-picker__copy"><strong id="video-reference-title">تصویر مرجع آماده است</strong><small id="video-reference-help">ویدیو از این قاب شروع می‌شود</small><span title={props.inputMediaFileName}>{props.inputMediaFileName}</span></div>
            <div className="video-reference-picker__actions"><button type="button" onClick={() => fileInputRef.current?.click()} disabled={props.mediaUploading || props.submitting}>تغییر تصویر</button><button type="button" onClick={props.onMediaRemove} disabled={props.mediaUploading || props.submitting}>حذف</button></div>
          </div>}
          {!props.imageInputAvailable ? <p className="video-reference-picker__status">ساخت ویدیو از تصویر فعلاً در دسترس نیست.</p> : props.mediaError ? <p className="video-reference-picker__error" role="alert">{props.mediaError}</p> : <p className="video-reference-picker__hint">فرمت‌های JPEG، PNG یا WebP · حداکثر ۵ مگابایت</p>}
        </section>
      </aside>
    </div>}
  </form>;
}
