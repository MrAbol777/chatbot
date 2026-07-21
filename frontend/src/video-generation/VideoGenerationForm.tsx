import { FormEvent } from 'react';
import { Button, InlineMessage } from '../design-system/components';
import type { VideoGenerationOption } from './video-generation.types';

type Props = { models: VideoGenerationOption[]; featureEnabled?: boolean; loading: boolean; error: string; onRetry: () => void; modelKey: string; setModelKey: (value: string) => void; prompt: string; setPrompt: (value: string) => void; aspectRatio: string; setAspectRatio: (value: string) => void; duration: string; setDuration: (value: string) => void; quality: string; setQuality: (value: string) => void; submitting: boolean; onSubmit: () => void };

const ratioClass = (ratio: string) => `video-ratio-shape video-ratio-shape--${ratio.replace(':', '-')}`;

export default function VideoGenerationForm(props: Props) {
  const model = props.models.find((item) => item.internalKey === props.modelKey);
  const promptError = !props.prompt.trim() ? 'توضیحات ویدیو را وارد کنید.' : props.prompt.trim().length < 3 ? 'توضیحات ویدیو باید حداقل ۳ کاراکتر باشد.' : model?.maxPromptLength != null && props.prompt.length > model.maxPromptLength ? `حداکثر ${model.maxPromptLength} کاراکتر مجاز است.` : '';
  const submit = (event: FormEvent) => { event.preventDefault(); props.onSubmit(); };
  const ideas = ['یک حرکت سینمایی در جنگل مه‌آلود', 'نمای نزدیک محصول با نور نرم', 'شهر خیالی در غروب'];
  const ratioTitle = (ratio: string) => ratio === '16:9' ? 'افقی' : ratio === '9:16' ? 'عمودی' : 'مربع';
  const usage = model ? `${model.quotaUnits} واحد سهمیه` : '—';

  return <form className="video-studio-create" onSubmit={submit} noValidate aria-busy={props.submitting}>
    {props.loading ? <p className="video-loading" role="status">در حال دریافت مدل‌ها…</p> : props.error ? <div className="video-form-message"><p className="video-error" role="alert">{props.error}</p><Button type="button" variant="secondary" onClick={props.onRetry}>دریافت دوباره</Button></div> : props.featureEnabled === false ? <InlineMessage variant="help" text="ساخت ویدیو فعلاً توسط مدیر سامانه فعال نشده است." /> : !props.models.length ? <InlineMessage variant="help" text="فعلاً مدل فعالی برای ساخت ویدیو تنظیم نشده است." /> : <div className="video-studio-create__grid">
      <section className="video-prompt-card" aria-labelledby="video-prompt-heading">
        <div className="video-prompt-card__heading"><div><h2 id="video-prompt-heading">چی توی ذهنت داری؟</h2><p>صحنه، حرکت دوربین، نور و حس ویدیو را با چند کلمه توضیح بده.</p></div><span aria-hidden="true" className="video-spark">✦</span></div>
        <label className="video-prompt-label" htmlFor="video-prompt"><span>توضیحات ویدیو</span><small>{model?.maxPromptLength == null ? `${props.prompt.length} کاراکتر` : `${props.prompt.length}/${model.maxPromptLength}`}</small></label>
        <div className="video-textarea-wrap"><span aria-hidden="true" className="video-textarea-spark">✦</span><textarea id="video-prompt" value={props.prompt} onChange={(event) => props.setPrompt(event.target.value)} placeholder="مثلاً یک خیابان بارانی در شب، نور نئون، دوربین آرام از میان جمعیت عبور می‌کند…" rows={6} maxLength={model?.maxPromptLength ?? undefined} aria-invalid={Boolean(promptError)} aria-describedby={promptError ? 'video-prompt-error' : 'video-prompt-help'} /> </div>
        {promptError ? <p id="video-prompt-error" className="video-prompt-error" role="alert">{promptError}</p> : <p id="video-prompt-help" className="video-prompt-help">برای نتیجه بهتر، موضوع، نور، حس و حرکت دوربین را بنویس.</p>}
        <div className="video-idea-section"><span>برای شروع، یکی را انتخاب کن</span><div className="video-ideas">{ideas.map((idea) => <button key={idea} type="button" onClick={() => props.setPrompt(idea)}>{idea}</button>)}</div></div>
        <div className="video-submit-dock"><Button type="submit" className="video-generation-form__submit" disabled={!model || Boolean(promptError) || props.submitting} loading={props.submitting}>{props.submitting ? 'در حال ثبت درخواست…' : 'ساخت ویدیو'}</Button><small>ساخت ویدیو ممکن است چند لحظه زمان ببرد.</small></div>
      </section>
      <aside className="video-settings-card" aria-label="تنظیمات ویدیو">
        <div className="video-settings-heading"><span aria-hidden="true" className="video-settings-icon">✦</span><div><h2>تنظیمات ویدیو</h2><p>قاب و مدت خروجی را انتخاب کن</p></div></div>
        <label className="video-model-field" htmlFor="video-model"><span>مدل ساخت ویدیو</span><select id="video-model" value={props.modelKey} onChange={(event) => props.setModelKey(event.target.value)}><option value="">مدل را انتخاب کنید</option>{props.models.map((item) => <option key={item.internalKey} value={item.internalKey}>{item.displayNameFa}</option>)}</select></label>
        <fieldset className="video-setting-field"><legend>نسبت تصویر</legend><div className="video-option-cards">{model?.allowedAspectRatios.map((ratio) => <button key={ratio} type="button" className={props.aspectRatio === ratio ? 'is-selected' : ''} onClick={() => props.setAspectRatio(ratio)} aria-pressed={props.aspectRatio === ratio}><span className={ratioClass(ratio)} aria-hidden="true" /><span>{ratioTitle(ratio)}</span><small>{ratio}</small>{props.aspectRatio === ratio ? <b aria-label="انتخاب‌شده">✓</b> : null}</button>)}</div></fieldset>
        <fieldset className="video-setting-field"><legend>مدت ویدیو</legend><div className="video-duration-options">{model?.allowedDurations.map((value) => <button key={value} type="button" className={props.duration === value ? 'is-selected' : ''} onClick={() => props.setDuration(value)} aria-pressed={props.duration === value}><strong>{value}</strong><span>ثانیه</span></button>)}</div></fieldset>
        {model?.allowedQualities.length ? <label className="video-model-field" htmlFor="video-quality"><span>کیفیت</span><select id="video-quality" value={props.quality} onChange={(event) => props.setQuality(event.target.value)}>{model.allowedQualities.map((value) => <option key={value} value={value}>{value}</option>)}</select></label> : null}
        <div className="video-output-summary"><span>خروجی انتخاب‌شده</span><strong>{ratioTitle(props.aspectRatio)} <em>{props.aspectRatio}</em></strong><p>{props.duration} ثانیه · MP4 · {usage}</p></div>
        <p className="video-i2v-note">تصویر به ویدیو به‌زودی</p>
      </aside>
    </div>}
  </form>;
}
