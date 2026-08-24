import { useEffect, useRef } from 'react';
import { Button } from './design-system/components';
import GenerationStepper from './components/generation/GenerationStepper';
import type { GenerationStepperState } from './components/generation/GenerationStepper';
import type { GalleryImage, ImageTaskStatus } from './services/imageGeneration';
import './ImageGenerationProgressModal.css';

const IMAGE_PROGRESS_STEPS = [
  { id: 'submitted', label: 'درخواست ثبت شد' },
  { id: 'queued', label: 'در صف پردازش' },
  { id: 'processing', label: 'در حال ساخت' },
  { id: 'ready', label: 'تصویر آماده است' }
] as const;

type ImageProgressPresentation = {
  currentStep: number;
  state: GenerationStepperState;
  title: string;
  description: string;
};

export function getImageProgressPresentation(status: ImageTaskStatus): ImageProgressPresentation {
  switch (status) {
    case 'COMPLETED':
      return { currentStep: 3, state: 'success', title: 'تصویر آماده است', description: 'ساخت تصویر با موفقیت تمام شد و خروجی نهایی آماده‌ی مشاهده است.' };
    case 'ERROR':
      return { currentStep: 2, state: 'error', title: 'ساخت تصویر ناموفق بود', description: 'در پردازش این درخواست مشکلی پیش آمد. جزئیات خطا را بررسی کنید و دوباره تلاش کنید.' };
    case 'RUNNING':
      return { currentStep: 2, state: 'active', title: 'جزئیات تصویر در حال ساخته‌شدنه...', description: 'موتور ساخت تصویر در حال پردازش ایده و آماده‌کردن خروجی است.' };
    case 'WAITING':
      return { currentStep: 1, state: 'active', title: 'در صف پردازش تصویر هستی...', description: 'درخواست ثبت شده و به‌زودی وارد مرحله‌ی ساخت می‌شود.' };
    case 'QUEUE':
    default:
      return { currentStep: 1, state: 'active', title: 'دارم ایده‌ات رو آماده می‌کنم...', description: 'درخواستت ثبت شده و سامانه در حال آماده‌کردن ساخت تصویر است.' };
  }
}

function formatImageElapsed(createdAt: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000));
  return seconds < 60 ? 'کمتر از یک دقیقه' : `${Math.floor(seconds / 60).toLocaleString('fa-IR')} دقیقه`;
}

type Props = {
  item: GalleryImage;
  onClose: () => void;
  onView: () => void;
  onRetry: () => void;
};

export default function ImageGenerationProgressModal({ item, onClose, onView, onRetry }: Props) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const presentation = getImageProgressPresentation(item.status);
  const terminal = item.status === 'COMPLETED' || item.status === 'ERROR';

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

  return <div className="image-progress-modal__backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} className="image-progress-modal" role="dialog" aria-modal="true" aria-labelledby="image-progress-title" aria-describedby="image-progress-description" dir="rtl">
      <header className="image-progress-modal__header">
        <div>
          <span className="image-progress-modal__eyebrow">ساخت تصویر</span>
          <h2 id="image-progress-title">{presentation.title}</h2>
        </div>
        <button ref={closeButtonRef} type="button" className="image-progress-modal__close" onClick={onClose} aria-label="بستن وضعیت ساخت" title="بستن">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </header>

      <p id="image-progress-description" className="image-progress-modal__description" aria-live="polite">{presentation.description}</p>
      <GenerationStepper steps={IMAGE_PROGRESS_STEPS} currentStep={presentation.currentStep} state={presentation.state} ariaLabel="مراحل واقعی ساخت تصویر" />

      <div className="image-progress-modal__status" aria-live="polite">
        <span className={`image-progress-modal__status-badge image-progress-modal__status-badge--${item.status.toLowerCase()}`}>
          {!terminal ? <i aria-hidden="true" /> : item.status === 'COMPLETED' ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7" /></svg> : <strong aria-hidden="true">!</strong>}
          <span>{item.status === 'COMPLETED' ? 'تصویر آماده است' : item.status === 'ERROR' ? 'ساخت ناموفق بود' : 'در حال ساخت'}</span>
        </span>
        <span>زمان سپری‌شده: {formatImageElapsed(item.createdAt)}</span>
      </div>

      {item.error ? <div className="image-progress-modal__error" role="alert"><strong>جزئیات خطا</strong><span>{item.error}</span></div> : null}
      {!terminal ? <p className="image-progress-modal__hint">می‌توانی این پنجره را ببندی؛ ساخت تصویر در پس‌زمینه ادامه پیدا می‌کند و کارت آن در «تصاویر من» به‌روزرسانی می‌شود.</p> : null}

      <footer className="image-progress-modal__actions">
        {item.status === 'COMPLETED' ? <Button type="button" onClick={onView}>مشاهده تصویر</Button> : null}
        {item.status === 'ERROR' ? <Button type="button" variant="secondary" onClick={onRetry}>تلاش دوباره</Button> : null}
        <Button type="button" variant={item.status === 'COMPLETED' ? 'secondary' : 'primary'} onClick={onClose}>بستن</Button>
      </footer>
    </div>
  </div>;
}
