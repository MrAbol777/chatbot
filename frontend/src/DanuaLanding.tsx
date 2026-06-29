import { useEffect, useState } from 'react';
import { Button, Card } from './design-system/components';
import './DanuaLanding.css';

type PlanId = string;

const features = [
  {
    icon: '📚',
    title: 'کمک درسی',
    text: 'حل تمرین و توضیح مفاهیم سخت با زبان ساده و قدم به قدم.',
    tone: 'mint'
  },
  {
    icon: '💕',
    title: 'همراه عاطفی',
    text: 'گفتگوی دوستانه، امن و حمایتگر برای روزهای شلوغ ذهن بچه ها.',
    tone: 'pink'
  },
  {
    icon: '✨',
    title: 'داستان سازی',
    text: 'قصه های شبانه، شخصیت های خیالی و ماجراجویی های خلاقانه.',
    tone: 'yellow'
  },
  {
    icon: '🎨',
    title: 'ساخت تصویر',
    text: 'تبدیل ایده های کودکانه به تصویرهای رنگی با هوش مصنوعی.',
    tone: 'blue'
  }
];

type LandingPlan = {
  id: PlanId;
  name: string;
  price: string;
  detail: string;
  items: string[];
  tone: string;
  popular?: boolean;
};

const defaultPlans: LandingPlan[] = [
  {
    id: 'free',
    name: 'رایگان',
    price: '۰ تومان',
    detail: 'برای شروع و آشنایی',
    items: ['۲۰ پیام در روز', 'گفتگوی آموزشی و خلاقانه', 'مناسب تجربه اولیه'],
    tone: 'blue'
  },
  {
    id: 'gold',
    name: 'طلایی',
    price: '۹۹,۰۰۰ تومان',
    detail: 'ماهانه',
    items: ['۱۰۰ پیام در روز', '۱۰ ساخت تصویر در روز', 'انتخاب محبوب خانواده ها'],
    tone: 'gold',
    popular: true
  },
  {
    id: 'diamond',
    name: 'الماسی',
    price: '۱۹۹,۰۰۰ تومان',
    detail: 'ماهانه',
    items: ['پیام نامحدود', 'ساخت تصویر نامحدود', 'برای استفاده روزانه و جدی'],
    tone: 'mint'
  }
];

const testimonials = [
  {
    name: 'مادر آرتین، ۹ ساله',
    text: 'دانوآ تمرین های مدرسه را با حوصله توضیح می دهد و لحنش برای بچه ها آرامش بخش است. آرتین عاشق صحبت با دانوآ شده!'
  },
  {
    name: 'پدر رها، ۱۳ ساله',
    text: 'برای ما مهم بود محیط فارسی، امن و قابل اعتماد باشد. رها هم از داستان ساختن با دانوآ لذت می برد.'
  },
  {
    name: 'مادر نیما، ۱۶ ساله',
    text: 'وقتی سوال درسی دارد، جواب آماده نمی گیرد؛ مسیر فکر کردن را یاد می گیرد. خیلی خوبه که به جای جواب دادن، راهنمایی می کنه!'
  }
];

const faqs = [
  {
    question: 'دانوآ برای چه سنینی مناسب است؟',
    answer: 'برای کودکان و نوجوانان ۵ تا ۱۸ سال طراحی شده و پاسخ ها با زبان ساده، گرم و مناسب سن ارائه می شوند.'
  },
  {
    question: 'آیا محتوا برای بچه ها امن است؟',
    answer: 'تمرکز دانوآ روی گفتگوی حمایتی، آموزشی و مناسب سن است و تجربه محصول با اولویت اعتماد والدین طراحی می شود.'
  },
  {
    question: 'آیا دانوآ تکلیف را کامل به جای کودک انجام می دهد؟',
    answer: 'هدف کمک به یادگیری است؛ دانوآ مفهوم را توضیح می دهد، راهنمایی می کند و بچه را قدم به قدم همراهی می کند.'
  },
  {
    question: 'ساخت تصویر در کدام پلن ها فعال است؟',
    answer: 'پلن طلایی روزانه ۱۰ ساخت تصویر دارد و پلن الماس ساخت تصویر نامحدود ارائه می کند.'
  },
  {
    question: 'می توان رایگان شروع کرد؟',
    answer: 'بله، پلن رایگان با ۲۰ پیام روزانه برای شروع در دسترس است.'
  }
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

const navLinks = [
  { href: '#features', label: 'قابلیت ها', icon: '✨' },
  { href: '#safety', label: 'اعتماد والدین', icon: '🛡️' },
  { href: '#plans', label: 'پلن ها', icon: '💰' },
  { href: '#faq', label: 'سوالات', icon: '❓' }
];

function DanuaLanding() {
  const [openFaq, setOpenFaq] = useState<number>(-1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [plans, setPlans] = useState<LandingPlan[]>(defaultPlans);

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
              tone: plan.id === 'gold' ? 'gold' : plan.id === 'free' ? 'blue' : 'mint',
              popular: plan.id === 'gold'
            } as LandingPlan;
          });

        if (nextPlans.length > 0) setPlans(nextPlans);
      } catch {
        // Landing keeps bundled defaults if subscriptions API is unavailable.
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
              <span aria-hidden="true">{link.icon}</span> {link.label}
            </a>
          ))}
        </nav>
        <div className="danua-header-actions">
          <Button
            type="button"
            className="danua-header-cta"
            data-cta="header-signup"
            onClick={() => navigateToChat('signup')}
          >
            <span aria-hidden="true">🚀</span> شروع رایگان
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
                <span aria-hidden="true">{link.icon}</span> {link.label}
              </a>
            ))}
          </nav>
          <Button
            type="button"
            size="lg"
            className="danua-cta-button"
            data-cta="menu-signup"
            onClick={() => navigateToChat('signup')}
          >
            <span aria-hidden="true">🚀</span> شروع رایگان
          </Button>
        </div>
      ) : null}

      <section className="danua-hero" id="main-content">
        <div className="danua-hero-copy">
          <span className="danua-kicker">🤖 هوش مصنوعی فارسی برای ۵ تا ۱۸ سال</span>
          <h1>
            دانوآ، دوست <span aria-hidden="true">🤗</span> هوش مصنوعی بچه های تو!
          </h1>
          <p>
            همراهی امن، شاد و فارسی برای کمک درسی <span aria-hidden="true">📖</span>، حرف زدن از احساسات{' '}
            <span aria-hidden="true">💭</span>، ساختن قصه <span aria-hidden="true">✨</span> و تبدیل خیال بچه ها به تصویر{' '}
            <span aria-hidden="true">🎨</span>!
          </p>
          <div className="danua-hero-actions">
            <Button
              type="button"
              size="lg"
              className="danua-cta-button"
              data-cta="hero-signup"
              onClick={() => navigateToChat('signup')}
            >
              <span aria-hidden="true">🚀</span> شروع رایگان
            </Button>
            <Button
              type="button"
              size="lg"
              variant="secondary"
              className="danua-soft-button"
              data-cta="hero-login"
              onClick={() => navigateToChat('login')}
            >
              <span aria-hidden="true">🔐</span> ورود به حساب
            </Button>
          </div>
          <div className="danua-trust-row" aria-label="ویژگی های اعتماد">
            <span><span aria-hidden="true">🌟</span> مناسب سن</span>
            <span><span aria-hidden="true">💬</span> فارسی و صمیمی</span>
            <span><span aria-hidden="true">👨‍👩‍👧‍👦</span> طراحی شده برای خانواده</span>
          </div>
        </div>

        <div className="danua-hero-visual" aria-label="نمونه رابط چت دانوآ">
          <span className="danua-sun" aria-hidden="true">
            <span className="smile" />
          </span>
          <span className="danua-cloud danua-cloud-one" aria-hidden="true" />
          <span className="danua-cloud danua-cloud-two" aria-hidden="true" />
          <div className="danua-phone">
            <div className="danua-phone-top">
              <span className="danua-avatar" aria-hidden="true">د</span>
              <div>
                <strong>دانوآ</strong>
                <span>آنلاین و آماده کمک</span>
              </div>
            </div>
            <div className="danua-chat-preview">
              <p className="danua-bubble bot">سلام! امروز با چی شروع کنیم؟</p>
              <p className="danua-bubble user">کسرها رو ساده توضیح میدی؟</p>
              <p className="danua-bubble bot">حتما! فکر کن یک کیک را به قسمت های برابر تقسیم کردیم...</p>
            </div>
            <div className="danua-composer" aria-hidden="true">
              <span>پیامت رو بنویس...</span>
              <span className="danua-composer-send">✨</span>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="danua-section">
        <div className="danua-section-heading">
          <span>🎯 چه کارهایی بلد است؟</span>
          <h2>چهار همراه کوچک برای روزهای بزرگ بچه ها!</h2>
        </div>
        <div className="danua-feature-grid">
          {features.map((feature) => (
            <Card key={feature.title} className={`danua-feature-card danua-tone-${feature.tone}`} padding="lg">
              <span className="danua-feature-icon" aria-hidden="true">{feature.icon}</span>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section id="safety" className="danua-safety">
        <div className="danua-safety-art" aria-hidden="true">
          <span className="danua-shield">🛡️</span>
        </div>
        <div>
          <span className="danua-kicker">💝 برای آرامش خیال والدین</span>
          <h2>فضایی گرم، مراقب و مناسب سن!</h2>
          <p>
            دانوآ برای خانواده هایی ساخته شده که هم یادگیری و خلاقیت می خواهند، هم لحن محترمانه، محتوای مناسب سن و تجربه ای قابل اعتماد.
          </p>
          <div className="danua-safety-list">
            <span><span aria-hidden="true">🌈</span> پاسخ های ساده و سن محور</span>
            <span><span aria-hidden="true">💕</span> گفتگوی حمایتگر و بدون قضاوت</span>
            <span><span aria-hidden="true">🎯</span> تمرکز روی یادگیری، نه جایگزینی تلاش کودک</span>
          </div>
        </div>
      </section>

      <section id="plans" className="danua-section">
        <div className="danua-section-heading">
          <span>💰 پلن های اشتراک</span>
          <h2>از شروع رایگان تا همراهی نامحدود!</h2>
        </div>
        <div className="danua-plan-grid">
          {plans.map((plan) => (
            <Card
              key={plan.id}
              className={`danua-plan-card danua-plan-${plan.tone} ${plan.popular ? 'is-popular' : ''}`}
              padding="lg"
            >
              {plan.popular ? <span className="danua-badge">محبوب ترین</span> : null}
              <h3>{plan.name}</h3>
              <div className="danua-price">
                <strong>{plan.price}</strong>
                <span>{plan.detail}</span>
              </div>
              <ul>
                {plan.items.map((item) => (
                  <li key={item}><span aria-hidden="true">🎯</span> {item}</li>
                ))}
              </ul>
              <Button
                type="button"
                className={plan.popular ? 'danua-cta-button' : 'danua-plan-button'}
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
          <span>💬 نظر خانواده ها</span>
          <h2>چند تجربه کوتاه از والدین شاد!</h2>
        </div>
        <div className="danua-testimonial-grid">
          {testimonials.map((testimonial) => (
            <Card key={testimonial.name} className="danua-testimonial-card" padding="lg">
              <div className="danua-stars" aria-label="۵ ستاره">★★★★★</div>
              <p>{testimonial.text}</p>
              <strong>{testimonial.name}</strong>
            </Card>
          ))}
        </div>
      </section>

      <section id="faq" className="danua-section danua-faq-section">
        <div className="danua-section-heading">
          <span>❓ سوالات متداول</span>
          <h2>چیزهایی که والدین معمولا می پرسند!</h2>
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
                  <span aria-hidden="true">{isOpen ? '−' : '+'}</span>
                </button>
                {isOpen ? <p id={panelId}>{faq.answer}</p> : null}
              </Card>
            );
          })}
        </div>
      </section>

      <section className="danua-final-cta">
        <div>
          <span className="danua-kicker">🎈 شروع یک گفتگوی امن</span>
          <h2>بگذار دانوآ کنار یادگیری و خیال پردازی بچه ها باشد!</h2>
        </div>
        <Button
          type="button"
          size="lg"
          className="danua-cta-button"
          data-cta="final-signup"
          onClick={() => navigateToChat('signup')}
        >
          <span aria-hidden="true">🌟</span> ثبت نام رایگان
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
              <span aria-hidden="true">{link.icon}</span> {link.label}
            </a>
          ))}
        </div>
        <div className="danua-socials" aria-label="شبکه های اجتماعی">
          <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" aria-label="اینستاگرام دانوآ">📸</a>
          <a href="https://t.me" target="_blank" rel="noopener noreferrer" aria-label="کانال تلگرام دانوآ">✈️</a>
          <a href="https://linkedin.com" target="_blank" rel="noopener noreferrer" aria-label="لینکدین دانوآ">💼</a>
        </div>
      </footer>
    </main>
  );
}

export default DanuaLanding;
