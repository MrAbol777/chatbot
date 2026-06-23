import { useState } from 'react';
import './PlansPage.css';

type BillingCycle = 'monthly' | 'daily';

type Plan = {
  id: 'free' | 'gold' | 'diamond';
  name: string;
  icon: string;
  tagline?: string;
  price?: string;
  priceSuffix?: string;
  badge?: string;
  features: string[];
};

const plans: Plan[] = [
  {
    id: 'free',
    name: 'رایگان',
    icon: '😊',
    tagline: 'مناسب برای شروع',
    features: ['۲۰ پیام در روز']
  },
  {
    id: 'gold',
    name: 'طلایی',
    icon: '⭐',
    price: '۹۹,۰۰۰',
    priceSuffix: '/تومان',
    badge: 'محبوب‌ترین انتخاب',
    features: ['۱۰۰ پیام در روز', 'ساخت ۱۰ تصویر در روز']
  },
  {
    id: 'diamond',
    name: 'الماسی',
    icon: '💎',
    tagline: 'بدون محدودیت',
    price: '۱۹۹,۰۰۰',
    priceSuffix: '/تومان',
    features: ['پیام نامحدود', 'ساخت تصویر نامحدود']
  }
];

function goToChat(mode: 'signup' | 'login' = 'signup') {
  window.location.href = `/chat?auth=${mode}`;
}

function goBack() {
  if (window.history.length > 1) {
    window.history.back();
    return;
  }

  window.location.href = '/';
}

function CheckIcon() {
  return (
    <svg className="plans-check" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function NavIcon({ name }: { name: 'home' | 'chat' | 'tools' | 'profile' }) {
  if (name === 'home') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10Z" />
      </svg>
    );
  }

  if (name === 'chat') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21 11.5c0 4.14-4.03 7.5-9 7.5a10.5 10.5 0 0 1-4.52-1L3 19l1.4-3.28A6.76 6.76 0 0 1 3 11.5C3 7.36 7.03 4 12 4s9 3.36 9 7.5Z" />
      </svg>
    );
  }

  if (name === 'tools') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m14.7 6.3 3-3a4 4 0 0 1-5 5l-6.4 6.4a2 2 0 1 0 3 3l6.4-6.4a4 4 0 0 1 5 5l-3 3" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 21a8 8 0 0 0-16 0" />
      <path d="M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z" />
    </svg>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  return (
    <article
      className={`plans-card plans-card-${plan.id}`}
      onClick={() => goToChat('signup')}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          goToChat('signup');
        }
      }}
      aria-label={`انتخاب پلن ${plan.name}`}
    >
      {plan.badge ? <span className="plans-badge">{plan.badge}</span> : null}
      <div className="plans-card-glow" aria-hidden="true" />
      <div className="plans-icon-wrap" aria-hidden="true">
        <span>{plan.icon}</span>
      </div>
      <h2>{plan.name}</h2>
      {plan.tagline ? <p className="plans-tagline">{plan.tagline}</p> : null}
      {plan.price ? (
        <div className="plans-price">
          <strong>{plan.price}</strong>
          <span>{plan.priceSuffix}</span>
        </div>
      ) : (
        <button type="button" className="plans-free-button" onClick={() => goToChat('signup')}>
          رایگان
        </button>
      )}
      <ul>
        {plan.features.map((feature) => (
          <li key={feature}>
            <span>{feature}</span>
            <CheckIcon />
          </li>
        ))}
      </ul>
    </article>
  );
}

function PlansPage() {
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');

  return (
    <div className="plans-page" dir="rtl">
      <div className="plans-bg-top" aria-hidden="true" />
      <div className="plans-bg-mint" aria-hidden="true" />
      <div className="plans-bg-purple" aria-hidden="true" />

      <header className="plans-topbar">
        <button type="button" className="plans-back" onClick={goBack} aria-label="بازگشت">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        </button>
      </header>

      <main className="plans-main">
        <section className="plans-heading" aria-labelledby="plans-title">
          <h1 id="plans-title">
            پلن‌های اشتراک <span aria-hidden="true">👑</span>
          </h1>
          <p>
            پلنی که بهت میخوره رو انتخاب کن <span aria-hidden="true">✨</span>
          </p>
        </section>

        <div className="plans-toggle" role="tablist" aria-label="دوره پرداخت">
          <span className={`plans-toggle-indicator is-${billingCycle}`} aria-hidden="true" />
          <button
            type="button"
            role="tab"
            aria-selected={billingCycle === 'daily'}
            onClick={() => setBillingCycle('daily')}
          >
            روزانه
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={billingCycle === 'monthly'}
            onClick={() => setBillingCycle('monthly')}
          >
            ماهانه
          </button>
        </div>

        <div className="plans-list">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </div>
      </main>

      <nav className="plans-bottom-nav" aria-label="ناوبری اصلی">
        <button type="button" onClick={() => { window.location.href = '/home'; }}>
          <NavIcon name="home" />
          <span>خانه</span>
        </button>
        <button type="button" onClick={() => { window.location.href = '/chat'; }}>
          <NavIcon name="chat" />
          <span>گفتگو</span>
        </button>
        <button type="button">
          <NavIcon name="tools" />
          <span>ابزارها</span>
        </button>
        <button type="button" className="active">
          <NavIcon name="profile" />
          <span>پروفایل</span>
        </button>
      </nav>

      <aside className="plans-desktop-nav" aria-label="ناوبری دسکتاپ">
        <h3>دانوآ</h3>
        <button type="button" onClick={() => { window.location.href = '/home'; }}>
          <NavIcon name="home" />
          <span>خانه</span>
        </button>
        <button type="button" onClick={() => { window.location.href = '/chat'; }}>
          <NavIcon name="chat" />
          <span>گفتگو</span>
        </button>
        <button type="button">
          <NavIcon name="tools" />
          <span>ابزارها</span>
        </button>
        <button type="button" className="active">
          <NavIcon name="profile" />
          <span>پروفایل</span>
        </button>
      </aside>
    </div>
  );
}

export default PlansPage;
