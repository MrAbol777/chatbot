import { Button } from '../design-system/components';
import StudioToolCard from './StudioToolCard';
import type { StudioTool } from './studio.types';
import './StudioPage.css';

const tools: StudioTool[] = [
  {
    id: 'image',
    title: 'ساخت تصویر',
    description: 'تصویر دلخواهت را با هوش مصنوعی بساز یا ویرایش کن',
    actionLabel: 'شروع ساخت تصویر'
  },
  {
    id: 'video',
    title: 'ساخت ویدیو',
    description: 'ایده‌ات را بنویس و ویدیوی هوش مصنوعی بساز',
    actionLabel: 'شروع ساخت ویدیو'
  }
];

type Props = {
  onBackToHome: () => void;
  onOpenImage: () => void;
  onOpenVideo: () => void;
};

export default function StudioPage({ onBackToHome, onOpenImage, onOpenVideo }: Props) {
  return (
    <main className="danoa-studio-page" dir="rtl">
      <div className="danoa-studio-page__shell">
        <header className="danoa-studio-page__header">
          <div className="danoa-studio-page__brand">
            <span className="danoa-studio-page__brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Z" />
                <path d="m18.5 15 .7 2.8L22 18.5l-2.8.7-.7 2.8-.7-2.8-2.8-.7 2.8-.7.7-2.8Z" />
              </svg>
            </span>
            <span className="danoa-studio-page__brand-copy">
              <h1 id="studio-title">استودیوی دانوآ</h1>
              <small>ایده‌ات را به محتوای خلاق تبدیل کن</small>
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            className="danoa-studio-page__back"
            onClick={onBackToHome}
            aria-label="بازگشت به گفتگو"
            title="بازگشت به گفتگو"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
            <span className="danoa-studio-page__back-label">بازگشت به گفتگو</span>
          </Button>
          <span className="danoa-studio-page__header-spacer" aria-hidden="true" />
        </header>

        <section className="danoa-studio-page__hero" aria-labelledby="studio-title">
          <span className="danoa-studio-page__eyebrow">ابزارهای خلاقانه</span>
          <h2 className="danoa-studio-page__hero-title">ایده‌ات را به واقعیت تبدیل کن</h2>
          <p>ابزار مناسب را برای ساخت محتوای خلاقانه انتخاب کن</p>
        </section>

        <section className="danoa-studio-page__tools" aria-label="ابزارهای استودیو">
          {tools.map((tool) => (
            <StudioToolCard
              key={tool.id}
              tool={tool}
              onOpen={tool.id === 'image' ? onOpenImage : onOpenVideo}
            />
          ))}
        </section>
      </div>
    </main>
  );
}
