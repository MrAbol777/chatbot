import { useEffect, useRef } from 'react';
import { Button } from '../design-system/components';
import GenerationStepper from '../components/generation/GenerationStepper';
import type { GenerationStepperState } from '../components/generation/GenerationStepper';
import { statusLabel } from './video-generation.constants';
import type { VideoGenerationDetail } from './video-generation.types';
import VideoGenerationStatus from './VideoGenerationStatus';
import { formatElapsed, normalizeVideoStatus } from './video-generation.utils';
import './VideoGenerationProgressModal.css';

const VIDEO_PROGRESS_STEPS = [
  { id: 'submitted', label: 'درخواست ثبت شد' },
  { id: 'queued', label: 'در صف پردازش' },
  { id: 'processing', label: 'در حال ساخت' },
  { id: 'storing', label: 'آماده‌سازی خروجی' },
  { id: 'ready', label: 'ویدیو آماده است' }
] as const;

type ProgressPresentation = {
  currentStep: number;
  state: GenerationStepperState;
  title: string;
  description: string;
};

export function getVideoProgressPresentation(status: string): ProgressPresentation {
  switch (normalizeVideoStatus(status)) {
    case 'succeeded':
      return { currentStep: 4, state: 'success', title: 'ویدیو آماده است', description: 'ساخت ویدیو با موفقیت تمام شد و فایل نهایی آماده‌ی مشاهده است.' };
    case 'storing':
      return { currentStep: 3, state: 'active', title: 'در حال آماده‌سازی فایل نهایی', description: 'ساخت تمام شده و سامانه در حال آماده‌سازی فایل قابل‌مشاهده است.' };
    case 'processing':
      return { currentStep: 2, state: 'active', title: 'ویدیو در حال ساخته‌شدن است', description: 'درخواست شما توسط موتور ساخت ویدیو در حال پردازش است.' };
    case 'failed':
      return { currentStep: 2, state: 'error', title: 'ساخت ویدیو ناموفق بود', description: 'در پردازش این درخواست مشکلی پیش آمد. جزئیات خطا را بررسی کنید.' };
    case 'cancelled':
      return { currentStep: 2, state: 'error', title: 'ساخت ویدیو لغو شد', description: 'این درخواست دیگر پردازش نمی‌شود و می‌توانید دوباره از فرم ساخت شروع کنید.' };
    case 'expired':
      return { currentStep: 2, state: 'error', title: 'زمان پردازش به پایان رسید', description: 'پردازش این درخواست بیش از زمان مجاز طول کشید. دوباره تلاش کنید.' };
    case 'provider_status_unknown':
      return { currentStep: 2, state: 'warning', title: 'وضعیت سرویس نیازمند بررسی است', description: 'وضعیت Provider فعلاً مشخص نیست؛ چند لحظه بعد دوباره بررسی می‌شود.' };
    case 'unknown':
      return { currentStep: 1, state: 'warning', title: 'وضعیت ساخت در حال بررسی است', description: 'هنوز وضعیت دقیق درخواست از سرویس دریافت نشده است.' };
    case 'queued':
    case 'routing':
    case 'submitting':
    case 'submitted':
    default:
      return { currentStep: 1, state: 'active', title: 'درخواست شما ثبت شد', description: 'درخواست در صف پردازش قرار گرفته و ساخت به‌زودی شروع می‌شود.' };
  }
}

type Props = {
  generation: VideoGenerationDetail;
  onClose: () => void;
  onView: () => void;
  onBackToForm: () => void;
};

function getGenerationError(generation: VideoGenerationDetail) {
  return generation.safe_error_message || generation.safeErrorMessage || '';
}

export default function VideoGenerationProgressModal({ generation, onClose, onView, onBackToForm }: Props) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const presentation = getVideoProgressPresentation(generation.status);
  const normalizedStatus = normalizeVideoStatus(generation.status);
  const terminal = ['succeeded', 'failed', 'cancelled', 'expired'].includes(normalizedStatus);
  const errorMessage = getGenerationError(generation);

  useEffect(() => {
    const previousActiveElement = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousActiveElement?.focus?.();
    };
  }, [onClose]);

  return <div className="video-progress-modal__backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} className="video-progress-modal" role="dialog" aria-modal="true" aria-labelledby="video-progress-title" aria-describedby="video-progress-description" dir="rtl">
      <header className="video-progress-modal__header">
        <div>
          <span className="video-progress-modal__eyebrow">ساخت ویدیو</span>
          <h2 id="video-progress-title">{presentation.title}</h2>
        </div>
        <button ref={closeButtonRef} type="button" className="video-progress-modal__close" onClick={onClose} aria-label="بستن وضعیت ساخت" title="بستن">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </header>

      <p id="video-progress-description" className="video-progress-modal__description" aria-live="polite">{presentation.description}</p>

      <section className="video-progress-modal__status" aria-label="وضعیت کنونی درخواست">
        <div className="video-progress-modal__status-copy" aria-live="polite">
          <span>وضعیت کنونی</span>
          <VideoGenerationStatus status={generation.status} live />
        </div>
        <dl className="video-progress-modal__meta">
          <div>
            <dt>زمان سپری‌شده</dt>
            <dd>{formatElapsed(generation.created_at)}</dd>
          </div>
        </dl>
      </section>

      <section className="video-progress-modal__progress-card" aria-label="روند ساخت ویدیو">
        <div className="video-progress-modal__section-heading">
          <span>روند ساخت</span>
          <strong>مرحله {presentation.currentStep + 1} از {VIDEO_PROGRESS_STEPS.length}</strong>
        </div>
        <GenerationStepper compact steps={VIDEO_PROGRESS_STEPS} currentStep={presentation.currentStep} state={presentation.state} ariaLabel="مراحل واقعی ساخت ویدیو" />
      </section>

      {errorMessage ? <div className="video-progress-modal__error" role="alert"><strong>{statusLabel[normalizedStatus] || 'خطای ساخت ویدیو'}</strong><span>{errorMessage}</span></div> : null}

      {!terminal && presentation.state !== 'warning' ? <p className="video-progress-modal__hint">می‌توانی این پنجره را ببندی؛ ساخت ویدیو در پس‌زمینه ادامه پیدا می‌کند و وضعیت آن در «ویدیوهای من» به‌روزرسانی می‌شود.</p> : null}

      <footer className="video-progress-modal__actions">
        {normalizedStatus === 'succeeded' ? <Button type="button" onClick={onView}>مشاهده ویدیو</Button> : null}
        {['failed', 'cancelled', 'expired'].includes(normalizedStatus) ? <Button type="button" variant="secondary" onClick={onBackToForm}>بازگشت به فرم ساخت</Button> : null}
        <Button type="button" variant={normalizedStatus === 'succeeded' ? 'secondary' : 'primary'} onClick={onClose}>بستن</Button>
      </footer>
    </div>
  </div>;
}
