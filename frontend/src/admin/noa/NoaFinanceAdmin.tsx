import { FormEvent, useEffect, useMemo, useState } from 'react';
import Icon from '../../components/Icon';
import { Button, InlineMessage } from '../../design-system/components';
import {
  approveAdminNoaReceipt,
  fetchAdminNoaConfig,
  fetchAdminNoaPricing,
  listAdminNoaReceipts,
  rejectAdminNoaReceipt,
  updateAdminNoaConfig,
  updateAdminNoaPricing
} from '../../noa/noa.service';
import { divideDecimal, formatDecimalFa, formatTomanFa, normalizePositiveDecimal, toAsciiDigits } from '../../noa/decimal';
import type { NoaExchangeRate, NoaPricingConfig, NoaReceipt, NoaReceiptStatus } from '../../noa/noa.types';
import './NoaFinanceAdmin.css';

type Feedback = { kind: 'success' | 'error'; text: string } | null;
type ReceiptFilter = NoaReceiptStatus | 'all';
type ReviewDraft = {
  verifiedToman: string;
  useOverride: boolean;
  approvedNoa: string;
  reason: string;
  overrideReason: string;
};

const ACTION_LABELS: Record<string, string> = {
  text_chat: 'گفتگوی متنی و درک تصویر',
  image_generation: 'ساخت یا ویرایش تصویر',
  video_generation: 'ساخت ویدیو'
};

const UNIT_LABELS: Record<string, string> = {
  message: 'هر پیام',
  image: 'هر تصویر',
  second: 'هر ثانیه'
};

const STATUS_LABELS: Record<NoaReceiptStatus, string> = {
  pending: 'در انتظار بررسی',
  approved: 'تأییدشده',
  rejected: 'ردشده'
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

function createDraft(receipt: NoaReceipt): ReviewDraft {
  return {
    verifiedToman: receipt.declaredToman || '',
    useOverride: false,
    approvedNoa: '',
    reason: '',
    overrideReason: ''
  };
}

function NoaFinanceAdmin() {
  const [pricing, setPricing] = useState<NoaPricingConfig[]>([]);
  const [rate, setRate] = useState<NoaExchangeRate | null>(null);
  const [rateInput, setRateInput] = useState('');
  const [receipts, setReceipts] = useState<NoaReceipt[]>([]);
  const [receiptFilter, setReceiptFilter] = useState<ReceiptFilter>('pending');
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState('');
  const [feedback, setFeedback] = useState<Feedback>(null);

  const loadFinanceData = async (filter: ReceiptFilter = receiptFilter) => {
    setLoading(true);
    setFeedback(null);
    try {
      const [nextPricing, nextRate, nextReceipts] = await Promise.all([
        fetchAdminNoaPricing(),
        fetchAdminNoaConfig(),
        listAdminNoaReceipts(filter)
      ]);
      setPricing(nextPricing);
      setRate(nextRate);
      setRateInput(nextRate.tomanPerNoa);
      setReceipts(nextReceipts);
      setDrafts((current) => {
        const next = { ...current };
        nextReceipts.forEach((receipt) => {
          if (!next[receipt.receiptId]) next[receipt.receiptId] = createDraft(receipt);
        });
        return next;
      });
    } catch (cause) {
      setFeedback({
        kind: 'error',
        text: cause instanceof Error ? cause.message : 'دریافت اطلاعات مالی نوآ انجام نشد.'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadFinanceData('pending');
  }, []);

  const updatePricingDraft = (actionKey: string, patch: Partial<NoaPricingConfig>) => {
    setPricing((current) => current.map((item) => (
      item.actionKey === actionKey ? { ...item, ...patch } : item
    )));
  };

  const savePricing = async (item: NoaPricingConfig) => {
    const canonical = normalizePositiveDecimal(item.unitPrice, 6);
    if (!canonical) {
      setFeedback({ kind: 'error', text: 'قیمت نوآ باید عددی معتبر و بزرگ‌تر از صفر باشد.' });
      return;
    }
    setSavingKey(`pricing:${item.actionKey}`);
    setFeedback(null);
    try {
      const saved = await updateAdminNoaPricing(item.actionKey, {
        unitPrice: canonical,
        isActive: item.isActive,
        expectedVersion: item.version
      });
      setPricing((current) => current.map((entry) => entry.actionKey === saved.actionKey ? saved : entry));
      setFeedback({ kind: 'success', text: `قیمت «${ACTION_LABELS[item.actionKey] || item.actionKey}» ذخیره شد.` });
    } catch (cause) {
      setFeedback({ kind: 'error', text: cause instanceof Error ? cause.message : 'ذخیره قیمت انجام نشد.' });
    } finally {
      setSavingKey('');
    }
  };

  const saveRate = async (event: FormEvent) => {
    event.preventDefault();
    if (!rate) return;
    const canonical = normalizePositiveDecimal(rateInput, 6);
    if (!canonical) {
      setFeedback({ kind: 'error', text: 'نرخ تبدیل باید عددی معتبر و بزرگ‌تر از صفر باشد.' });
      return;
    }
    setSavingKey('rate');
    setFeedback(null);
    try {
      const saved = await updateAdminNoaConfig({
        tomanPerNoa: canonical,
        expectedVersion: rate.version
      });
      setRate(saved);
      setRateInput(saved.tomanPerNoa);
      setFeedback({ kind: 'success', text: 'نرخ تبدیل تومان به نوآ ذخیره شد.' });
    } catch (cause) {
      setFeedback({ kind: 'error', text: cause instanceof Error ? cause.message : 'ذخیره نرخ تبدیل انجام نشد.' });
    } finally {
      setSavingKey('');
    }
  };

  const updateDraft = (receiptId: string, patch: Partial<ReviewDraft>) => {
    setDrafts((current) => ({
      ...current,
      [receiptId]: { ...(current[receiptId] || createDraft(receipts.find((item) => item.receiptId === receiptId)!)), ...patch }
    }));
  };

  const approveReceipt = async (receipt: NoaReceipt) => {
    const draft = drafts[receipt.receiptId] || createDraft(receipt);
    const verifiedToman = normalizePositiveDecimal(draft.verifiedToman, 2);
    const approvedNoa = draft.useOverride ? normalizePositiveDecimal(draft.approvedNoa, 6) : null;
    if (!verifiedToman) {
      setFeedback({ kind: 'error', text: 'مبلغ تأییدشدهٔ رسید باید بزرگ‌تر از صفر باشد.' });
      return;
    }
    if (draft.useOverride && (!approvedNoa || draft.overrideReason.trim().length < 5)) {
      setFeedback({ kind: 'error', text: 'برای ویرایش دستی، مقدار نوآ و دلیل حداقل ۵ کاراکتری لازم است.' });
      return;
    }
    setSavingKey(`receipt:${receipt.receiptId}`);
    setFeedback(null);
    try {
      await approveAdminNoaReceipt(receipt.receiptId, {
        verifiedToman,
        ...(approvedNoa ? { approvedNoa } : {}),
        ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}),
        ...(approvedNoa ? { overrideReason: draft.overrideReason.trim() } : {})
      });
      setFeedback({ kind: 'success', text: 'رسید تأیید و اعتبار نوآ به کیف پول کاربر واریز شد.' });
      await loadFinanceData(receiptFilter);
    } catch (cause) {
      setFeedback({ kind: 'error', text: cause instanceof Error ? cause.message : 'تأیید رسید انجام نشد.' });
    } finally {
      setSavingKey('');
    }
  };

  const rejectReceipt = async (receipt: NoaReceipt) => {
    const reason = (drafts[receipt.receiptId]?.reason || '').trim();
    if (reason.length < 5) {
      setFeedback({ kind: 'error', text: 'برای رد رسید، دلیل حداقل ۵ کاراکتری ثبت کنید.' });
      return;
    }
    if (!window.confirm('این رسید رد شود؟ این عملیات در گزارش مالی ثبت می‌شود.')) return;
    setSavingKey(`receipt:${receipt.receiptId}`);
    setFeedback(null);
    try {
      await rejectAdminNoaReceipt(receipt.receiptId, reason);
      setFeedback({ kind: 'success', text: 'رسید رد شد.' });
      await loadFinanceData(receiptFilter);
    } catch (cause) {
      setFeedback({ kind: 'error', text: cause instanceof Error ? cause.message : 'رد رسید انجام نشد.' });
    } finally {
      setSavingKey('');
    }
  };

  const pendingCount = useMemo(() => receipts.filter((item) => item.status === 'pending').length, [receipts]);

  return (
    <div className="noa-finance" aria-busy={loading}>
      <header className="noa-finance__hero">
        <div>
          <span className="noa-finance__eyebrow">عملیات مالی</span>
          <h3>مرکز مالی نوآ</h3>
          <p>قیمت عملیات، نرخ تبدیل و رسیدهای واریز بانکی از داده‌های جاری سرور مدیریت می‌شوند.</p>
        </div>
        <Button type="button" variant="secondary" onClick={() => void loadFinanceData()} disabled={loading}>
          <Icon name="retry" size={18} aria-hidden="true" />
          {loading ? 'در حال دریافت…' : 'بروزرسانی'}
        </Button>
      </header>

      <div className="noa-finance__feedback" role="status" aria-live="polite">
        {feedback ? <InlineMessage text={feedback.text} variant={feedback.kind} /> : null}
      </div>

      <div className="noa-finance__overview">
        <article>
          <span>نرخ فعال</span>
          <strong>{rate ? `هر نوآ ${formatTomanFa(rate.tomanPerNoa)}` : 'در حال دریافت…'}</strong>
          <small>نسخه {rate?.version || '—'}</small>
        </article>
        <article>
          <span>قیمت‌های فعال</span>
          <strong>{new Intl.NumberFormat('fa-IR').format(pricing.filter((item) => item.isActive).length)}</strong>
          <small>از {new Intl.NumberFormat('fa-IR').format(pricing.length)} عملیات</small>
        </article>
        <article>
          <span>رسید در انتظار</span>
          <strong>{new Intl.NumberFormat('fa-IR').format(pendingCount)}</strong>
          <small>در فهرست فعلی</small>
        </article>
      </div>

      <section className="noa-finance__section" aria-labelledby="noa-rate-title">
        <div className="noa-finance__section-heading">
          <div>
            <h4 id="noa-rate-title">نرخ تبدیل تومان</h4>
            <p>این مقدار برای برآورد و تأیید خودکار رسیدها از سرور خوانده می‌شود.</p>
          </div>
        </div>
        <form className="noa-rate-form" onSubmit={saveRate}>
          <label htmlFor="noa-toman-rate">
            <span>تومان به ازای هر نوآ</span>
            <input
              id="noa-toman-rate"
              type="text"
              inputMode="decimal"
              value={rateInput}
              onChange={(event) => setRateInput(toAsciiDigits(event.target.value).replace(/[^\d.]/g, ''))}
              disabled={!rate || savingKey === 'rate'}
              aria-describedby="noa-toman-rate-help"
            />
            <small id="noa-toman-rate-help">مقدار جدید بلافاصله روی برآوردهای بعدی اثر می‌گذارد.</small>
          </label>
          <Button type="submit" disabled={!rate || savingKey === 'rate'}>
            {savingKey === 'rate' ? 'در حال ذخیره…' : 'ذخیره نرخ'}
          </Button>
        </form>
      </section>

      <section className="noa-finance__section" aria-labelledby="noa-pricing-title">
        <div className="noa-finance__section-heading">
          <div>
            <h4 id="noa-pricing-title">قیمت عملیات هوش مصنوعی</h4>
            <p>هیچ مبلغی در رابط ثابت نیست؛ دادهٔ نمایش‌داده‌شده همان پیکربندی پایگاه‌داده است.</p>
          </div>
        </div>
        <div className="noa-pricing-grid">
          {pricing.map((item) => (
            <article className="noa-pricing-card" key={item.actionKey}>
              <div className="noa-pricing-card__head">
                <div>
                  <strong>{ACTION_LABELS[item.actionKey] || item.actionKey}</strong>
                  <span>{UNIT_LABELS[item.unit] || item.unit}</span>
                </div>
                <label className="noa-switch">
                  <input
                    type="checkbox"
                    checked={item.isActive}
                    onChange={(event) => updatePricingDraft(item.actionKey, { isActive: event.target.checked })}
                  />
                  <span>فعال</span>
                </label>
              </div>
              <label htmlFor={`noa-price-${item.actionKey}`}>
                <span>هزینه (نوآ)</span>
                <input
                  id={`noa-price-${item.actionKey}`}
                  type="text"
                  inputMode="decimal"
                  value={item.unitPrice}
                  onChange={(event) => updatePricingDraft(item.actionKey, {
                    unitPrice: toAsciiDigits(event.target.value).replace(/[^\d.]/g, '')
                  })}
                />
              </label>
              <div className="noa-pricing-card__footer">
                <small>نسخه {item.version}</small>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void savePricing(item)}
                  disabled={savingKey === `pricing:${item.actionKey}`}
                >
                  {savingKey === `pricing:${item.actionKey}` ? 'در حال ذخیره…' : 'ذخیره'}
                </Button>
              </div>
            </article>
          ))}
          {!loading && pricing.length === 0 ? <InlineMessage text="پیکربندی قیمتی فعالی دریافت نشد." variant="help" /> : null}
        </div>
      </section>

      <section className="noa-finance__section" aria-labelledby="noa-receipts-admin-title">
        <div className="noa-finance__section-heading noa-finance__section-heading--receipts">
          <div>
            <h4 id="noa-receipts-admin-title">رسیدهای واریز بانکی</h4>
            <p>پیش از تأیید، مبلغ واقعی واریز را با تصویر رسید تطبیق دهید.</p>
          </div>
          <label className="noa-filter" htmlFor="noa-receipt-filter">
            <span>وضعیت</span>
            <select
              id="noa-receipt-filter"
              value={receiptFilter}
              onChange={(event) => {
                const next = event.target.value as ReceiptFilter;
                setReceiptFilter(next);
                void loadFinanceData(next);
              }}
            >
              <option value="pending">در انتظار بررسی</option>
              <option value="approved">تأییدشده</option>
              <option value="rejected">ردشده</option>
              <option value="all">همه</option>
            </select>
          </label>
        </div>

        <div className="noa-admin-receipts">
          {receipts.map((receipt) => {
            const draft = drafts[receipt.receiptId] || createDraft(receipt);
            const canonicalVerified = normalizePositiveDecimal(draft.verifiedToman, 2);
            const calculatedNoa = canonicalVerified && rate?.tomanPerNoa
              ? divideDecimal(canonicalVerified, rate.tomanPerNoa, 6)
              : null;
            const isPending = receipt.status === 'pending';
            const isSaving = savingKey === `receipt:${receipt.receiptId}`;
            return (
              <article className="noa-admin-receipt" key={receipt.receiptId}>
                <header>
                  <div>
                    <strong>{receipt.user?.name || receipt.userId || 'کاربر'}</strong>
                    <span>رسید واریز بانکی</span>
                  </div>
                  <span className={`noa-status noa-status--${receipt.status}`}>{STATUS_LABELS[receipt.status]}</span>
                </header>
                <dl className="noa-admin-receipt__facts">
                  <div><dt>مبلغ ثبت‌شده</dt><dd>{formatTomanFa(receipt.verifiedToman)}</dd></div>
                  <div><dt>زمان ثبت</dt><dd>{formatDate(receipt.submittedAt)}</dd></div>
                  <div><dt>نوآ نهایی</dt><dd>{formatDecimalFa(receipt.approvedNoa || receipt.calculatedNoa)} نوآ</dd></div>
                </dl>
                <a
                  className="noa-admin-receipt__image"
                  href={receipt.imageUrl || `/api/admin/noa/receipts/${encodeURIComponent(receipt.receiptId)}/image`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon name="external-link" size={16} aria-hidden="true" />
                  مشاهده تصویر رسید
                </a>

                {isPending ? (
                  <div className="noa-admin-receipt__review">
                    <label htmlFor={`verified-${receipt.receiptId}`}>
                      <span>مبلغ تأییدشده (تومان)</span>
                      <input
                        id={`verified-${receipt.receiptId}`}
                        type="text"
                        inputMode="decimal"
                        value={draft.verifiedToman}
                        onChange={(event) => updateDraft(receipt.receiptId, {
                          verifiedToman: toAsciiDigits(event.target.value).replace(/[^\d.]/g, '')
                        })}
                        disabled={isSaving}
                      />
                    </label>
                    <div className="noa-admin-receipt__calculation" aria-live="polite">
                      <span>محاسبه خودکار با نرخ فعلی</span>
                      <strong>{calculatedNoa ? `${formatDecimalFa(calculatedNoa)} نوآ` : 'مبلغ معتبر وارد کنید'}</strong>
                    </div>
                    <label className="noa-override-toggle">
                      <input
                        type="checkbox"
                        checked={draft.useOverride}
                        onChange={(event) => updateDraft(receipt.receiptId, { useOverride: event.target.checked })}
                        disabled={isSaving}
                      />
                      <span>ویرایش دستی مقدار نوآ</span>
                    </label>
                    {draft.useOverride ? (
                      <div className="noa-admin-receipt__override">
                        <label htmlFor={`override-noa-${receipt.receiptId}`}>
                          <span>مقدار نوآ نهایی</span>
                          <input
                            id={`override-noa-${receipt.receiptId}`}
                            type="text"
                            inputMode="decimal"
                            value={draft.approvedNoa}
                            onChange={(event) => updateDraft(receipt.receiptId, {
                              approvedNoa: toAsciiDigits(event.target.value).replace(/[^\d.]/g, '')
                            })}
                            disabled={isSaving}
                          />
                        </label>
                        <label htmlFor={`override-reason-${receipt.receiptId}`}>
                          <span>دلیل ویرایش دستی</span>
                          <textarea
                            id={`override-reason-${receipt.receiptId}`}
                            rows={2}
                            value={draft.overrideReason}
                            onChange={(event) => updateDraft(receipt.receiptId, { overrideReason: event.target.value })}
                            disabled={isSaving}
                          />
                        </label>
                      </div>
                    ) : null}
                    <label htmlFor={`review-reason-${receipt.receiptId}`}>
                      <span>یادداشت بررسی / دلیل رد</span>
                      <textarea
                        id={`review-reason-${receipt.receiptId}`}
                        rows={2}
                        value={draft.reason}
                        onChange={(event) => updateDraft(receipt.receiptId, { reason: event.target.value })}
                        disabled={isSaving}
                      />
                    </label>
                    <div className="noa-admin-receipt__actions">
                      <Button type="button" onClick={() => void approveReceipt(receipt)} disabled={isSaving || !rate}>
                        {isSaving ? 'در حال ثبت…' : 'تأیید و واریز نوآ'}
                      </Button>
                      <Button type="button" variant="danger" onClick={() => void rejectReceipt(receipt)} disabled={isSaving}>
                        رد رسید
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="noa-admin-receipt__result">
                    <p>{receipt.reviewReason || 'بدون یادداشت بررسی'}</p>
                    {receipt.manualOverride ? <small>مقدار نوآ با ویرایش دستی مدیر ثبت شده است.</small> : null}
                  </div>
                )}
              </article>
            );
          })}
          {!loading && receipts.length === 0 ? (
            <div className="noa-admin-receipts__empty">
              <Icon name="credit-card" size={30} aria-hidden="true" />
              <strong>رسیدی در این وضعیت وجود ندارد</strong>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export default NoaFinanceAdmin;
