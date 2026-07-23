import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { Button, Card } from './design-system/components';
import './Landing.css';

function useScrollProgress() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let raf: number | null = null;
    const onScroll = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        const h = document.documentElement.scrollHeight - window.innerHeight;
        setProgress(h > 0 ? Math.min(window.scrollY / h, 1) : 0);
        raf = null;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, []);
  return progress;
}

function useScrollReveal(threshold = 0.08) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!('IntersectionObserver' in window)) {
      el.dataset.revealed = 'true';
      return;
    }
    el.dataset.revealed = 'true';
    const revealTimer = setTimeout(() => {
      if (!el.isConnected) return;
      el.dataset.revealed = 'false';
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting || entry.boundingClientRect.top < window.innerHeight) {
            el.dataset.revealed = 'true';
            observer.unobserve(el);
          }
        },
        { threshold }
      );
      observer.observe(el);
    }, 300);
    return () => {
      clearTimeout(revealTimer);
    };
  }, [threshold]);
  return ref;
}

function RevealSection({ children, className = '', threshold = 0.08 }: { children: ReactNode; className?: string; threshold?: number }) {
  const ref = useScrollReveal(threshold);
  return (
    <div ref={ref} className={`landing-reveal ${className}`} data-revealed="false">
      {children}
    </div>
  );
}

function useParallaxOffset(speed = 0.12) {
  const ref = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const isMobile = window.innerWidth < 720;
    if (isMobile) return;
    let raf: number | null = null;
    const onScroll = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        const rect = el!.getBoundingClientRect();
        const viewCenter = window.innerHeight / 2;
        const elCenter = rect.top + rect.height / 2;
        const dist = (elCenter - viewCenter) / window.innerHeight;
        setOffset(dist * speed * 100);
        raf = null;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [speed]);
  return { ref, offset };
}

function ParallaxLayer({ children, speed = 0.12, className = '' }: { children?: ReactNode; speed?: number; className?: string }) {
  const { ref, offset } = useParallaxOffset(speed);
  return (
    <div ref={ref} className={`landing-parallax ${className}`} style={{ transform: `translateY(${offset}px)` }}>
      {children}
    </div>
  );
}

function TiltCard({ children, className = '', strength = 12 }: { children: ReactNode; className?: string; strength?: number }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const isTouch = useRef(false);

  useEffect(() => {
    isTouch.current = 'ontouchstart' in window;
  }, []);

  const handleMove = useCallback((e: React.MouseEvent) => {
    if (isTouch.current) return;
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: y * -strength, y: x * strength });
  }, [strength]);

  const handleLeave = useCallback(() => {
    setTilt({ x: 0, y: 0 });
  }, []);

  return (
    <div
      ref={cardRef}
      className={`landing-tilt ${className}`}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      style={{
        transform: `perspective(1000px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
        transition: tilt.x === 0 && tilt.y === 0 ? 'transform 600ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
      }}
    >
      {children}
    </div>
  );
}

type Plan = {
  id: string;
  name: string;
  price: string;
  period: string;
  items: string[];
  tier: string;
  icon: string;
  featured?: boolean;
  badge?: string;
};

const fallbackPlans: Plan[] = [
  {
    id: 'free',
    name: 'رایگان',
    price: '۰ تومان',
    period: 'همیشه رایگان',
    items: ['۲۰ پیام در روز', 'گفت‌وگوی هوشمند', 'بدون نیاز به کارت بانکی'],
    tier: 'free',
    icon: 'spark',
    featured: true,
    badge: 'شروع پیشنهادی',
  },
  {
    id: 'gold',
    name: 'طلایی',
    price: '۹۹,۰۰۰ تومان',
    period: 'ماهانه',
    items: ['۳۰۰ پیام در روز', 'ساخت تصویر هوش مصنوعی', 'اولویت پاسخگویی', 'مناسب خانواده'],
    tier: 'gold',
    icon: 'crown',
    badge: 'محبوب',
  },
  {
    id: 'diamond',
    name: 'الماسی',
    price: '۱۹۹,۰۰۰ تومان',
    period: 'ماهانه',
    items: ['پیام نامحدود', 'ساخت تصویر نامحدود', 'دسترسی به استودیو ویدیو', 'پشتیبانی ویژه'],
    tier: 'diamond',
    icon: 'diamond',
  },
];

const features = [
  {
    icon: 'chat',
    title: 'چت هوشمند فارسی',
    text: 'گفت‌وگوی طبیعی و باهوش به فارسی. هر سوالی داری، از کمک درسی تا ایده‌های خلاقانه، دانوآ همراهته',
    accent: '#7c3aed',
    gradient: 'linear-gradient(135deg, rgba(124,58,237,0.12), rgba(124,58,237,0.04))',
  },
  {
    icon: 'spark',
    title: 'استودیوی تصویر',
    text: 'با توصیف هر چیزی که تو ذهنته، دانوآ تصویرش رو می‌سازه. ادیت کن، رنگ بزن و خلاقیت رو آزاد بذار',
    accent: '#ec4899',
    gradient: 'linear-gradient(135deg, rgba(236,72,153,0.12), rgba(236,72,153,0.04))',
  },
  {
    icon: 'video',
    title: 'ساخت ویدیو با AI',
    text: 'از متن به ویدیو! ایده‌هات رو توصیف کن و دانوآ برات ویدیو می‌سازه. مناسب داستان‌ها، آموزش و سرگرمی',
    accent: '#14b8a6',
    gradient: 'linear-gradient(135deg, rgba(20,184,166,0.12), rgba(20,184,166,0.04))',
  },
  {
    icon: 'magic',
    title: 'داستان‌سازی خلاقانه',
    text: 'با دانوآ دنیایی از داستان‌های تازه بساز. هر بار یک ماجرای جدید، متناسب با سلیقه و سن کودک',
    accent: '#f59e0b',
    gradient: 'linear-gradient(135deg, rgba(245,158,11,0.12), rgba(245,158,11,0.04))',
  },
];

const testimonials = [
  {
    name: 'مادر آرتین، ۹ ساله',
    text: 'تمرین‌های ریاضی را طوری توضیح می‌دهد که خودش به جواب برسد. لحنش آرام و مناسب سنش است. دیگر نگران کمک درسی نیستم.',
    color: '#7c3aed',
  },
  {
    name: 'پدر رها، ۱۲ ساله',
    text: 'محیط فارسی و کنترل‌شده برای ما مهم بود. رها بیشتر از همه عاشق داستان‌سازی شده و ساعتی با دانوآ قصه می‌سازد.',
    color: '#ec4899',
  },
  {
    name: 'مادر نیما، ۱۰ ساله',
    text: 'برخلاف بقیه چت‌بات‌ها، جواب آماده نمی‌دهد. کمک می‌کند خودش مسیر حل مسئله را پیدا کند. این دقیقاً همان چیزی بود که می‌خواستم.',
    color: '#14b8a6',
  },
];

const faqs = [
  {
    q: 'دانوآ مناسب چه گروه سنی‌ست؟',
    a: 'تمرکز اصلی دانوآ روی کودکان ۷ تا ۱۳ سال است، اما والدین نیز می‌توانند از آن استفاده کنند. محتوا و لحن پاسخ‌ها متناسب با این گروه سنی طراحی شده.',
  },
  {
    q: 'چطور از امنیت محتوا مطمئن شوم؟',
    a: 'همه پاسخ‌ها با هوش مصنوعی در فضایی کنترل‌شده تولید می‌شوند. لحن گفتگو فارسی و مناسب سن است. هیچ محتوای نامناسبی به کودک نمایش داده نمی‌شود.',
  },
  {
    q: 'آیا دانوآ تکالیف را کامل انجام می‌دهد؟',
    a: 'خیر. هدف دانوآ کمک به یادگیری است، نه جایگزینی تلاش کودک. مفاهیم را توضیح می‌دهد، راهنمایی می‌کند و کودک را قدم‌به‌قدم به پاسخ می‌رساند.',
  },
  {
    q: 'چطور می‌توانم شروع کنم؟',
    a: 'کافیست روی دکمه «شروع رایگان» کلیک کنید. با شماره موبایل ثبت‌نام کنید و از همان لحظه گفتگو با دانوآ را شروع کنید. هیچ هزینه‌ای نداره.',
  },
  {
    q: 'ساخت تصویر و ویدیو در چه پلن‌هایی فعال است؟',
    a: 'پلن رایگان شامل ۲۰ پیام متنی در روز است. برای ساخت تصویر، پلن طلایی و برای دسترسی کامل به استودیو ویدیو، پلن الماسی را انتخاب کنید.',
  },
];

const navLinks = [
  { href: '#features', label: 'قابلیت‌ها' },
  { href: '#trust', label: 'اعتماد' },
  { href: '#plans', label: 'پلن‌ها' },
  { href: '#faq', label: 'پرسش‌ها' },
];

function Icon({ name, className = '' }: { name: string; className?: string }) {
  const props = {
    className: `landing-icon ${className}`.trim(),
    viewBox: '0 0 24 24',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    'aria-hidden': true,
  };

  switch (name) {
    case 'chat':
      return <svg {...props}><path d="M8 12h.1M12 12h.1M16 12h.1M21 12c0 4.4-4 8-9 8-1.2 0-2.4-.2-3.5-.6L4 21l1.8-4.5C4.3 15 4 13.5 4 12c0-4.4 4-8 9-8s9 3.6 9 8Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case 'spark':
      return <svg {...props}><path d="M12 3v4m0 10v4M5 12H3m18 0h-2M7.5 7.5l-1-1m11 11-1-1M7.5 16.5l-1 1m11-11-1 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z" stroke="currentColor" strokeWidth="1.8"/><path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" stroke="currentColor" strokeWidth="1.8"/></svg>;
    case 'heart':
      return <svg {...props}><path d="M20.8 11.5C22 8.7 20.3 5 17 5c-2 0-3.5 1.5-5 3-1.5-1.5-3-3-5-3-3.3 0-5 3.7-3.8 6.5C4.5 15 12 21 12 21s7.5-6 8.8-9.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case 'magic':
      return <svg {...props}><path d="M12 3v4m0 10v4M5 12H3m18 0h-2M7.5 7.5l-1-1m11 11-1-1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><path d="m9 18 3-14 3 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M6 12h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>;
    case 'crown':
      return <svg {...props}><path d="M2 20h20M4 15l3-10 5 7 5-7 3 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M12 5v3m0 4v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;
    case 'diamond':
      return <svg {...props}><path d="M12 3 3 9l9 12 9-12-9-6Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 9h18" stroke="currentColor" strokeWidth="1.8"/><path d="m12 3-3 6 3 6 3-6-3-6Z" stroke="currentColor" strokeWidth="1.8"/></svg>;
    case 'check':
      return <svg {...props}><path d="m5 13 4 4L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case 'chevron-down':
      return <svg {...props}><path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case 'star':
      return <svg {...props}><path d="m12 3 2.4 4.8 5.1.8-3.7 3.5.9 5L12 15l-4.7 2.1.9-5L4.5 8.6l5-.8L12 3Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case 'shield':
      return <svg {...props}><path d="M12 3.5 19 6v5.4c0 4.1-2.8 7.8-7 9.1-4.2-1.3-7-5-7-9.1V6l7-2.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case 'arrow-left':
      return <svg {...props}><path d="m15 18-6-6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case 'menu':
      return <svg {...props}><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>;
    case 'x':
      return <svg {...props}><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>;
    case 'book':
      return <svg {...props}><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6.5a1.5 1.5 0 0 0 0 3H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M4 19.5A1.5 1.5 0 0 1 5.5 18H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M8 7h6M8 10.5h5M8 14h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case 'video':
      return <svg {...props}><path d="M22 8.5v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="m10 11 4 2.5-4 2.5V11Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case 'globe':
      return <svg {...props}><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" stroke="currentColor" strokeWidth="1.8"/></svg>;
    case 'bot':
      return <svg {...props}><rect x="3" y="11" width="18" height="10" rx="2" stroke="currentColor" strokeWidth="1.8"/><circle cx="12" cy="16" r="2" stroke="currentColor" strokeWidth="1.6"/><path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8"/></svg>;
    default:
      return <svg {...props}><path d="M12 3v18M3 12h18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;
  }
}

function ScrollProgress() {
  const progress = useScrollProgress();
  return (
    <div className="landing-scroll-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-label="پیشرفت صفحه">
      <div className="landing-scroll-progress-bar" style={{ width: `${progress * 100}%` }} />
    </div>
  );
}

function BackgroundOrbs() {
  return (
    <div className="landing-bg-orbs" aria-hidden="true">
      <div className="landing-orb landing-orb--1" />
      <div className="landing-orb landing-orb--2" />
      <div className="landing-orb landing-orb--3" />
      <div className="landing-orb landing-orb--4" />
      <div className="landing-orb landing-orb--5" />
      <div className="landing-orb landing-orb--6" />
      <div className="landing-grid-lines" />
    </div>
  );
}

function LandingHeader({ menuOpen, setMenuOpen, scrollTo, menuBtnRef }: { menuOpen: boolean; setMenuOpen: React.Dispatch<React.SetStateAction<boolean>>; scrollTo: (href: string) => void; menuBtnRef: React.RefObject<HTMLButtonElement> }) {
  return (
    <header className="landing-header">
      <a className="landing-logo" href="/" aria-label="دانوآ - صفحه اصلی">
        <span className="landing-logo-mark" aria-hidden="true">
          <Icon name="spark" />
        </span>
        <span className="landing-logo-text">دانوآ</span>
      </a>
      <nav className="landing-nav" aria-label="ناوبری اصلی">
        {navLinks.map((link) => (
          <a key={link.href} href={link.href} onClick={(e) => { e.preventDefault(); scrollTo(link.href); }}>
            {link.label}
          </a>
        ))}
      </nav>
      <div className="landing-header-actions">
        <Button
          type="button"
          className="landing-header-cta"
          onClick={() => window.location.assign('/chat?auth=signup')}
        >
          شروع رایگان
        </Button>
        <button
          ref={menuBtnRef}
          type="button"
          className={`landing-menu-btn ${menuOpen ? 'is-open' : ''}`}
          aria-label={menuOpen ? 'بستن منو' : 'فهرست'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(v => !v)}
        >
          {menuOpen ? <Icon name="x" /> : <Icon name="menu" />}
        </button>
      </div>
    </header>
  );
}

function MobileMenu({ menuOpen, scrollTo }: { menuOpen: boolean; scrollTo: (href: string) => void }) {
  if (!menuOpen) return null;
  return (
    <div className="landing-mobile-menu" role="dialog" aria-modal="true" aria-label="منوی ناوبری">
      <nav aria-label="ناوبری موبایل">
        {navLinks.map((link) => (
          <a key={link.href} href={link.href} onClick={(e) => { e.preventDefault(); scrollTo(link.href); }}>
            {link.label}
          </a>
        ))}
      </nav>
      <Button type="button" size="lg" className="landing-cta landing-mobile-cta" onClick={() => window.location.assign('/chat?auth=signup')}>
        <Icon name="spark" />
        شروع رایگان
      </Button>
    </div>
  );
}

function HeroSection() {
  return (
    <section id="main" className="landing-hero">
      <div className="landing-hero-bg-shapes" aria-hidden="true">
        <ParallaxLayer speed={0.2} className="landing-hero-shape landing-hero-shape--1" />
        <ParallaxLayer speed={-0.15} className="landing-hero-shape landing-hero-shape--2" />
        <ParallaxLayer speed={0.1} className="landing-hero-shape landing-hero-shape--3" />
        <ParallaxLayer speed={-0.08} className="landing-hero-shape landing-hero-shape--4" />
        <ParallaxLayer speed={0.06} className="landing-hero-shape landing-hero-shape--5" />
      </div>
      <RevealSection className="landing-hero-content">
        <div className="landing-kicker-wrap">
          <Icon name="bot" />
          <span className="landing-kicker">هوش مصنوعی فارسی برای کودکان</span>
        </div>
        <h1>
          <span className="landing-hero-headline-line">دانوآ،</span>
          <span className="landing-hero-headline-line landing-hero-headline-line--accent">دوست باهوش کودکان</span>
        </h1>
        <p className="landing-hero-sub">
          کمک درسی، تولید تصویر، ساخت ویدیو و گفت‌وگوی امن<br className="landing-br" />
          همه در یک فضای کودک‌پسند و کاملاً فارسی
        </p>
        <div className="landing-hero-actions">
          <Button type="button" size="lg" className="landing-cta landing-hero-primary" onClick={() => window.location.assign('/chat?auth=signup')}>
            <Icon name="spark" />
            شروع رایگان
          </Button>
          <Button type="button" size="lg" variant="secondary" className="landing-hero-secondary" onClick={() => window.location.assign('/chat?auth=login')}>
            <Icon name="arrow-left" />
            ورود به حساب
          </Button>
        </div>
        <div className="landing-trust-badges">
          {['مناسب سن ۷ تا ۱۳ سال', 'کاملاً فارسی', 'امن برای خانواده'].map((b) => (
            <span key={b}>
              <Icon name="check" />
              {b}
            </span>
          ))}
        </div>
      </RevealSection>
      <RevealSection className="landing-hero-visual">
        <ParallaxLayer speed={-0.1}>
          <div className="landing-hero-3d-scene">
            <div className="landing-floating-card landing-floating-card--1">
              <div className="landing-floating-card-glow" aria-hidden="true" />
              <div className="landing-floating-card-content">
                <Icon name="chat" />
                <span>چت هوشمند</span>
              </div>
            </div>
            <div className="landing-floating-card landing-floating-card--2">
              <div className="landing-floating-card-glow" aria-hidden="true" />
              <div className="landing-floating-card-content">
                <Icon name="spark" />
                <span>ساخت تصویر</span>
              </div>
            </div>
            <div className="landing-floating-card landing-floating-card--3">
              <div className="landing-floating-card-glow" aria-hidden="true" />
              <div className="landing-floating-card-content">
                <Icon name="video" />
                <span>ساخت ویدیو</span>
              </div>
            </div>
            <div className="landing-hero-center-orb" aria-hidden="true">
              <div className="landing-hero-center-orb-inner">
                <span className="landing-hero-orb-letter">د</span>
              </div>
            </div>
          </div>
        </ParallaxLayer>
      </RevealSection>
    </section>
  );
}

function FeaturesSection() {
  return (
    <section id="features" className="landing-section">
      <RevealSection>
        <div className="landing-section-header">
          <div className="landing-kicker-wrap">
            <Icon name="spark" />
            <span className="landing-kicker">قابلیت‌ها</span>
          </div>
          <h2>چهار ابزار قدرتمند برای یادگیری و خلاقیت</h2>
        </div>
      </RevealSection>
      <div className="landing-features">
        {features.map((f, i) => (
          <RevealSection key={f.title} threshold={0.05}>
            <TiltCard strength={10}>
              <div className="landing-feature-card" style={{ '--i': i, '--accent': f.accent, '--gradient': f.gradient } as React.CSSProperties}>
                <div className="landing-feature-icon-wrap">
                  <div className="landing-feature-icon" style={{ background: f.gradient, color: f.accent }}>
                    <Icon name={f.icon} />
                  </div>
                  <div className="landing-feature-icon-glow" style={{ background: f.accent }} aria-hidden="true" />
                </div>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
                <div className="landing-feature-arrow" aria-hidden="true">
                  <Icon name="arrow-left" />
                </div>
              </div>
            </TiltCard>
          </RevealSection>
        ))}
      </div>
    </section>
  );
}

function TrustSection() {
  return (
    <section id="trust" className="landing-section">
      <RevealSection>
        <div className="landing-trust-grid">
          <div className="landing-trust-art" aria-hidden="true">
            <div className="landing-trust-art-inner">
              <Icon name="shield" />
            </div>
          </div>
          <div className="landing-trust-content">
            <div className="landing-kicker-wrap">
              <Icon name="heart" />
              <span className="landing-kicker">برای آرامش والدین</span>
            </div>
            <h2>فضایی امن برای یادگیری و خیال‌پردازی</h2>
            <p>دانوآ با محتوای مناسب سن، پاسخ‌های کاملاً فارسی و فضای کنترل‌شده طراحی شده تا والدین با خیال راحت، کودکان را همراهی کنند.</p>
            <div className="landing-trust-items">
              {['پاسخ‌های متناسب با سن کودک', 'لحن گرم و خودمانی فارسی', 'تمرکز روی یادگیری، نه پاسخ آماده', 'گفتگو در محیط امن و کنترل‌شده'].map((item) => (
                <span key={item}>
                  <Icon name="check" />
                  {item}
                </span>
              ))}
            </div>
          </div>
        </div>
      </RevealSection>
    </section>
  );
}

function PricingSection() {
  const [plans, setPlans] = useState<Plan[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/subscription-plans');
        if (!res.ok) { setPlans(fallbackPlans); return; }
        const data = await res.json();
        if (cancelled || !Array.isArray(data.plans)) { setPlans(fallbackPlans); return; }
        const mapped = data.plans
          .filter((p: any) => {
            if (!p || typeof p.id !== 'string') return false;
            const name = (typeof p.name === 'string' ? p.name : '').toLowerCase();
            const id = p.id.toLowerCase();
            const desc = (typeof p.description === 'string' ? p.description : '').toLowerCase();
            const isTest = /test|test-only|internal/.test(id) || /test|test-only|internal/.test(name) || /test|test-only|internal/.test(desc);
            return !isTest;
          })
          .map((p: any) => {
            const price = Number(p.monthlyPrice ?? p.price ?? 0);
            const isFree = price <= 0;
            const isGold = p.id === 'gold';
            return {
              id: p.id,
              name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : p.id,
              price: isFree ? '۰ تومان' : `${new Intl.NumberFormat('fa-IR').format(price)} تومان`,
              period: isFree ? 'همیشه رایگان' : 'ماهانه',
              items: Array.isArray(p.features) && p.features.length > 0 ? p.features : ['امکانات ویژه'],
              tier: isFree ? 'free' : isGold ? 'gold' : 'diamond',
              icon: isFree ? 'spark' : isGold ? 'crown' : 'diamond',
              featured: isFree,
              badge: isFree ? 'شروع پیشنهادی' : isGold ? 'محبوب' : undefined,
            } as Plan;
          });
        if (mapped.length > 0) setPlans(mapped);
        else setPlans(fallbackPlans);
      } catch {
        setPlans(fallbackPlans);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const display = plans.length > 0 ? plans : fallbackPlans;

  const handlePlanClick = (planId: string) => {
    const params = new URLSearchParams({ auth: 'signup', plan: planId });
    window.location.assign(`/chat?${params}`);
  };

  return (
    <section id="plans" className="landing-section">
      <div className="landing-section-header">
        <div className="landing-kicker-wrap">
          <Icon name="crown" />
          <span className="landing-kicker">پلن‌ها</span>
        </div>
        <h2>رایگان شروع کن، هر وقت خواستی بیشتر استفاده کن</h2>
      </div>
      <div className="landing-plans">
        {display.map((plan, i) => (
          <TiltCard key={plan.id} strength={8}>
            <div
              className={`landing-plan-card landing-plan--${plan.tier} ${plan.featured ? 'is-featured' : ''}`}
              style={{ '--i': i } as React.CSSProperties}
            >
              {plan.badge && <span className="landing-badge">{plan.badge}</span>}
              <div className="landing-plan-icon"><Icon name={plan.icon} /></div>
              <h3 className="landing-plan-name">{plan.name}</h3>
              <div className="landing-plan-price">
                <strong>{plan.price}</strong>
                <span>{plan.period}</span>
              </div>
              <ul className="landing-plan-items">
                {plan.items.map((item) => (
                  <li key={item}>
                    <Icon name="check" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                size="lg"
                className={plan.featured ? 'landing-cta' : 'landing-plan-btn'}
                onClick={() => handlePlanClick(plan.id)}
              >
                {plan.tier === 'free' ? 'شروع رایگان' : `انتخاب ${plan.name}`}
              </Button>
            </div>
          </TiltCard>
        ))}
      </div>
    </section>
  );
}

function TestimonialsSection() {
  return (
    <section id="testimonials" className="landing-section">
      <RevealSection>
        <div className="landing-section-header">
          <div className="landing-kicker-wrap">
            <Icon name="heart" />
            <span className="landing-kicker">نظر خانواده‌ها</span>
          </div>
          <h2>والدین درباره دانوآ چه می‌گویند؟</h2>
        </div>
      </RevealSection>
      <div className="landing-testimonials">
        {testimonials.map((t) => (
          <RevealSection key={t.name} threshold={0.05}>
            <TiltCard strength={8}>
              <Card className="landing-testimonial-card" padding="lg">
                <div className="landing-testimonial-quote" style={{ color: t.color }} aria-hidden="true">"</div>
                <div className="landing-stars" aria-label="۵ ستاره">
                  {Array.from({ length: 5 }).map((_, idx) => (
                    <Icon key={idx} name="star" />
                  ))}
                </div>
                <p className="landing-testimonial-text">{t.text}</p>
                <div className="landing-testimonial-divider" style={{ background: t.color }} aria-hidden="true" />
                <strong className="landing-testimonial-name">{t.name}</strong>
              </Card>
            </TiltCard>
          </RevealSection>
        ))}
      </div>
    </section>
  );
}

function FaqSection({ openFaq, setOpenFaq }: { openFaq: number; setOpenFaq: (v: number) => void }) {
  return (
    <section id="faq" className="landing-section landing-faq-section">
      <RevealSection>
        <div className="landing-section-header">
          <div className="landing-kicker-wrap">
            <Icon name="chat" />
            <span className="landing-kicker">پرسش‌های متداول</span>
          </div>
          <h2>چیزهایی که والدین معمولاً می‌پرسند</h2>
        </div>
      </RevealSection>
      <div className="landing-faq">
        {faqs.map((faq, i) => (
          <RevealSection key={i} threshold={0.05}>
            <div className={`landing-faq-card ${openFaq === i ? 'is-open' : ''}`}>
              <button
                type="button"
                onClick={() => setOpenFaq(openFaq === i ? -1 : i)}
                aria-expanded={openFaq === i}
                aria-controls={`faq-a-${i}`}
              >
                <span>{faq.q}</span>
                <Icon name="chevron-down" />
              </button>
              <div id={`faq-a-${i}`} className="landing-faq-answer" role="region">
                <p>{faq.a}</p>
              </div>
            </div>
          </RevealSection>
        ))}
      </div>
    </section>
  );
}

function FinalCtaSection() {
  return (
    <RevealSection>
      <section className="landing-final-cta">
        <div className="landing-final-bg-shapes" aria-hidden="true" />
        <div className="landing-final-content">
          <div className="landing-kicker-wrap">
            <Icon name="spark" />
            <span className="landing-kicker">شروع یک گفت‌وگوی امن</span>
          </div>
          <h2>بگذار دانوآ همراه یادگیری و خلاقیت کودکان باشد</h2>
        </div>
        <Button type="button" size="lg" className="landing-final-btn" onClick={() => window.location.assign('/chat?auth=signup')}>
          <Icon name="spark" />
          شروع رایگان
        </Button>
      </section>
    </RevealSection>
  );
}

function LandingFooter() {
  const scrollTo = (href: string) => {
    const el = document.querySelector(href);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <footer className="landing-footer">
      <div className="landing-footer-inner">
        <a className="landing-logo" href="/" aria-label="دانوآ - صفحه اصلی">
          <span className="landing-logo-mark" aria-hidden="true">
            <Icon name="spark" />
          </span>
          <span className="landing-logo-text">دانوآ</span>
        </a>
        <nav className="landing-footer-nav" aria-label="لینک‌های فوتر">
          {navLinks.map((link) => (
            <a key={link.href} href={link.href} onClick={(e) => { e.preventDefault(); scrollTo(link.href); }}>
              {link.label}
            </a>
          ))}
        </nav>
        <div className="landing-social">
          <span className="landing-social-link" title="به‌زودی"><Icon name="chat" /></span>
          <span className="landing-social-link" title="به‌زودی"><Icon name="heart" /></span>
        </div>
      </div>
      <p className="landing-footer-copy">© ۱۴۰۴ دانوآ — همراه هوشمند کودکان فارسی‌زبان</p>
    </footer>
  );
}

function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState(-1);
  const [revealReady, setRevealReady] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) {
      menuBtnRef.current?.focus();
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  useEffect(() => {
    if (!('IntersectionObserver' in window)) return;
    const timer = setTimeout(() => setRevealReady(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const scrollTo = (href: string) => {
    setMenuOpen(false);
    const el = document.querySelector(href);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <main className={`landing${revealReady ? ' reveal-enabled' : ''}`} dir="rtl">
      <ScrollProgress />
      <BackgroundOrbs />
      <a href="#main" className="landing-skip">رفتن به محتوای اصلی</a>

      <LandingHeader menuOpen={menuOpen} setMenuOpen={setMenuOpen} scrollTo={scrollTo} menuBtnRef={menuBtnRef} />
      <MobileMenu menuOpen={menuOpen} scrollTo={scrollTo} />

      <HeroSection />
      <FeaturesSection />
      <TrustSection />
      <PricingSection />
      <TestimonialsSection />
      <FaqSection openFaq={openFaq} setOpenFaq={setOpenFaq} />
      <FinalCtaSection />
      <LandingFooter />
    </main>
  );
}

export default LandingPage;
