import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Card } from './design-system/components';
import './DanuaLanding.css';

type PlanId = string;
type IconName =
  | 'book'
  | 'image'
  | 'story'
  | 'companion'
  | 'shield'
  | 'check'
  | 'plans'
  | 'question'
  | 'plus'
  | 'minus'
  | 'family'
  | 'chat'
  | 'spark'
  | 'login'
  | 'rocket'
  | 'star'
  | 'instagram'
  | 'telegram'
  | 'linkedin';

type IconProps = {
  name: IconName;
  className?: string;
};

function DanuaIcon({ name, className = '' }: IconProps) {
  const common = {
    className: `danua-icon ${className}`.trim(),
    viewBox: '0 0 24 24',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    'aria-hidden': true,
    focusable: 'false'
  } as const;

  switch (name) {
    case 'book':
      return (
        <svg {...common}>
          <path d="M5 5.7c0-1 .8-1.7 1.8-1.5 1.7.2 3.4.8 5.2 1.8v13.2c-1.8-1-3.5-1.6-5.2-1.8A1.6 1.6 0 0 1 5 15.8V5.7Z" />
          <path d="M19 5.7c0-1-.8-1.7-1.8-1.5-1.7.2-3.4.8-5.2 1.8v13.2c1.8-1 3.5-1.6 5.2-1.8a1.6 1.6 0 0 0 1.8-1.6V5.7Z" />
          <path d="M8 8.2h1.5M8 11h1.5M16 8.2h-1.5M16 11h-1.5" />
        </svg>
      );
    case 'image':
      return (
        <svg {...common}>
          <rect x="4" y="5" width="16" height="14" rx="3" />
          <path d="m6.8 16 3.6-3.8 2.6 2.7 1.5-1.7 2.8 2.8" />
          <circle cx="15.8" cy="9.2" r="1.4" />
        </svg>
      );
    case 'story':
      return (
        <svg {...common}>
          <path d="M6 5.5h9.5A2.5 2.5 0 0 1 18 8v10.5H7.7A2.7 2.7 0 0 1 5 15.8V6.5c0-.6.4-1 1-1Z" />
          <path d="M8 9h6M8 12h7M8 15h4" />
          <path d="M18 8.2h.7c.7 0 1.3.6 1.3 1.3v7.2c0 1-.8 1.8-1.8 1.8H18" />
        </svg>
      );
    case 'companion':
      return (
        <svg {...common}>
          <path d="M12 20s-7-3.9-7-9.3A4 4 0 0 1 12 8a4 4 0 0 1 7 2.7C19 16.1 12 20 12 20Z" />
          <path d="M9 11.4c.6.7 1.5 1.1 3 1.1s2.4-.4 3-1.1" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...common}>
          <path d="M12 3.5 19 6v5.4c0 4.1-2.8 7.8-7 9.1-4.2-1.3-7-5-7-9.1V6l7-2.5Z" />
          <path d="m8.8 12.2 2.1 2.1 4.5-4.7" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common}>
          <path d="m6 12.5 3.2 3.2L18 7.3" />
        </svg>
      );
    case 'plans':
      return (
        <svg {...common}>
          <rect x="4" y="6" width="16" height="12" rx="3" />
          <path d="M7.5 10h9M7.5 14h4.4" />
          <path d="M17.5 14.2h.1" />
        </svg>
      );
    case 'question':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M9.8 9.4a2.4 2.4 0 1 1 3.4 2.2c-.9.4-1.2.9-1.2 1.7" />
          <path d="M12 16.7h.1" />
        </svg>
      );
    case 'plus':
      return (
        <svg {...common}>
          <path d="M12 6v12M6 12h12" />
        </svg>
      );
    case 'minus':
      return (
        <svg {...common}>
          <path d="M6 12h12" />
        </svg>
      );
    case 'family':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="2.2" />
          <circle cx="16" cy="8" r="2.2" />
          <circle cx="12" cy="13" r="2" />
          <path d="M4.8 18.5c.4-2.5 2-3.8 4.4-3.8M19.2 18.5c-.4-2.5-2-3.8-4.4-3.8M8.2 20c.4-2.2 1.7-3.2 3.8-3.2s3.4 1 3.8 3.2" />
        </svg>
      );
    case 'chat':
      return (
        <svg {...common}>
          <path d="M6.5 17.5 4 20V7.7C4 5.7 5.7 4 7.7 4h8.6C18.3 4 20 5.7 20 7.7v6.1c0 2-1.7 3.7-3.7 3.7H6.5Z" />
          <path d="M8 9h8M8 12.3h5.6" />
        </svg>
      );
    case 'spark':
      return (
        <svg {...common}>
          <path d="M12 3.8 13.9 9l5.3 1.9-5.3 1.9L12 18l-1.9-5.2-5.3-1.9L10.1 9 12 3.8Z" />
          <path d="m18.2 15.7.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8.8-2.1Z" />
        </svg>
      );
    case 'login':
      return (
        <svg {...common}>
          <path d="M10.5 7.2 15.3 12l-4.8 4.8" />
          <path d="M4 12h11" />
          <path d="M14 5h3.5A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19H14" />
        </svg>
      );
    case 'rocket':
      return (
        <svg {...common}>
          <path d="M13.7 4.4c2.2-.9 4.5-.8 5.9-.5.3 1.4.4 3.7-.5 5.9-.9 2.3-2.8 4.2-5.7 5.7l-4.9-4.9c1.5-2.9 3.4-4.8 5.2-6.2Z" />
          <path d="M9.4 10.1 6 10.7 4.3 14l4.2-.5M13.9 14.6l-.5 4.2 3.3-1.7.6-3.4" />
          <circle cx="15.4" cy="7.9" r="1.4" />
        </svg>
      );
    case 'star':
      return (
        <svg {...common}>
          <path d="m12 4 2.2 4.5 5 .7-3.6 3.5.8 5-4.4-2.4-4.4 2.4.8-5-3.6-3.5 5-.7L12 4Z" />
        </svg>
      );
    case 'instagram':
      return (
        <svg {...common}>
          <rect x="5" y="5" width="14" height="14" rx="4" />
          <circle cx="12" cy="12" r="3.2" />
          <path d="M16.5 7.7h.1" />
        </svg>
      );
    case 'telegram':
      return (
        <svg {...common}>
          <path d="M20 5 4.8 11.2c-.8.3-.8 1.4.1 1.6l3.8 1.1 1.5 4.5c.3.8 1.4.9 1.8.2l2.2-3.1 4 2.8c.7.5 1.6.1 1.8-.8L22 6.5c.2-1-.9-1.8-2-1.5Z" />
          <path d="m8.8 13.8 8-5.1-5.7 6.7" />
        </svg>
      );
    case 'linkedin':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="3" />
          <path d="M8 10.5V16M8 8h.1M12 16v-5.4M12 13.1c0-1.7 1-2.7 2.4-2.7 1.5 0 2.6 1 2.6 3V16" />
        </svg>
      );
    default:
      return null;
  }
}

const features: Array<{
  icon: IconName;
  title: string;
  text: string;
  tone: string;
}> = [
  {
    icon: 'book',
    title: 'کمک درسی',
    text: 'پاسخ ساده و قابل فهم برای درس‌ها',
    tone: 'primary'
  },
  {
    icon: 'image',
    title: 'ساخت تصویر',
    text: 'تبدیل ایده‌های بچه‌ها به تصویر',
    tone: 'blue'
  },
  {
    icon: 'story',
    title: 'داستان‌سازی',
    text: 'ساخت داستان‌های تازه و خلاقانه',
    tone: 'lavender'
  },
  {
    icon: 'companion',
    title: 'همراه امن',
    text: 'گفت‌وگویی آرام، فارسی و مناسب سن',
    tone: 'cyan'
  }
];

type LandingPlan = {
  id: PlanId;
  name: string;
  price: string;
  detail: string;
  items: string[];
  tone: string;
  icon: IconName;
  featured?: boolean;
  label?: string;
};

const fallbackPlans: LandingPlan[] = [
  {
    id: 'free',
    name: 'رایگان',
    price: '۰ تومان',
    detail: 'برای شروع و آشنایی',
    items: ['۲۰ پیام در روز', 'گفت‌وگوی آموزشی و خلاقانه', 'شروع بدون پرداخت'],
    tone: 'free',
    icon: 'spark',
    featured: true,
    label: 'شروع پیشنهادی'
  },
  {
    id: 'gold',
    name: 'طلایی',
    price: '۹۹,۰۰۰ تومان',
    detail: 'ماهانه',
    items: ['پیام بیشتر', 'ساخت تصویر', 'مناسب استفاده خانوادگی'],
    tone: 'gold',
    icon: 'plans',
    label: 'محبوب'
  },
  {
    id: 'diamond',
    name: 'الماسی',
    price: '۱۹۹,۰۰۰ تومان',
    detail: 'ماهانه',
    items: ['پیام نامحدود', 'ساخت تصویر', 'برای استفاده روزانه'],
    tone: 'diamond',
    icon: 'shield'
  }
];

const testimonials = [
  {
    name: 'مادر آرتین، ۹ ساله',
    text: 'تمرین‌ها را ساده توضیح می‌دهد و لحنش برای آرتین آرام و قابل فهم است.'
  },
  {
    name: 'پدر رها، ۱۲ ساله',
    text: 'محیط فارسی و کنترل‌شده برای ما مهم بود؛ رها بیشتر برای داستان‌سازی از دانوآ استفاده می‌کند.'
  },
  {
    name: 'مادر نیما، ۱۰ ساله',
    text: 'دانوآ جواب آماده نمی‌دهد؛ قدم‌به‌قدم کمک می‌کند خودش مسیر حل را بفهمد.'
  }
];

const faqs = [
  {
    question: 'دانوآ برای چه سنینی مناسب است؟',
    answer: 'تمرکز تجربه لندینگ و چت روی بچه‌های ۷ تا ۱۳ سال و همراهی والدین است.'
  },
  {
    question: 'آیا محتوا برای بچه‌ها امن است؟',
    answer: 'دانوآ با پاسخ‌های فارسی، مناسب سن و فضای کنترل‌شده طراحی شده تا والدین با خیال راحت‌تری همراه کودک باشند.'
  },
  {
    question: 'آیا دانوآ تکلیف را کامل به جای کودک انجام می‌دهد؟',
    answer: 'هدف کمک به یادگیری است؛ دانوآ مفهوم را توضیح می‌دهد و کودک را مرحله‌به‌مرحله جلو می‌برد.'
  },
  {
    question: 'ساخت تصویر در کدام پلن‌ها فعال است؟',
    answer: 'دسترسی و سقف ساخت تصویر برای هر پلن از پنل مدیریت تنظیم می‌شود.'
  },
  {
    question: 'می‌توان رایگان شروع کرد؟',
    answer: 'بله، پلن رایگان برای شروع و تجربه اولیه در دسترس است.'
  }
];

const navLinks: Array<{ href: string; label: string; icon: IconName }> = [
  { href: '#features', label: 'قابلیت‌ها', icon: 'spark' },
  { href: '#safety', label: 'اعتماد والدین', icon: 'shield' },
  { href: '#plans', label: 'پلن‌ها', icon: 'plans' },
  { href: '#faq', label: 'سوالات', icon: 'question' }
];

const trustBadges: Array<{ icon: IconName; label: string }> = [
  { icon: 'shield', label: 'مناسب سن' },
  { icon: 'chat', label: 'فارسی و صمیمی' },
  { icon: 'family', label: 'کنار خانواده' }
];

const safetyItems = [
  'محتوای مناسب سن و قابل فهم',
  'پاسخ‌های فارسی با لحن آرام',
  'تمرکز روی یادگیری، نه جایگزینی تلاش کودک'
];

function navigateToChat(mode?: 'signup' | 'login', plan?: PlanId) {
  const params = new URLSearchParams();
  if (mode) params.set('auth', mode);
  if (plan) {
    params.set('plan', plan);
    try {
      localStorage.setItem('selected_plan', JSON.stringify({ id: plan, billingCycle: 'monthly' }));
    } catch {
      /* persistence is best-effort */
    }
  }
  const qs = params.toString();
  const nextPath = qs ? `/chat?${qs}` : '/chat';
  if (typeof window !== 'undefined' && window.location.pathname + window.location.search !== nextPath) {
    window.location.assign(nextPath);
  }
}

function PlanIcon({ children }: { children: ReactNode }) {
  return <span className="danua-plan-icon" aria-hidden="true">{children}</span>;
}

function DanuaLanding() {
  const [openFaq, setOpenFaq] = useState<number>(-1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [plans, setPlans] = useState<LandingPlan[]>([]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  useEffect(() => {
    let cancelled = false;

    const loadPlans = async () => {
      try {
        const response = await fetch('/api/subscription-plans');
        if (!response.ok) return;
        const payload = await response.json();
        if (cancelled || !Array.isArray(payload.plans)) return;

        const nextPlans = payload.plans
          .filter((plan: any) => plan && typeof plan.id === 'string')
          .map((plan: any) => {
            const monthlyPrice = Number(plan.monthlyPrice ?? plan.price ?? 0);
            const isFree = monthlyPrice <= 0;
            const isGold = plan.id === 'gold';
            return {
              id: plan.id,
              name: typeof plan.name === 'string' && plan.name.trim() ? plan.name.trim() : plan.id,
              price: isFree ? '۰ تومان' : `${new Intl.NumberFormat('fa-IR').format(monthlyPrice)} تومان`,
              detail: typeof plan.tagline === 'string' && plan.tagline.trim()
                ? plan.tagline.trim()
                : isFree
                  ? 'برای شروع و آشنایی'
                  : 'ماهانه',
              items: Array.isArray(plan.features) && plan.features.length > 0 ? plan.features : [],
              tone: isFree ? 'free' : isGold ? 'gold' : 'diamond',
              icon: isFree ? 'spark' : isGold ? 'plans' : 'shield',
              featured: isFree,
              label: isFree ? 'شروع پیشنهادی' : isGold ? 'محبوب' : undefined
            } as LandingPlan;
          });

        if (nextPlans.length > 0) {
          setPlans(nextPlans);
          return;
        }
        setPlans(fallbackPlans);
      } catch {
        setPlans(fallbackPlans);
      }
    };

    void loadPlans();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleNavClick = (href: string) => {
    setMenuOpen(false);
    const el = document.querySelector(href);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <main className="danua-landing" dir="rtl">
      <a href="#main-content" className="danua-skip-link">رفتن به محتوای اصلی</a>

      <header className="danua-header">
        <a className="danua-logo" href="/" aria-label="دانوآ - صفحه اصلی">
          <span className="danua-logo-mark" aria-hidden="true">د</span>
          <span>دانوآ</span>
        </a>
        <nav className="danua-nav" aria-label="ناوبری لندینگ">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(e) => {
                e.preventDefault();
                handleNavClick(link.href);
              }}
            >
              <DanuaIcon name={link.icon} />
              <span>{link.label}</span>
            </a>
          ))}
        </nav>
        <div className="danua-header-actions">
          <Button
            type="button"
            className="danua-header-cta"
            data-cta="header-signup"
            startIcon={<DanuaIcon name="rocket" />}
            onClick={() => navigateToChat('signup')}
          >
            شروع رایگان
          </Button>
          <button
            type="button"
            className={`danua-menu-toggle ${menuOpen ? 'is-open' : ''}`}
            aria-label={menuOpen ? 'بستن منو' : 'باز کردن منو'}
            aria-expanded={menuOpen}
            aria-controls="danua-mobile-menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </button>
        </div>
      </header>

      {menuOpen ? (
        <div
          id="danua-mobile-menu"
          className="danua-mobile-menu"
          role="dialog"
          aria-modal="true"
          aria-label="منوی ناوبری"
        >
          <nav aria-label="ناوبری موبایل">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={(e) => {
                  e.preventDefault();
                  handleNavClick(link.href);
                }}
              >
                <DanuaIcon name={link.icon} />
                <span>{link.label}</span>
              </a>
            ))}
          </nav>
          <Button
            type="button"
            size="lg"
            className="danua-cta-button"
            data-cta="menu-signup"
            startIcon={<DanuaIcon name="rocket" />}
            onClick={() => navigateToChat('signup')}
          >
            شروع رایگان
          </Button>
        </div>
      ) : null}

      <section className="danua-hero" id="main-content">
        <div className="danua-hero-copy">
          <span className="danua-kicker">
            <DanuaIcon name="spark" />
            هوش مصنوعی فارسی برای ۷ تا ۱۳ سال
          </span>
          <h1>دانوآ، دوست هوشمند بچه‌های فارسی‌زبان</h1>
          <p>
            کمک درسی، ساخت تصویر، داستان‌سازی و گفت‌وگوی امن؛ همه در یک فضای فارسی و کودک‌پسند.
          </p>
          <div className="danua-hero-actions">
            <Button
              type="button"
              size="lg"
              className="danua-cta-button"
              data-cta="hero-signup"
              startIcon={<DanuaIcon name="rocket" />}
              onClick={() => navigateToChat('signup')}
            >
              شروع رایگان
            </Button>
            <Button
              type="button"
              size="lg"
              variant="secondary"
              className="danua-soft-button"
              data-cta="hero-login"
              startIcon={<DanuaIcon name="login" />}
              onClick={() => navigateToChat('login')}
            >
              ورود به حساب
            </Button>
          </div>
          <div className="danua-trust-row" aria-label="ویژگی‌های اعتماد">
            {trustBadges.map((badge) => (
              <span key={badge.label}>
                <DanuaIcon name={badge.icon} />
                {badge.label}
              </span>
            ))}
          </div>
        </div>

        <div className="danua-hero-visual" aria-label="نمونه رابط چت دانوآ">
          <div className="danua-phone">
            <div className="danua-phone-top">
              <span className="danua-avatar" aria-hidden="true">د</span>
              <div>
                <strong>دانوآ</strong>
                <span>آنلاین و آماده کمک</span>
              </div>
              <span className="danua-status-dot" aria-hidden="true" />
            </div>
            <div className="danua-chat-preview">
              <p className="danua-bubble bot">سلام! امروز با چی شروع کنیم؟</p>
              <p className="danua-bubble user">کسرها رو ساده توضیح می‌دی؟</p>
              <p className="danua-bubble bot">حتما. فکر کن یک کیک را به قسمت‌های برابر تقسیم کردیم...</p>
            </div>
            <div className="danua-composer" aria-hidden="true">
              <span>پیامت رو بنویس...</span>
              <span className="danua-composer-send"><DanuaIcon name="chat" /></span>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="danua-section">
        <div className="danua-section-heading">
          <span><DanuaIcon name="spark" /> قابلیت‌های دانوآ</span>
          <h2>چهار همراه ساده برای یادگیری و خیال‌پردازی</h2>
        </div>
        <div className="danua-feature-grid">
          {features.map((feature) => (
            <Card key={feature.title} className={`danua-feature-card danua-tone-${feature.tone}`} padding="lg">
              <span className="danua-feature-icon" aria-hidden="true">
                <DanuaIcon name={feature.icon} />
              </span>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section id="safety" className="danua-safety">
        <div className="danua-safety-art" aria-hidden="true">
          <DanuaIcon name="shield" />
        </div>
        <div className="danua-safety-copy">
          <span className="danua-kicker"><DanuaIcon name="family" /> برای آرامش خیال والدین</span>
          <h2>فضایی امن‌تر برای یادگیری و خیال‌پردازی</h2>
          <p>
            دانوآ با محتوای مناسب سن، پاسخ‌های فارسی و فضای کنترل‌شده طراحی شده تا والدین با خیال راحت‌تری کنار کودک باشند.
          </p>
          <div className="danua-safety-list">
            {safetyItems.map((item) => (
              <span key={item}>
                <DanuaIcon name="check" />
                {item}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section id="plans" className="danua-section">
        <div className="danua-section-heading">
          <span><DanuaIcon name="plans" /> پلن‌ها</span>
          <h2>رایگان شروع کن، اگر خواستی بیشتر استفاده کن</h2>
        </div>
        <div className="danua-plan-grid">
          {(plans.length > 0 ? plans : fallbackPlans).map((plan) => (
            <Card
              key={plan.id}
              className={`danua-plan-card danua-plan-${plan.tone} ${plan.featured ? 'is-featured' : ''}`}
              padding="lg"
            >
              {plan.label ? <span className="danua-badge">{plan.label}</span> : null}
              <PlanIcon><DanuaIcon name={plan.icon} /></PlanIcon>
              <h3>{plan.name}</h3>
              <div className="danua-price">
                <strong>{plan.price}</strong>
                <span>{plan.detail}</span>
              </div>
              <ul>
                {plan.items.map((item) => (
                  <li key={item}>
                    <DanuaIcon name="check" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                className={plan.featured ? 'danua-cta-button' : 'danua-plan-button'}
                data-cta={`plan-${plan.id}`}
                onClick={() => navigateToChat('signup', plan.id)}
              >
                {plan.id === 'free' ? 'شروع رایگان' : `انتخاب پلن ${plan.name}`}
              </Button>
            </Card>
          ))}
        </div>
      </section>

      <section className="danua-section">
        <div className="danua-section-heading">
          <span><DanuaIcon name="family" /> نظر خانواده‌ها</span>
          <h2>چند تجربه کوتاه از والدین</h2>
        </div>
        <div className="danua-testimonial-grid">
          {testimonials.map((testimonial) => (
            <Card key={testimonial.name} className="danua-testimonial-card" padding="lg">
              <div className="danua-stars" aria-label="۵ ستاره">
                {Array.from({ length: 5 }).map((_, index) => (
                  <DanuaIcon key={index} name="star" />
                ))}
              </div>
              <p>{testimonial.text}</p>
              <strong>{testimonial.name}</strong>
            </Card>
          ))}
        </div>
      </section>

      <section id="faq" className="danua-section danua-faq-section">
        <div className="danua-section-heading">
          <span><DanuaIcon name="question" /> سوالات متداول</span>
          <h2>چیزهایی که والدین معمولا می‌پرسند</h2>
        </div>
        <div className="danua-faq-list">
          {faqs.map((faq, index) => {
            const panelId = `faq-panel-${index}`;
            const isOpen = openFaq === index;
            return (
              <Card key={faq.question} className="danua-faq-card" padding="md">
                <button
                  type="button"
                  onClick={() => setOpenFaq(isOpen ? -1 : index)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                >
                  <span>{faq.question}</span>
                  <span className="danua-faq-toggle" aria-hidden="true">
                    <DanuaIcon name={isOpen ? 'minus' : 'plus'} />
                  </span>
                </button>
                {isOpen ? <p id={panelId}>{faq.answer}</p> : null}
              </Card>
            );
          })}
        </div>
      </section>

      <section className="danua-final-cta">
        <div>
          <span className="danua-kicker"><DanuaIcon name="chat" /> شروع یک گفت‌وگوی امن</span>
          <h2>بگذار دانوآ کنار یادگیری و خیال‌پردازی بچه‌ها باشد.</h2>
        </div>
        <Button
          type="button"
          size="lg"
          className="danua-cta-button"
          data-cta="final-signup"
          startIcon={<DanuaIcon name="rocket" />}
          onClick={() => navigateToChat('signup')}
        >
          شروع رایگان
        </Button>
      </section>

      <footer className="danua-footer">
        <a className="danua-logo" href="/" aria-label="دانوآ - صفحه اصلی">
          <span className="danua-logo-mark" aria-hidden="true">د</span>
          <span>دانوآ</span>
        </a>
        <div className="danua-footer-links">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(e) => {
                e.preventDefault();
                handleNavClick(link.href);
              }}
            >
              <DanuaIcon name={link.icon} />
              <span>{link.label}</span>
            </a>
          ))}
        </div>
        <div className="danua-socials" aria-label="شبکه‌های اجتماعی">
          <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" aria-label="اینستاگرام دانوآ">
            <DanuaIcon name="instagram" />
          </a>
          <a href="https://t.me" target="_blank" rel="noopener noreferrer" aria-label="کانال تلگرام دانوآ">
            <DanuaIcon name="telegram" />
          </a>
          <a href="https://linkedin.com" target="_blank" rel="noopener noreferrer" aria-label="لینکدین دانوآ">
            <DanuaIcon name="linkedin" />
          </a>
        </div>
      </footer>
    </main>
  );
}

export default DanuaLanding;
