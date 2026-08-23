import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Card } from './design-system/components';
import { PUBLIC_ASSETS } from './config/publicAssets';
import './Landing.css';

function useScrollReveal() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.dataset.revealed = 'true';
  }, []);

  return ref;
}

function RevealSection({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useScrollReveal();
  return <div ref={ref} className={`landing-reveal ${className}`.trim()} data-revealed="true">{children}</div>;
}

type NoaPublicConfig = {
  tomanPerNoa: string;
  pricingConfigs: Array<{ actionKey: string; unit: string; unitPriceNoa: string; isActive: boolean }>;
};

const features = [
  { icon: 'chat', number: '۰۱', title: 'چت هوشمند فارسی', text: 'گفت‌وگوی طبیعی و باهوش به فارسی؛ از کمک درسی تا ایده‌های خلاقانه، متناسب با سن کودک.', label: 'یادگیری و گفت‌وگو' },
  { icon: 'image', number: '۰۲', title: 'استودیوی تصویر', text: 'با توصیف هر چیزی که در ذهن کودک است، تصویر بساز، ویرایش کن و خلاقیت را آزاد بگذار.', label: 'خلق و خلاقیت' },
  { icon: 'video', number: '۰۳', title: 'ساخت ویدیو با AI', text: 'ایده‌ها را به ویدیو تبدیل کن؛ مناسب داستان‌ها، پروژه‌های آموزشی و سرگرمی.', label: 'ساخت محتوا' },
  { icon: 'book', number: '۰۴', title: 'داستان‌سازی خلاقانه', text: 'هر بار یک ماجرای تازه، با زبان ساده و متناسب با سلیقه و سن کودک بساز.', label: 'تخیل و سرگرمی' },
];

const testimonials = [
  { name: 'مادر آرتین، ۹ ساله', text: 'تمرین‌های ریاضی را طوری توضیح می‌دهد که خودش به جواب برسد. لحنش آرام و مناسب سنش است. دیگر نگران کمک درسی نیستم.', initials: 'آ' },
  { name: 'پدر رها، ۱۲ ساله', text: 'محیط فارسی و کنترل‌شده برای ما مهم بود. رها بیشتر از همه عاشق داستان‌سازی شده و ساعتی با دانوآ قصه می‌سازد.', initials: 'ر' },
  { name: 'مادر نیما، ۱۰ ساله', text: 'برخلاف بقیه چت‌بات‌ها، جواب آماده نمی‌دهد. کمک می‌کند خودش مسیر حل مسئله را پیدا کند. این دقیقاً همان چیزی بود که می‌خواستم.', initials: 'ن' },
];

const faqs = [
  { q: 'دانوآ مناسب چه گروه سنی‌ست؟', a: 'تمرکز اصلی دانوآ روی کودکان و نوجوانان سن مدرسه است و پاسخ‌ها با توجه به سن ثبت‌شده، ساده و قابل‌فهم ارائه می‌شوند.' },
  { q: 'چطور از امنیت محتوا مطمئن شوم؟', a: 'همه پاسخ‌ها با هوش مصنوعی در فضایی کنترل‌شده تولید می‌شوند. لحن گفتگو فارسی و مناسب سن است. هیچ محتوای نامناسبی به کودک نمایش داده نمی‌شود.' },
  { q: 'آیا دانوآ تکالیف را کامل انجام می‌دهد؟', a: 'خیر. هدف دانوآ کمک به یادگیری است، نه جایگزینی تلاش کودک. مفاهیم را توضیح می‌دهد، راهنمایی می‌کند و کودک را قدم‌به‌قدم به پاسخ می‌رساند.' },
  { q: 'چطور می‌توانم شروع کنم؟', a: 'با شماره موبایل وارد شوید، کیف پول نوآ را از بخش پروفایل شارژ کنید و فقط به اندازه عملیات انجام‌شده هزینه بپردازید.' },
  { q: 'هزینه چت، تصویر و ویدیو چطور محاسبه می‌شود؟', a: 'قیمت هر عملیات از تنظیمات زنده نوآ خوانده می‌شود. پیش از اجرا موجودی رزرو می‌شود و اگر عملیات پیش از تولید خروجی شکست بخورد، رزرو آزاد خواهد شد.' },
];

const navLinks = [
  { href: '#features', label: 'قابلیت‌ها' },
  { href: '#trust', label: 'امنیت' },
  { href: '#noa', label: 'هزینه‌ها' },
  { href: '#testimonials', label: 'نظر والدین' },
  { href: '#faq', label: 'پرسش‌ها' },
];

function Icon({ name, className = '' }: { name: string; className?: string }) {
  const props = { className: `landing-icon ${className}`.trim(), viewBox: '0 0 24 24', fill: 'none', xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': true };

  switch (name) {
    case 'chat': return <svg {...props}><path d="M8 12h.1M12 12h.1M16 12h.1M21 12c0 4.4-4 8-9 8-1.2 0-2.4-.2-3.5-.6L4 21l1.8-4.5C4.3 15 4 13.5 4 12c0-4.4 4-8 9-8s9 3.6 9 8Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case 'spark': return <svg {...props}><path d="M12 3v4m0 10v4M5 12H3m18 0h-2M7.5 7.5l-1-1m11 11-1-1M7.5 16.5l-1 1m11-11-1 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z" stroke="currentColor" strokeWidth="1.8" /></svg>;
    case 'image': return <svg {...props}><rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" /><circle cx="8.5" cy="9" r="1.5" stroke="currentColor" strokeWidth="1.6" /><path d="m4.5 17 4.2-4 3.2 3 2.3-2.2 5.3 4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case 'video': return <svg {...props}><rect x="2" y="6.5" width="16" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.8" /><path d="m18 10 4-2v8l-4-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case 'book': return <svg {...props}><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6.5a1.5 1.5 0 0 0 0 3H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M8 7h6M8 10.5h5M8 14h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
    case 'heart': return <svg {...props}><path d="M20.8 11.5C22 8.7 20.3 5 17 5c-2 0-3.5 1.5-5 3-1.5-1.5-3-3-5-3-3.3 0-5 3.7-3.8 6.5C4.5 15 12 21 12 21s7.5-6 8.8-9.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case 'shield': return <svg {...props}><path d="M12 3.5 19 6v5.4c0 4.1-2.8 7.8-7 9.1-4.2-1.3-7-5-7-9.1V6l7-2.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case 'check': return <svg {...props}><path d="m5 13 4 4L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case 'arrow-left': return <svg {...props}><path d="m15 18-6-6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case 'chevron-down': return <svg {...props}><path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case 'menu': return <svg {...props}><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
    case 'x': return <svg {...props}><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
    case 'bot': return <svg {...props}><rect x="3" y="11" width="18" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" /><circle cx="9" cy="16" r="1" fill="currentColor" /><circle cx="15" cy="16" r="1" fill="currentColor" /><path d="M8 11V8a4 4 0 0 1 8 0v3M12 4V2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
    case 'users': return <svg {...props}><circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.8" /><path d="M3.5 19c.4-3.1 2.2-5 5.5-5s5.1 1.9 5.5 5M16 5.5a3 3 0 0 1 0 5.8M17 14.2c2.1.6 3.3 2.1 3.5 4.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
    case 'wallet': return <svg {...props}><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H19a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6.5A2.5 2.5 0 0 1 4 17.5v-11Z" stroke="currentColor" strokeWidth="1.8" /><path d="M4 8h14a2 2 0 0 1 2 2v5h-5a2.5 2.5 0 1 1 0-5h5M15 12.5h.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case 'star': return <svg {...props}><path d="m12 3 2.4 4.8 5.1.8-3.7 3.5.9 5L12 15l-4.7 2.1.9-5L4.5 8.6l5-.8L12 3Z" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>;
    default: return <svg {...props}><path d="M12 3v18M3 12h18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
  }
}

function SectionHeading({ eyebrow, icon, title, description }: { eyebrow: string; icon: string; title: string; description?: string }) {
  return <div className="landing-section-header"><div className="landing-eyebrow"><Icon name={icon} /><span>{eyebrow}</span></div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>;
}

function LandingHeader({ menuOpen, setMenuOpen, scrollTo, menuBtnRef }: { menuOpen: boolean; setMenuOpen: React.Dispatch<React.SetStateAction<boolean>>; scrollTo: (href: string) => void; menuBtnRef: React.RefObject<HTMLButtonElement> }) {
  return <header className="landing-header"><a className="landing-logo" href="/landing" aria-label="دانوآ - صفحه معرفی"><span className="landing-logo-mark" aria-hidden="true"><img src={PUBLIC_ASSETS.brandMark} alt="" /></span><span className="landing-logo-text">دانوآ</span></a><nav className="landing-nav" aria-label="ناوبری اصلی">{navLinks.map((link) => <a key={link.href} href={link.href} onClick={(event) => { event.preventDefault(); scrollTo(link.href); }}>{link.label}</a>)}</nav><div className="landing-header-actions"><Button type="button" className="landing-header-cta" onClick={() => window.location.assign('/chat?auth=signup')}>ساخت حساب</Button><button ref={menuBtnRef} type="button" className="landing-menu-btn" aria-label={menuOpen ? 'بستن منو' : 'فهرست'} aria-expanded={menuOpen} aria-controls="landing-mobile-menu" onClick={() => setMenuOpen((value) => !value)}>{menuOpen ? <Icon name="x" /> : <Icon name="menu" />}</button></div></header>;
}

function MobileMenu({ menuOpen, scrollTo }: { menuOpen: boolean; scrollTo: (href: string) => void }) {
  if (!menuOpen) return null;
  return <div id="landing-mobile-menu" className="landing-mobile-menu" role="dialog" aria-modal="true" aria-label="منوی ناوبری"><nav aria-label="ناوبری موبایل">{navLinks.map((link) => <a key={link.href} href={link.href} onClick={(event) => { event.preventDefault(); scrollTo(link.href); }}>{link.label}</a>)}</nav><Button type="button" size="lg" className="landing-mobile-cta" onClick={() => window.location.assign('/chat?auth=signup')}><Icon name="spark" />ساخت حساب</Button></div>;
}

function ProductPreview() {
  return <div className="landing-product-preview" aria-label="پیش‌نمایش گفت‌وگوی دانوآ"><div className="landing-preview-topbar"><div className="landing-preview-brand"><span className="landing-preview-avatar"><Icon name="bot" /></span><span><strong>گفت‌وگوی دانوآ</strong><small><i /> آنلاین و آماده‌ی کمک</small></span></div><span className="landing-preview-safe"><Icon name="shield" /> مناسب سن</span></div><div className="landing-preview-body"><div className="landing-preview-date">امروز، ۱۰:۲۴</div><div className="landing-preview-message landing-preview-message--user">می‌تونی بهم کمک کنی بفهمم چرا آسمون آبیه؟</div><div className="landing-preview-message landing-preview-message--bot"><span className="landing-preview-bot-icon"><Icon name="spark" /></span><span>حتماً! نور خورشید از رنگ‌های مختلف ساخته شده. دوست داری با یک مثال ساده با هم کشفش کنیم؟</span></div><div className="landing-preview-suggestions"><span>با مثال توضیح بده</span><span>یک آزمایش ساده</span></div></div><div className="landing-preview-input"><span>پیامت را برای دانوآ بنویس…</span><span className="landing-preview-send"><Icon name="arrow-left" /></span></div><div className="landing-preview-note"><Icon name="shield" /> پاسخ‌ها با توجه به سن ثبت‌شده‌ی کودک تنظیم می‌شوند.</div></div>;
}

function HeroSection() {
  return <section id="main" className="landing-hero"><div className="landing-hero-copy"><div className="landing-eyebrow"><Icon name="heart" /><span>برای آرامش بیشتر والدین</span></div><h1><span>دانوآ،</span><strong>همراه امن و فارسی<br className="landing-desktop-break" /> برای یادگیری کودک</strong></h1><p className="landing-hero-lead">یک فضای کنترل‌شده برای کمک درسی، گفت‌وگو و خلق‌کردن؛ جایی که کودک یاد می‌گیرد، نه اینکه فقط جواب آماده بگیرد.</p><div className="landing-hero-actions"><Button type="button" size="lg" className="landing-primary-cta" onClick={() => window.location.assign('/chat?auth=signup')}><Icon name="spark" /> ساخت حساب</Button><Button type="button" size="lg" variant="secondary" className="landing-secondary-cta" onClick={() => window.location.assign('/chat?auth=login')}>ورود به حساب <Icon name="arrow-left" /></Button></div><div className="landing-hero-proof" aria-label="مزیت‌های اصلی دانوآ"><span><Icon name="check" /> متناسب با سن</span><span><Icon name="check" /> کاملاً فارسی</span><span><Icon name="check" /> بدون اشتراک اجباری</span></div></div><div className="landing-hero-demo"><div className="landing-demo-orbit landing-demo-orbit--one" aria-hidden="true" /><div className="landing-demo-orbit landing-demo-orbit--two" aria-hidden="true" /><ProductPreview /><div className="landing-demo-badge landing-demo-badge--top"><Icon name="shield" /><span><strong>فضای کنترل‌شده</strong><small>ساخته‌شده برای خانواده‌ها</small></span></div><div className="landing-demo-badge landing-demo-badge--bottom"><span className="landing-demo-stars"><Icon name="star" /><Icon name="star" /><Icon name="star" /></span><span><strong>کمک به یادگیری</strong><small>قدم‌به‌قدم و قابل فهم</small></span></div></div></section>;
}

function FeaturesSection() {
  return <section id="features" className="landing-section"><RevealSection><SectionHeading eyebrow="قابلیت‌ها" icon="spark" title="همه‌ی ابزارهای رشد و خلاقیت، در یک جای امن" description="دانوآ برای استفاده‌ی روزمره‌ی کودک طراحی شده؛ ساده برای او، قابل اعتماد برای شما." /></RevealSection><div className="landing-features">{features.map((feature) => <article key={feature.title} className="landing-feature-card"><div className="landing-feature-top"><span className="landing-feature-number">{feature.number}</span><span className="landing-feature-icon"><Icon name={feature.icon} /></span></div><h3>{feature.title}</h3><p>{feature.text}</p><span className="landing-feature-label">{feature.label}</span></article>)}</div></section>;
}

function TrustSection() {
  return <section id="trust" className="landing-section"><RevealSection><div className="landing-trust-panel"><div className="landing-trust-art"><span className="landing-trust-art-ring" /><span className="landing-trust-art-icon"><Icon name="shield" /></span><span className="landing-trust-art-tag"><Icon name="check" /> امن و کنترل‌شده</span></div><div className="landing-trust-content"><div className="landing-eyebrow"><Icon name="heart" /><span>برای آرامش والدین</span></div><h2>فضایی امن برای یادگیری و خیال‌پردازی</h2><p>دانوآ با محتوای مناسب سن، پاسخ‌های فارسی و فضای کنترل‌شده طراحی شده تا کودک مستقل‌تر یاد بگیرد و والدین با خیال راحت‌تری همراهش باشند.</p><div className="landing-trust-items"><span><Icon name="check" /> پاسخ‌های متناسب با سن کودک</span><span><Icon name="check" /> لحن گرم و خودمانی فارسی</span><span><Icon name="check" /> تمرکز روی یادگیری، نه پاسخ آماده</span><span><Icon name="check" /> گفت‌وگو در محیط امن و کنترل‌شده</span></div><p className="landing-ai-disclosure"><Icon name="bot" /><span>پاسخ‌ها توسط هوش مصنوعی ساخته می‌شوند و ممکن است اشتباه باشند؛ بهتر است والدین پاسخ‌های مهم را همراه کودک بررسی کنند.</span></p></div></div></RevealSection></section>;
}

function NoaSection() {
  const [config, setConfig] = useState<NoaPublicConfig | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch('/api/noa/config');
        if (!response.ok) throw new Error('NOA_CONFIG_UNAVAILABLE');
        const payload = await response.json() as NoaPublicConfig;
        if (typeof payload?.tomanPerNoa !== 'string' || !Array.isArray(payload?.pricingConfigs)) throw new Error('NOA_CONFIG_INVALID');
        if (!cancelled) { setConfig(payload); setLoadError(''); }
      } catch { if (!cancelled) setLoadError('قیمت‌های لحظه‌ای نوآ اکنون در دسترس نیست؛ دوباره تلاش کنید.'); }
      finally { if (!cancelled) setLoading(false); }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  const formatLiveNumber = (value: string, maximumFractionDigits = 6) => { const numeric = Number(value); return Number.isFinite(numeric) ? new Intl.NumberFormat('fa-IR', { maximumFractionDigits }).format(numeric) : value; };
  const formatToman = (noa: string) => { const total = Number(noa) * Number(config?.tomanPerNoa); return Number.isFinite(total) ? new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(total) : '—'; };
  const actionLabels: Record<string, { title: string; icon: string; className: string }> = { text_chat: { title: 'چت و درک تصویر', icon: 'chat', className: 'chat' }, image_generation: { title: 'ساخت و ویرایش تصویر', icon: 'image', className: 'image' }, video_generation: { title: 'ساخت ویدیو', icon: 'video', className: 'video' } };
  const unitLabels: Record<string, string> = { message: 'برای هر پیام', image: 'برای هر تصویر', second: 'برای هر ثانیه' };
  const pricing = config?.pricingConfigs.filter((item) => item.isActive) || [];

  return <section id="noa" className="landing-section landing-section--soft"><SectionHeading eyebrow="کیف پول نوآ" icon="wallet" title="بدون اشتراک؛ فقط به اندازه‌ی استفاده پرداخت کن" description="قیمت‌ها مستقیماً از تنظیمات زنده‌ی سامانه خوانده می‌شوند و هزینه‌ی هر عملیات را واضح می‌بینید." />{loading ? <div className="landing-pricing-status" role="status"><span className="landing-spinner" /> در حال دریافت قیمت‌های به‌روز…</div> : null}{loadError ? <p className="landing-noa-error" role="status">{loadError}</p> : null}<div className="landing-plans">{loading ? Array.from({ length: 3 }).map((_, index) => <div className="landing-plan-card landing-plan-card--skeleton" key={index} aria-hidden="true"><span /><span /><span /><span /></div>) : null}{!loading && pricing.map((item) => { const presentation = actionLabels[item.actionKey] || { title: item.actionKey, icon: 'spark', className: 'default' }; return <article key={item.actionKey} className={`landing-plan-card landing-plan-card--${presentation.className}`}><div className="landing-plan-icon"><Icon name={presentation.icon} /></div><h3>{presentation.title}</h3><div className="landing-plan-price"><strong>{formatLiveNumber(item.unitPriceNoa)} نوآ</strong><span>{formatToman(item.unitPriceNoa)} تومان <em>{unitLabels[item.unit] || item.unit}</em></span></div><ul><li><Icon name="check" /> رزرو امن اعتبار پیش از اجرا</li><li><Icon name="check" /> آزادسازی رزرو در خطای بدون خروجی</li></ul></article>; })}</div>{config ? <div className="landing-noa-rate"><Icon name="wallet" /> هر ۱ نوآ، {formatLiveNumber(config.tomanPerNoa, 0)} تومان</div> : null}<Button type="button" size="lg" className="landing-primary-cta landing-wallet-cta" onClick={() => window.location.assign('/chat?auth=login')}><Icon name="wallet" /> ورود و شارژ کیف پول</Button></section>;
}

function TestimonialsSection() {
  return <section id="testimonials" className="landing-section"><RevealSection><SectionHeading eyebrow="نظر خانواده‌ها" icon="users" title="والدین درباره‌ی دانوآ چه می‌گویند؟" /></RevealSection><div className="landing-testimonials">{testimonials.map((testimonial) => <Card key={testimonial.name} className="landing-testimonial-card" padding="lg"><div className="landing-testimonial-heading"><span className="landing-testimonial-avatar">{testimonial.initials}</span><span><strong>{testimonial.name}</strong><small>والد یکی از کاربران دانوآ</small></span></div><div className="landing-stars" aria-label="۵ ستاره">{Array.from({ length: 5 }).map((_, index) => <Icon key={index} name="star" />)}</div><p>{testimonial.text}</p></Card>)}</div></section>;
}

function FaqSection({ openFaq, setOpenFaq }: { openFaq: number; setOpenFaq: (value: number) => void }) {
  return <section id="faq" className="landing-section landing-faq-section"><RevealSection><SectionHeading eyebrow="پرسش‌های متداول" icon="chat" title="قبل از شروع، این‌ها را بدانید" /></RevealSection><div className="landing-faq">{faqs.map((faq, index) => { const answerId = `faq-a-${index}`; const questionId = `faq-q-${index}`; return <div key={faq.q} className={`landing-faq-card ${openFaq === index ? 'is-open' : ''}`}><button id={questionId} type="button" onClick={() => setOpenFaq(openFaq === index ? -1 : index)} aria-expanded={openFaq === index} aria-controls={answerId}><span>{faq.q}</span><Icon name="chevron-down" /></button><div id={answerId} className="landing-faq-answer" role="region" aria-labelledby={questionId}><p>{faq.a}</p></div></div>; })}</div></section>;
}

function FinalCtaSection() {
  return <section className="landing-final-cta"><div><div className="landing-eyebrow landing-eyebrow--inverse"><Icon name="spark" /><span>شروع یک گفت‌وگوی امن</span></div><h2>بگذار دانوآ همراه یادگیری و خلاقیت کودکان باشد</h2><p>همین امروز یک فضای امن و فارسی برای کنجکاوی کودک بسازید.</p></div><Button type="button" size="lg" className="landing-final-btn" onClick={() => window.location.assign('/chat?auth=signup')}><Icon name="spark" /> ساخت حساب</Button></section>;
}

function LandingFooter() {
  const scrollTo = (href: string) => document.querySelector(href)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return <footer className="landing-footer"><div className="landing-footer-inner"><a className="landing-logo" href="/landing" aria-label="دانوآ - صفحه معرفی"><span className="landing-logo-mark" aria-hidden="true"><img src={PUBLIC_ASSETS.brandMark} alt="" /></span><span className="landing-logo-text">دانوآ</span></a><nav className="landing-footer-nav" aria-label="لینک‌های فوتر">{navLinks.map((link) => <a key={link.href} href={link.href} onClick={(event) => { event.preventDefault(); scrollTo(link.href); }}>{link.label}</a>)}</nav><span className="landing-footer-note"><Icon name="heart" /> ساخته‌شده برای خانواده‌های فارسی‌زبان</span></div><p className="landing-footer-copy">© ۱۴۰۴ دانوآ — همراه هوشمند کودکان فارسی‌زبان</p></footer>;
}

function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState(-1);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const menu = document.getElementById('landing-mobile-menu');
    const focusable = menu ? Array.from(menu.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')) : [];
    document.body.style.overflow = 'hidden';
    const focusFrame = window.requestAnimationFrame(() => focusable[0]?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false); return; }
      if (event.key === 'Tab' && focusable.length > 0) { const first = focusable[0]; const last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); window.cancelAnimationFrame(focusFrame); document.body.style.overflow = previousOverflow; (previousFocus || menuBtnRef.current)?.focus(); };
  }, [menuOpen]);

  const scrollTo = (href: string) => { setMenuOpen(false); document.querySelector(href)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  return <main className="landing" dir="rtl"><a href="#main" className="landing-skip">رفتن به محتوای اصلی</a><LandingHeader menuOpen={menuOpen} setMenuOpen={setMenuOpen} scrollTo={scrollTo} menuBtnRef={menuBtnRef} /><MobileMenu menuOpen={menuOpen} scrollTo={scrollTo} /><HeroSection /><FeaturesSection /><TrustSection /><NoaSection /><TestimonialsSection /><FaqSection openFaq={openFaq} setOpenFaq={setOpenFaq} /><FinalCtaSection /><LandingFooter /></main>;
}

export default LandingPage;
