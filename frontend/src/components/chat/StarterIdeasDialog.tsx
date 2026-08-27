import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '../../design-system/components';
import Icon, { type IconName } from '../Icon';
import './StarterIdeasDialog.css';

type IdeaCategoryId = 'learning' | 'content' | 'work' | 'life' | 'creative';

type IdeaCategory = {
  id: IdeaCategoryId;
  label: string;
  icon: IconName;
};

type StarterIdea = {
  id: string;
  category: IdeaCategoryId;
  title: string;
  prompt: string;
};

export const STARTER_IDEA_CATEGORIES: IdeaCategory[] = [
  { id: 'learning', label: 'یادگیری و تحقیق', icon: 'book' },
  { id: 'content', label: 'محتوا و نوشتن', icon: 'edit' },
  { id: 'work', label: 'کار و تصمیم‌گیری', icon: 'briefcase' },
  { id: 'life', label: 'زندگی و برنامه‌ریزی', icon: 'clock' },
  { id: 'creative', label: 'خلاقیت و سرگرمی', icon: 'sparkles' }
];

export const STARTER_IDEAS: StarterIdea[] = [
  { id: 'learn-plan', category: 'learning', title: 'برنامهٔ یادگیری شخصی', prompt: 'برای یادگیری یک مهارت جدید، یک برنامهٔ ۱۴ روزهٔ مرحله‌به‌مرحله با تمرین روزانه برایم بساز.' },
  { id: 'learn-simple', category: 'learning', title: 'توضیح خیلی ساده', prompt: 'یک مفهوم پیچیده را با مثال‌های روزمره و یک تشبیه ساده برایم توضیح بده.' },
  { id: 'learn-compare', category: 'learning', title: 'مقایسهٔ دو انتخاب', prompt: 'دو روش یا ابزار را از نظر مزایا، معایب، هزینه و مناسب‌بودن برای افراد مختلف مقایسه کن.' },
  { id: 'learn-research', category: 'learning', title: 'نقشهٔ تحقیق', prompt: 'برای تحقیق دربارهٔ یک موضوع، سؤال‌های کلیدی، منابع موردنیاز و مسیر بررسی را به شکل چک‌لیست آماده کن.' },
  { id: 'learn-quiz', category: 'learning', title: 'مربی پرسش‌محور', prompt: 'مثل یک مربی از من سؤال‌های کوتاه بپرس تا دانسته‌هایم دربارهٔ موضوعی که انتخاب می‌کنم سنجیده شود.' },

  { id: 'content-ideas', category: 'content', title: '۲۰ ایدهٔ محتوایی', prompt: 'برای موضوع و مخاطبی که مشخص می‌کنم، ۲۰ ایدهٔ محتوایی تازه با زاویه‌های متفاوت پیشنهاد بده.' },
  { id: 'content-carousel', category: 'content', title: 'پست اسلایدی', prompt: 'موضوع من را به یک پست اسلایدی جذاب با هوک، بدنهٔ منظم و دعوت به اقدام تبدیل کن.' },
  { id: 'content-video', category: 'content', title: 'سناریوی ویدیوی کوتاه', prompt: 'یک سناریوی ویدیوی کوتاه ۶۰ ثانیه‌ای با شروع کنجکاوی‌برانگیز، ریتم سریع و پایان به‌یادماندنی بنویس.' },
  { id: 'content-rewrite', category: 'content', title: 'بازنویسی حرفه‌ای', prompt: 'متنی که می‌فرستم را شفاف‌تر، طبیعی‌تر و حرفه‌ای‌تر بازنویسی کن و لحن اصلی آن را حفظ کن.' },
  { id: 'content-calendar', category: 'content', title: 'تقویم محتوایی', prompt: 'برای یک ماه، تقویم محتوایی متنوع با موضوع، قالب، هدف و پیشنهاد عنوان آماده کن.' },

  { id: 'work-decision', category: 'work', title: 'ماتریس تصمیم‌گیری', prompt: 'برای تصمیمی که دارم یک ماتریس تصمیم‌گیری بساز، معیارها را وزن بده و نتیجه را با استدلال توضیح بده.' },
  { id: 'work-project', category: 'work', title: 'شکستن پروژه به قدم‌ها', prompt: 'پروژه‌ای که توضیح می‌دهم را به قدم‌های کوچک، اولویت‌بندی‌شده و قابل انجام تبدیل کن.' },
  { id: 'work-product', category: 'work', title: 'بهبود یک محصول', prompt: 'برای بهبود تجربهٔ یک محصول یا سرویس، ایده‌های کم‌هزینه، میان‌مدت و جسورانه پیشنهاد بده.' },
  { id: 'work-meeting', category: 'work', title: 'جلسهٔ نتیجه‌محور', prompt: 'برای جلسه‌ای که توضیح می‌دهم دستورجلسه، سؤال‌های کلیدی و خروجی‌های موردانتظار بنویس.' },
  { id: 'work-email', category: 'work', title: 'ایمیل دقیق و کوتاه', prompt: 'منظورم را به یک ایمیل کوتاه، محترمانه و نتیجه‌محور تبدیل کن.' },

  { id: 'life-week', category: 'life', title: 'برنامهٔ هفتهٔ متعادل', prompt: 'با توجه به کارها و محدودیت‌هایم، یک برنامهٔ هفتگی متعادل با زمان استراحت و حاشیهٔ امن بساز.' },
  { id: 'life-trip', category: 'life', title: 'سفر متفاوت', prompt: 'برای مقصد، بودجه و زمان من یک برنامهٔ سفر کاربردی با تجربه‌های کمتر تکراری طراحی کن.' },
  { id: 'life-habit', category: 'life', title: 'ساختن یک عادت', prompt: 'برای عادتی که می‌خواهم بسازم، یک مسیر ساده با محرک، پاداش و راهکار روزهای سخت پیشنهاد بده.' },
  { id: 'life-budget', category: 'life', title: 'بودجه‌بندی ساده', prompt: 'برای درآمد و هزینه‌هایی که می‌گویم، یک الگوی بودجه‌بندی قابل اجرا و بدون پیچیدگی طراحی کن.' },
  { id: 'life-conversation', category: 'life', title: 'آمادگی برای گفت‌وگوی سخت', prompt: 'کمکم کن برای یک گفت‌وگوی حساس آماده شوم؛ شروع مناسب، نکات اصلی و پاسخ‌های آرام را پیشنهاد بده.' },

  { id: 'creative-story', category: 'creative', title: 'جرقهٔ یک داستان', prompt: 'یک ایدهٔ داستانی غیرقابل‌پیش‌بینی با شخصیت اصلی، تعارض و پایان احتمالی خلق کن.' },
  { id: 'creative-name', category: 'creative', title: 'نام‌های به‌یادماندنی', prompt: 'برای ایده یا برندی که توضیح می‌دهم، نام‌های کوتاه و خلاق همراه با منطق هر نام پیشنهاد بده.' },
  { id: 'creative-future', category: 'creative', title: 'محصولی از آینده', prompt: 'یک محصول آینده‌نگرانه برای حل یک مشکل روزمره طراحی کن و تجربهٔ استفاده از آن را توضیح بده.' },
  { id: 'creative-debate', category: 'creative', title: 'مناظرهٔ دو متخصص', prompt: 'دو دیدگاه متخصص و مخالف را دربارهٔ موضوعی که می‌گویم شبیه‌سازی کن و در پایان نقاط توافق را جمع‌بندی کن.' },
  { id: 'creative-challenge', category: 'creative', title: 'چالش خلاقانهٔ امروز', prompt: 'یک چالش خلاقانهٔ ۲۰ دقیقه‌ای متناسب با علایقم طراحی کن که خروجی ملموس داشته باشد.' }
];

type StarterIdeasDialogProps = {
  open: boolean;
  onClose: () => void;
  onSelectIdea: (prompt: string) => void;
};

const normalizeSearch = (value: string) => value.trim().toLocaleLowerCase('fa');

function StarterIdeasDialog({ open, onClose, onSelectIdea }: StarterIdeasDialogProps) {
  const [activeCategory, setActiveCategory] = useState<'all' | IdeaCategoryId>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    setActiveCategory('all');
    setSearchQuery('');
  }, [open]);

  const categoryMap = useMemo(
    () => new Map(STARTER_IDEA_CATEGORIES.map((category) => [category.id, category])),
    []
  );

  const visibleIdeas = useMemo(() => {
    const query = normalizeSearch(searchQuery);
    return STARTER_IDEAS.filter((idea) => {
      const matchesCategory = activeCategory === 'all' || idea.category === activeCategory;
      const categoryLabel = categoryMap.get(idea.category)?.label || '';
      const matchesSearch = !query || normalizeSearch(`${idea.title} ${idea.prompt} ${categoryLabel}`).includes(query);
      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, categoryMap, searchQuery]);

  const selectIdea = (prompt: string) => {
    onSelectIdea(prompt);
    onClose();
  };

  return (
    <Dialog open={open} title="ایده‌ای برای شروع پیدا کن" onClose={onClose} showFooter={false} panelClassName="starter-ideas-dialog">
      <div className="starter-ideas-dialog__body" dir="rtl">
        <p className="starter-ideas-dialog__intro">
          یک مسیر انتخاب کن یا میان ایده‌ها بگرد؛ با انتخاب هر مورد، متن آماده داخل کادر پیام قرار می‌گیرد.
        </p>

        <label className="starter-ideas-dialog__search">
          <Icon name="search" size={19} aria-hidden="true" />
          <span className="visually-hidden">جست‌وجوی ایده‌ها</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="مثلاً یادگیری، سفر یا تولید محتوا..."
          />
        </label>

        <div className="starter-ideas-dialog__filters" role="group" aria-label="دسته‌بندی ایده‌ها">
          <button type="button" className={activeCategory === 'all' ? 'is-active' : ''} aria-pressed={activeCategory === 'all'} onClick={() => setActiveCategory('all')}>
            همهٔ ایده‌ها
          </button>
          {STARTER_IDEA_CATEGORIES.map((category) => (
            <button
              key={category.id}
              type="button"
              className={activeCategory === category.id ? 'is-active' : ''}
              aria-pressed={activeCategory === category.id}
              onClick={() => setActiveCategory(category.id)}
            >
              <Icon name={category.icon} size={15} aria-hidden="true" />
              {category.label}
            </button>
          ))}
        </div>

        <div className="starter-ideas-dialog__results" aria-live="polite">
          <div className="starter-ideas-dialog__count">
            <strong>{visibleIdeas.length.toLocaleString('fa-IR')}</strong>
            <span>ایده برای شروع</span>
          </div>

          {visibleIdeas.length ? (
            <div className="starter-ideas-dialog__grid">
              {visibleIdeas.map((idea) => {
                const category = categoryMap.get(idea.category);
                return (
                  <button key={idea.id} type="button" className="starter-idea-card" onClick={() => selectIdea(idea.prompt)}>
                    <span className="starter-idea-card__icon" aria-hidden="true">
                      <Icon name={category?.icon || 'lightbulb'} size={18} />
                    </span>
                    <span className="starter-idea-card__copy">
                      <strong>{idea.title}</strong>
                      <small>{idea.prompt}</small>
                    </span>
                    <Icon className="starter-idea-card__arrow" name="chevron-left" size={16} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="starter-ideas-dialog__empty" role="status">
              <Icon name="search" size={22} aria-hidden="true" />
              <strong>ایده‌ای با این عبارت پیدا نشد</strong>
              <span>عبارت کوتاه‌تری بنویس یا دستهٔ دیگری را انتخاب کن.</span>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

export default StarterIdeasDialog;
