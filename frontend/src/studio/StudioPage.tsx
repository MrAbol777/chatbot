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
    description: 'از متن یا تصویر، ویدیوی هوش مصنوعی بساز',
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
          <Button type="button" variant="ghost" className="danoa-studio-page__back" onClick={onBackToHome}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18 9 12l6-6" /></svg>
            بازگشت به خانه
          </Button>
          <div className="danoa-studio-page__brand" aria-label="استودیو دانوآ">
            <span aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 8h3v3H8zM13 8h3v3h-3zM8 13h3v3H8zM13 13h3v3h-3z" /></svg></span>
            <strong>دانوآ</strong>
          </div>
        </header>

        <section className="danoa-studio-page__hero" aria-labelledby="studio-title">
          <span className="danoa-studio-page__eyebrow">ابزارهای خلاقانه</span>
          <h1 id="studio-title">استودیو دانوآ</h1>
          <p>ابزار موردنظرت را برای ساخت محتوای خلاقانه انتخاب کن</p>
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
