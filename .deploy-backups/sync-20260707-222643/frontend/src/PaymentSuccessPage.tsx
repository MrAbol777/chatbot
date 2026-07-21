import './PaymentSuccessPage.css';

const PROFILE_KEY = 'chat_profile';

const planLabels: Record<string, string> = {
  free: 'رایگان',
  gold: 'طلایی',
  golden: 'طلایی',
  diamond: 'الماسی',
  diamonds: 'الماسی'
};

function hasSavedProfile() {
  try {
    const rawProfile = localStorage.getItem(PROFILE_KEY);
    if (!rawProfile) return false;

    const parsed = JSON.parse(rawProfile) as { name?: unknown; age?: unknown };
    return typeof parsed.name === 'string' && parsed.name.trim().length > 0 && Number.isFinite(Number(parsed.age));
  } catch {
    return false;
  }
}

function getPurchasedPlanLabel() {
  const params = new URLSearchParams(window.location.search);
  const queryPlan = params.get('planName') || params.get('plan') || params.get('subscription');
  if (queryPlan?.trim()) {
    const normalized = queryPlan.trim().toLowerCase();
    return planLabels[normalized] || queryPlan.trim();
  }

  try {
    const rawPlan =
      localStorage.getItem('selected_plan') ||
      localStorage.getItem('selectedPlan') ||
      localStorage.getItem('current_plan') ||
      localStorage.getItem('currentPlan');
    if (!rawPlan?.trim()) return null;

    const parsed = JSON.parse(rawPlan) as { name?: unknown; title?: unknown; id?: unknown };
    const candidate = parsed.name || parsed.title || parsed.id;
    if (typeof candidate === 'string' && candidate.trim()) {
      const normalized = candidate.trim().toLowerCase();
      return planLabels[normalized] || candidate.trim();
    }
  } catch {
    const rawPlan =
      localStorage.getItem('selected_plan') ||
      localStorage.getItem('selectedPlan') ||
      localStorage.getItem('current_plan') ||
      localStorage.getItem('currentPlan');
    if (rawPlan?.trim()) {
      const normalized = rawPlan.trim().toLowerCase();
      return planLabels[normalized] || rawPlan.trim();
    }
  }

  return null;
}

function goBackAfterPayment() {
  window.location.href = hasSavedProfile() ? '/home' : '/';
}

function SuccessCheckIcon() {
  return (
    <svg className="payment-success-check-icon" viewBox="0 0 72 72" aria-hidden="true">
      <path d="M20 37.2 31 48l22-25" />
    </svg>
  );
}

function PaymentSuccessPage() {
  const purchasedPlanLabel = getPurchasedPlanLabel();

  return (
    <main className="payment-success-page" dir="rtl">
      <section className="payment-success-card" aria-labelledby="payment-success-title">
        <div className="payment-success-graphic" aria-hidden="true">
          <svg className="payment-confetti payment-confetti-squiggle" viewBox="0 0 24 24">
            <path d="M4 12v.01M8 12v.01M12 12v.01M16 12v.01M20 12v.01M4 8c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />
          </svg>
          <svg className="payment-confetti payment-confetti-star" viewBox="0 0 24 24">
            <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z" />
          </svg>
          <svg className="payment-confetti payment-confetti-info" viewBox="0 0 24 24">
            <path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10Zm-1-11v6h2v-6h-2Zm0-4v2h2V7h-2Z" />
          </svg>
          <svg className="payment-confetti payment-confetti-dot-large" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
          </svg>
          <span className="payment-dot payment-dot-primary" />
          <span className="payment-dot payment-dot-secondary" />
          <span className="payment-dot payment-dot-tertiary" />

          <div className="payment-success-orb">
            <span className="payment-success-orb-shine" />
            <SuccessCheckIcon />
          </div>
        </div>

        <div className="payment-success-copy">
          <h1 id="payment-success-title">
            <span aria-hidden="true">🎉</span>
            پرداخت موفق
          </h1>
          <p>
            اشتراک شما فعال شد.
            <br />
            از دانوآ لذت ببرید!
          </p>
        </div>

        {purchasedPlanLabel ? (
          <div className="payment-success-plan" aria-label="پلن خریداری‌شده">
            <span>پلن فعال</span>
            <strong>{purchasedPlanLabel}</strong>
          </div>
        ) : null}

        <button type="button" className="payment-success-action" onClick={goBackAfterPayment}>
          بازگشت به چت
        </button>
      </section>
    </main>
  );
}

export default PaymentSuccessPage;
