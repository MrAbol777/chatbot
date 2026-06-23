import { useState } from 'react';
import { Button, Card } from './design-system/components';
import './DanuaLanding.css';

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

const plans = [
  {
    name: 'رایگان',
    price: '۰ تومان',
    detail: 'برای شروع و آشنایی',
    items: ['🎁 ۲۰ پیام در روز', '💬 گفتگوی آموزشی و خلاقانه', '🌟 مناسب تجربه اولیه'],
    tone: 'blue'
  },
  {
    name: 'طلایی',
    price: '۹۹,۰۰۰ تومان',
    detail: 'ماهانه',
    items: ['🎯 ۱۰۰ پیام در روز', '🖼️ ۱۰ ساخت تصویر در روز', '⭐ انتخاب محبوب خانواده ها'],
    tone: 'gold',
    popular: true
  },
  {
    name: 'الماس',
    price: '۱۹۹,۰۰۰ تومان',
    detail: 'ماهانه',
    items: ['🚀 پیام نامحدود', '💎 ساخت تصویر نامحدود', '⚡ برای استفاده روزانه و جدی'],
    tone: 'mint'
  }
];

const testimonials = [
  {
    name: 'مادر آرتین، ۹ ساله 🧒',
    text: 'دانوآ تمرین های مدرسه را با حوصله توضیح می دهد و لحنش برای بچه ها آرامش بخش است. آرتین عاشق صحبت با دانوآ شده! 💖'
  },
  {
    name: 'پدر رها، ۱۳ ساله 👧',
    text: 'برای ما مهم بود محیط فارسی، امن و قابل اعتماد باشد. رها هم از داستان ساختن با دانوآ لذت می برد. 🌈'
  },
  {
    name: 'مادر نیما، ۱۶ ساله 👦',
    text: 'وقتی سوال درسی دارد، جواب آماده نمی گیرد؛ مسیر فکر کردن را یاد می گیرد. خیلی خوبه که به جای جواب دادن، راهنمایی می کنه! 🎯'
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

function goToChat(mode: 'signup' | 'login') {
  window.location.href = `/chat?auth=${mode}`;
}

function DanuaLanding() {
  const [openFaq, setOpenFaq] = useState(0);

  return (
    <main className="danua-landing" dir="rtl">
      <header className="danua-header">
        <a className="danua-logo" href="/" aria-label="دانوآ">
          <span className="danua-logo-mark" aria-hidden="true">د</span>
          <span>دانوآ</span>
        </a>
        <nav className="danua-nav" aria-label="ناوبری لندینگ">
          <a href="#features">✨ قابلیت ها</a>
          <a href="#safety">🛡️ اعتماد والدین</a>
          <a href="#plans">💰 پلن ها</a>
          <a href="#faq">❓ سوالات</a>
        </nav>
        <Button type="button" className="danua-cta-button danua-header-cta" onClick={() => goToChat('signup')}>
          🚀 شروع رایگان
        </Button>
      </header>

      <section className="danua-hero">
        <div className="danua-hero-copy">
          <span className="danua-kicker">🤖 هووش مصنوعی فارسی برای ۵ تا ۱۸ سال</span>
          <h1>دانوآ، دوست 🤗 هوش مصنوعی بچه های تو!</h1>
          <p>
            همراهی امن، شاد و فارسی برای کمک درسی 📖، حرف زدن از احساسات 💭، ساختن قصه ✨ و تبدیل خیال بچه ها به تصویر 🎨!
          </p>
          <div className="danua-hero-actions">
            <Button type="button" size="lg" className="danua-cta-button" onClick={() => goToChat('signup')}>
              🚀 شروع رایگان
            </Button>
            <Button type="button" size="lg" variant="secondary" className="danua-soft-button" onClick={() => goToChat('login')}>
              🔐 ورود به حساب
            </Button>
          </div>
          <div className="danua-trust-row" aria-label="ویژگی های اعتماد">
            <span>🌟 مناسب سن</span>
            <span>💬 فارسی و صمیمی</span>
            <span>👨‍👩‍👧‍👦 طراحی شده برای خانواده</span>
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
                <strong>دانوآ 🌟</strong>
                <span>آنلاین و آماده کمک</span>
              </div>
            </div>
            <div className="danua-chat-preview">
              <p className="danua-bubble bot">سلام! 😊 امروز با چی شروع کنیم؟</p>
              <p className="danua-bubble user">کسرها رو ساده توضیح میدی؟</p>
              <p className="danua-bubble bot">حتما! 🍰 فکر کن یک کیک را به قسمت های برابر تقسیم کردیم...</p>
            </div>
            <div className="danua-composer">
              <span>پیامت رو بنویس...</span>
              <button type="button" aria-label="ارسال پیام">✨</button>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="danua-section">
        <div className="danua-section-heading">
          <span>🎯 چه کارهایی بلد است؟</span>
          <h2>چهار همراه کوچک برای روزهای بزرگ بچه ها! 🎉</h2>
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
          <h2>فضایی گرم، مراقب و مناسب سن! 🌸</h2>
          <p>
            دانوآ برای خانواده هایی ساخته شده که هم یادگیری و خلاقیت می خواهند، هم لحن محترمانه، محتوای مناسب سن و تجربه ای قابل اعتماد.
          </p>
          <div className="danua-safety-list">
            <span>🌈 پاسخ های ساده و سن محور</span>
            <span>💕 گفتگوی حمایتگر و بدون قضاوت</span>
            <span>🎯 تمرکز روی یادگیری، نه جایگزینی تلاش کودک</span>
          </div>
        </div>
      </section>

      <section id="plans" className="danua-section">
        <div className="danua-section-heading">
          <span>💰 پلن های اشتراک</span>
          <h2>از شروع رایگان تا همراهی نامحدود! 🚀</h2>
        </div>
        <div className="danua-plan-grid">
          {plans.map((plan) => (
            <Card key={plan.name} className={`danua-plan-card danua-plan-${plan.tone} ${plan.popular ? 'is-popular' : ''}`} padding="lg">
              {plan.popular ? <span className="danua-badge">محبوب ترین</span> : null}
              <h3>{plan.name}</h3>
              <div className="danua-price">
                <strong>{plan.price}</strong>
                <span>{plan.detail}</span>
              </div>
              <ul>
                {plan.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <Button type="button" className={plan.popular ? 'danua-cta-button' : 'danua-plan-button'} onClick={() => goToChat('signup')}>
                انتخاب پلن
              </Button>
            </Card>
          ))}
        </div>
      </section>

      <section className="danua-section">
        <div className="danua-section-heading">
          <span>💬 نظر خانواده ها</span>
          <h2>چند تجربه کوتاه از والدین شاد! 😊</h2>
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
          <h2>چیزهایی که والدین معمولا می پرسند! 🤔</h2>
        </div>
        <div className="danua-faq-list">
          {faqs.map((faq, index) => (
            <Card key={faq.question} className="danua-faq-card" padding="md">
              <button type="button" onClick={() => setOpenFaq(openFaq === index ? -1 : index)} aria-expanded={openFaq === index}>
                <span>{faq.question}</span>
                <span aria-hidden="true">{openFaq === index ? '−' : '+'}</span>
              </button>
              {openFaq === index ? <p>{faq.answer}</p> : null}
            </Card>
          ))}
        </div>
      </section>

      <section className="danua-final-cta">
        <div>
          <span className="danua-kicker">🎈 شروع یک گفتگوی امن</span>
          <h2>بگذار دانوآ کنار یادگیری و خیال پردازی بچه ها باشد! 💫</h2>
        </div>
        <Button type="button" size="lg" className="danua-cta-button" onClick={() => goToChat('signup')}>
          🌟 ثبت نام رایگان
        </Button>
      </section>

      <footer className="danua-footer">
        <a className="danua-logo" href="/" aria-label="دانوآ">
          <span className="danua-logo-mark" aria-hidden="true">د</span>
          <span>دانوآ 💜</span>
        </a>
        <div className="danua-footer-links">
          <a href="#features">✨ قابلیت ها</a>
          <a href="#plans">💰 پلن ها</a>
          <a href="#faq">💬 پشتیبانی</a>
        </div>
        <div className="danua-socials" aria-label="شبکه های اجتماعی">
          <a href="/" aria-label="اینستاگرام">📸</a>
          <a href="/" aria-label="تلگرام">✈️</a>
          <a href="/" aria-label="لینکدین">💼</a>
        </div>
      </footer>
    </main>
  );
}

export default DanuaLanding;
