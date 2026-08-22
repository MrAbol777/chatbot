import { FormEvent, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../components/Icon';
import { Button, Dialog, InlineMessage, useNotification } from '../../design-system/components';
import {
  approveAdminNoaReceipt,
  adjustAdminNoaWallet,
  createIdempotencyKey,
  fetchAdminNoaReceiptImage,
  fetchAdminNoaUserWallet,
  fetchAdminNoaBankTransferAccount,
  fetchAdminNoaConfig,
  fetchAdminNoaPricing,
  listAdminNoaReceipts,
  rejectAdminNoaReceipt,
  searchAdminNoaUsers,
  updateAdminNoaConfig,
  updateAdminNoaBankTransferAccount,
  updateAdminNoaPricing
} from '../../noa/noa.service';
import { divideDecimal, formatDecimalFa, formatTomanFa, normalizePositiveDecimal, toAsciiDigits } from '../../noa/decimal';
import type { AdminNoaUser, AdminNoaUserWallet, NoaBankTransferAccount, NoaExchangeRate, NoaPricingConfig, NoaReceipt, NoaReceiptStatus } from '../../noa/noa.types';
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

type ReceiptDecision = {
  receipt: NoaReceipt;
  action: 'approve' | 'reject';
  verifiedToman: string | null;
  approvedNoa: string | null;
  creditNoa: string | null;
  reason: string;
  overrideReason: string;
};

type ReceiptPreview = {
  receipt: NoaReceipt;
  url: string | null;
  loading: boolean;
  error: string | null;
};

const ACTION_LABELS: Record<string, string> = {
  text_chat: 'گفتگوی متنی',
  image_understanding: 'تحلیل تصویر',
  image_generation: 'ساخت تصویر از متن',
  image_to_image: 'ویرایش تصویر با مرجع',
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
  const { confirm } = useNotification();
  const [pricing, setPricing] = useState<NoaPricingConfig[]>([]);
  const [rate, setRate] = useState<NoaExchangeRate | null>(null);
  const [rateInput, setRateInput] = useState('');
  const [bankTransferAccount, setBankTransferAccount] = useState<NoaBankTransferAccount | null>(null);
  const [cardNumberInput, setCardNumberInput] = useState('');
  const [cardHolderNameInput, setCardHolderNameInput] = useState('');
  const [receipts, setReceipts] = useState<NoaReceipt[]>([]);
  const [receiptFilter, setReceiptFilter] = useState<ReceiptFilter>('pending');
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [receiptErrors, setReceiptErrors] = useState<Record<string, string>>({});
  const [receiptDecision, setReceiptDecision] = useState<ReceiptDecision | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<ReceiptPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState('');
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [walletFeedback, setWalletFeedback] = useState<Feedback>(null);
  const [recipientQuery, setRecipientQuery] = useState('');
  const [recipientResults, setRecipientResults] = useState<AdminNoaUser[]>([]);
  const [selectedRecipient, setSelectedRecipient] = useState<AdminNoaUser | null>(null);
  const [selectedWallet, setSelectedWallet] = useState<AdminNoaUserWallet | null>(null);
  const [adjustmentDirection, setAdjustmentDirection] = useState<'increase' | 'decrease'>('increase');
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [adjustmentNote, setAdjustmentNote] = useState('');
  const [adjustmentKey, setAdjustmentKey] = useState(() => createIdempotencyKey('admin-wallet-adjustment'));

  const loadFinanceData = async (filter: ReceiptFilter = receiptFilter) => {
    setLoading(true);
    setFeedback(null);
    try {
      const [nextPricing, nextRate, nextBankTransferAccount, nextReceipts] = await Promise.all([
        fetchAdminNoaPricing(),
        fetchAdminNoaConfig(),
        fetchAdminNoaBankTransferAccount(),
        listAdminNoaReceipts(filter)
      ]);
      setPricing(nextPricing);
      setRate(nextRate);
      setRateInput(nextRate.tomanPerNoa);
      setBankTransferAccount(nextBankTransferAccount);
      setCardNumberInput(nextBankTransferAccount?.cardNumber || '');
      setCardHolderNameInput(nextBankTransferAccount?.cardHolderName || '');
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

  useEffect(() => {
    if (!receiptPreview) return;
    let active = true;
    let objectUrl: string | null = null;
    void fetchAdminNoaReceiptImage(receiptPreview.receipt.receiptId)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) {
          setReceiptPreview((current) => current ? { ...current, url: objectUrl, loading: false } : current);
        } else if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
        }
      })
      .catch((cause) => {
        if (active) {
          setReceiptPreview((current) => current ? {
            ...current,
            loading: false,
            error: cause instanceof Error ? cause.message : 'دریافت تصویر رسید انجام نشد.'
          } : current);
        }
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [receiptPreview?.receipt.receiptId]);

  useEffect(() => {
    if (selectedRecipient || recipientQuery.trim().length < 2) {
      setRecipientResults([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void searchAdminNoaUsers(recipientQuery)
        .then((items) => { if (active) setRecipientResults(items); })
        .catch(() => { if (active) setRecipientResults([]); });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [recipientQuery, selectedRecipient]);

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

  const saveBankTransferAccount = async (event: FormEvent) => {
    event.preventDefault();
    const cardNumber = toAsciiDigits(cardNumberInput).replace(/\D/g, '');
    const cardHolderName = cardHolderNameInput.trim();
    if (!/^\d{16}$/.test(cardNumber)) {
      setFeedback({ kind: 'error', text: 'شماره کارت باید دقیقاً ۱۶ رقم باشد.' });
      return;
    }
    if (!cardHolderName) {
      setFeedback({ kind: 'error', text: 'نام مالک کارت را وارد کنید.' });
      return;
    }
    setSavingKey('bank-account');
    setFeedback(null);
    try {
      const saved = await updateAdminNoaBankTransferAccount({
        cardNumber,
        cardHolderName,
        expectedVersion: bankTransferAccount?.version || null
      });
      setBankTransferAccount(saved);
      setCardNumberInput(saved.cardNumber);
      setCardHolderNameInput(saved.cardHolderName);
      setFeedback({ kind: 'success', text: 'کارت مقصد واریز بانکی ذخیره شد.' });
    } catch (cause) {
      setFeedback({ kind: 'error', text: cause instanceof Error ? cause.message : 'ذخیره کارت مقصد انجام نشد.' });
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

  const requestApproveReceipt = (receipt: NoaReceipt) => {
    const draft = drafts[receipt.receiptId] || createDraft(receipt);
    const verifiedToman = normalizePositiveDecimal(draft.verifiedToman, 2);
    const approvedNoa = draft.useOverride ? normalizePositiveDecimal(draft.approvedNoa, 6) : null;
    if (!verifiedToman) {
      setReceiptErrors((current) => ({ ...current, [receipt.receiptId]: 'مبلغ تأییدشده را وارد کنید.' }));
      return;
    }
    if (draft.useOverride && (!approvedNoa || draft.overrideReason.trim().length < 5)) {
      setReceiptErrors((current) => ({ ...current, [receipt.receiptId]: 'برای ویرایش دستی، مقدار نوآ و دلیل حداقل ۵ کاراکتری لازم است.' }));
      return;
    }
    const calculatedNoa = rate?.tomanPerNoa
      ? divideDecimal(verifiedToman, rate.tomanPerNoa, 6)
      : null;
    if (!calculatedNoa) {
      setReceiptErrors((current) => ({ ...current, [receipt.receiptId]: 'با نرخ فعلی، مقدار نوآ قابل محاسبه نیست.' }));
      return;
    }
    setReceiptErrors((current) => ({ ...current, [receipt.receiptId]: '' }));
    setReceiptDecision({
      receipt,
      action: 'approve',
      verifiedToman,
      approvedNoa,
      creditNoa: approvedNoa || calculatedNoa,
      reason: draft.reason.trim(),
      overrideReason: draft.overrideReason.trim()
    });
  };

  const requestRejectReceipt = (receipt: NoaReceipt) => {
    const reason = (drafts[receipt.receiptId]?.reason || '').trim();
    if (reason.length < 5) {
      setReceiptErrors((current) => ({ ...current, [receipt.receiptId]: 'برای رد رسید، نوشتن دلیل حداقل ۵ کاراکتری الزامی است.' }));
      return;
    }
    setReceiptErrors((current) => ({ ...current, [receipt.receiptId]: '' }));
    setReceiptDecision({
      receipt,
      action: 'reject',
      verifiedToman: null,
      approvedNoa: null,
      creditNoa: null,
      reason,
      overrideReason: ''
    });
  };

  const submitReceiptDecision = async () => {
    if (!receiptDecision) return;
    const { receipt, action, verifiedToman, approvedNoa, creditNoa, reason, overrideReason } = receiptDecision;
    setSavingKey(`receipt:${receipt.receiptId}`);
    setFeedback(null);
    try {
      if (action === 'approve' && verifiedToman) {
        await approveAdminNoaReceipt(receipt.receiptId, {
          verifiedToman,
          ...(approvedNoa ? { approvedNoa } : {}),
          ...(reason ? { reason } : {}),
          ...(approvedNoa ? { overrideReason } : {})
        });
        setFeedback({ kind: 'success', text: `رسید تأیید شد؛ ${formatDecimalFa(creditNoa || '0')} نوآ به کیف پول کاربر اضافه و اعلان داخل‌اپ ارسال شد.` });
      } else {
        await rejectAdminNoaReceipt(receipt.receiptId, reason);
        setFeedback({ kind: 'success', text: 'رسید رد شد و دلیل آن در اعلان داخل‌اپ برای کاربر ارسال شد.' });
      }
      setReceiptDecision(null);
      await loadFinanceData(receiptFilter);
    } catch (cause) {
      setFeedback({ kind: 'error', text: cause instanceof Error ? cause.message : `${action === 'approve' ? 'تأیید' : 'رد'} رسید انجام نشد.` });
    } finally {
      setSavingKey('');
    }
  };

  const selectRecipient = async (user: AdminNoaUser) => {
    setSelectedRecipient(user);
    setRecipientResults([]);
    setSelectedWallet(null);
    setWalletFeedback(null);
    setSavingKey('wallet-lookup');
    try {
      setSelectedWallet(await fetchAdminNoaUserWallet(user.userId));
    } catch (cause) {
      setWalletFeedback({ kind: 'error', text: cause instanceof Error ? cause.message : 'دریافت موجودی کاربر انجام نشد.' });
    } finally {
      setSavingKey('');
    }
  };

  const submitWalletAdjustment = async (event: FormEvent) => {
    event.preventDefault();
    const amountNoa = normalizePositiveDecimal(adjustmentAmount, 6);
    if (!selectedRecipient || !selectedWallet) {
      setWalletFeedback({ kind: 'error', text: 'ابتدا یک کاربر را انتخاب کنید تا موجودی کیف پول او خوانده شود.' });
      return;
    }
    if (!amountNoa) {
      setWalletFeedback({ kind: 'error', text: 'مقدار نوآ باید عددی معتبر و بزرگ‌تر از صفر باشد.' });
      return;
    }
    const action = adjustmentDirection === 'increase' ? 'اضافه شود' : 'کسر شود';
    const confirmation = `آیا ${formatDecimalFa(amountNoa)} نوآ از کیف پول «${selectedRecipient.name}» ${action}؟\n\nموجودی می‌تواند منفی شود و این تراکنش در دفترکل مالی ثبت می‌شود.`;
    const approved = await confirm({
      message: confirmation,
      confirmText: adjustmentDirection === 'increase' ? 'افزایش موجودی' : 'کسر موجودی',
      cancelText: 'انصراف'
    });
    if (!approved) return;
    void applyWalletAdjustment();
  };

  const applyWalletAdjustment = async () => {
    const amountNoa = normalizePositiveDecimal(adjustmentAmount, 6);
    if (!selectedRecipient || !amountNoa) return;
    setSavingKey('wallet-adjustment');
    setWalletFeedback(null);
    try {
      const result = await adjustAdminNoaWallet({
        userId: selectedRecipient.userId,
        amountNoa,
        direction: adjustmentDirection,
        note: adjustmentNote.trim(),
        idempotencyKey: adjustmentKey
      });
      setSelectedWallet((current) => current ? { ...current, wallet: result.wallet } : current);
      setWalletFeedback({
        kind: 'success',
        text: `${formatDecimalFa(result.amountNoa)} نوآ با موفقیت ${adjustmentDirection === 'increase' ? 'اضافه' : 'کسر'} شد.`
      });
      setAdjustmentAmount('');
      setAdjustmentNote('');
      setAdjustmentKey(createIdempotencyKey('admin-wallet-adjustment'));
    } catch (cause) {
      setWalletFeedback({ kind: 'error', text: cause instanceof Error ? cause.message : 'تغییر موجودی نوآ انجام نشد.' });
    } finally {
      setSavingKey('');
    }
  };

  const pendingCount = useMemo(() => receipts.filter((item) => item.status === 'pending').length, [receipts]);

  return (
    <div className="noa-finance" aria-busy={loading}>
      <header className="noa-finance__hero">
        <div>
          <span className="noa-finance__eyebrow">نوآ و قیمت‌گذاری</span>
          <h3>مرکز کنترل نوآ</h3>
          <p>هزینهٔ هر قابلیت متصل به API، نرخ تبدیل و رسیدهای واریز از داده‌های زندهٔ سرور مدیریت می‌شوند.</p>
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

      <section className="noa-finance__section noa-manual-credit" aria-labelledby="noa-user-wallet-title">
        <div className="noa-finance__section-heading">
          <div>
            <h4 id="noa-user-wallet-title">مدیریت نوآ کاربران</h4>
            <p>کاربر را با نام، شماره یا شناسه یکتا پیدا کنید؛ موجودی را ببینید و آن را افزایش یا کاهش دهید.</p>
          </div>
        </div>
        {walletFeedback ? <InlineMessage text={walletFeedback.text} variant={walletFeedback.kind} /> : null}
        <form className="noa-manual-credit__form" onSubmit={(e) => { void submitWalletAdjustment(e); }}>
          <div className="noa-user-picker">
            <label htmlFor="noa-wallet-user">
              <span>کاربر مقصد</span>
              <input
                id="noa-wallet-user"
                type="search"
                autoComplete="off"
                placeholder="نام، شماره یا شناسه کاربر را وارد کنید"
                value={selectedRecipient ? `${selectedRecipient.name}${selectedRecipient.phone ? ` — ${selectedRecipient.phone}` : ''}` : recipientQuery}
                onChange={(event) => {
                  setSelectedRecipient(null);
                  setSelectedWallet(null);
                  setWalletFeedback(null);
                  setRecipientQuery(event.target.value);
                }}
                disabled={savingKey === 'wallet-adjustment' || savingKey === 'wallet-lookup'}
                aria-label="کاربر مقصد"
                aria-describedby="noa-wallet-user-help"
              />
              <small id="noa-wallet-user-help">از نتیجه‌ها یک کاربر را انتخاب کنید تا موجودی به‌روز او خوانده شود.</small>
            </label>
            {recipientResults.length > 0 ? (
              <div className="noa-user-picker__results" role="listbox" aria-label="نتایج جست‌وجوی کاربر">
                {recipientResults.map((user) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedRecipient?.userId === user.userId}
                    key={user.userId}
                    onClick={() => void selectRecipient(user)}
                  >
                    <strong>{user.name}</strong>
                    <span>{user.phone || user.userId}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {selectedRecipient ? <p className="noa-user-picker__selected">کاربر انتخاب‌شده: <strong>{selectedRecipient.name}</strong> <span>({selectedRecipient.userId})</span></p> : null}
          </div>
          <div className="noa-wallet-balance" aria-live="polite">
            <span>موجودی قابل استفاده</span>
            <strong>{selectedWallet ? `${formatDecimalFa(selectedWallet.wallet.availableBalance)} نوآ` : savingKey === 'wallet-lookup' ? 'در حال دریافت…' : 'کاربر را انتخاب کنید'}</strong>
            {selectedWallet ? <small>رزروشده: {formatDecimalFa(selectedWallet.wallet.reservedBalance)} نوآ</small> : null}
          </div>
          <div className="noa-adjustment-direction" role="group" aria-label="نوع تغییر موجودی">
            <button type="button" className={adjustmentDirection === 'increase' ? 'is-active is-increase' : ''} onClick={() => setAdjustmentDirection('increase')} disabled={savingKey === 'wallet-adjustment'}>افزایش</button>
            <button type="button" className={adjustmentDirection === 'decrease' ? 'is-active is-decrease' : ''} onClick={() => setAdjustmentDirection('decrease')} disabled={savingKey === 'wallet-adjustment'}>کاهش</button>
          </div>
          <label htmlFor="noa-wallet-amount">
            <span>مقدار نوآ</span>
            <input
              id="noa-wallet-amount"
              type="text"
              inputMode="decimal"
              placeholder="مثلاً 300"
              value={adjustmentAmount}
              onChange={(event) => setAdjustmentAmount(toAsciiDigits(event.target.value).replace(/[^\d.]/g, ''))}
              disabled={savingKey === 'wallet-adjustment' || !selectedWallet}
            />
          </label>
          <label className="noa-manual-credit__reason" htmlFor="noa-wallet-note">
            <span>یادداشت برای کاربر <small>(اختیاری)</small></span>
            <textarea
              id="noa-wallet-note"
              rows={2}
              maxLength={500}
              placeholder="اگر بنویسید، یک‌بار هنگام ورود به کاربر نمایش داده می‌شود."
              value={adjustmentNote}
              onChange={(event) => setAdjustmentNote(event.target.value)}
              disabled={savingKey === 'wallet-adjustment' || !selectedWallet}
            />
          </label>
          <Button type="submit" loading={savingKey === 'wallet-adjustment'} disabled={savingKey === 'wallet-adjustment' || !selectedWallet}>
            ثبت تغییر موجودی
          </Button>
        </form>
      </section>

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

      <section className="noa-finance__section" aria-labelledby="noa-bank-account-title">
        <div className="noa-finance__section-heading">
          <div>
            <h4 id="noa-bank-account-title">کارت مقصد واریز بانکی</h4>
            <p>شماره کارت و نام مالک در صفحه کیف پول کاربران نمایش داده می‌شود و در کد ثابت نیست.</p>
          </div>
        </div>
        <form className="noa-bank-account-form" onSubmit={saveBankTransferAccount}>
          <label htmlFor="noa-bank-card-number">
            <span>شماره کارت</span>
            <input
              id="noa-bank-card-number"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={19}
              placeholder="۱۶ رقم شماره کارت"
              value={cardNumberInput}
              onChange={(event) => setCardNumberInput(toAsciiDigits(event.target.value).replace(/\D/g, '').slice(0, 16))}
              disabled={savingKey === 'bank-account'}
            />
          </label>
          <label htmlFor="noa-bank-card-holder">
            <span>به نام</span>
            <input
              id="noa-bank-card-holder"
              type="text"
              autoComplete="off"
              maxLength={191}
              placeholder="نام و نام خانوادگی مالک کارت"
              value={cardHolderNameInput}
              onChange={(event) => setCardHolderNameInput(event.target.value)}
              disabled={savingKey === 'bank-account'}
            />
          </label>
          <Button type="submit" disabled={savingKey === 'bank-account'}>
            {savingKey === 'bank-account' ? 'در حال ذخیره…' : 'ذخیره کارت'}
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
            const receiptError = receiptErrors[receipt.receiptId];
            return (
              <article className={`noa-admin-receipt${isPending ? ' is-pending' : ''}`} key={receipt.receiptId}>
                <header className="noa-admin-receipt__header">
                  <div className="noa-admin-receipt__identity">
                    <span className="noa-admin-receipt__avatar" aria-hidden="true">
                      {(receipt.user?.name || receipt.userId || 'ک').trim().slice(0, 1)}
                    </span>
                    <div>
                      <strong>{receipt.user?.name || receipt.userId || 'کاربر'}</strong>
                      <span>{receipt.user?.phone || 'رسید واریز بانکی'}</span>
                    </div>
                  </div>
                  <span className={`noa-status noa-status--${receipt.status}`}>{STATUS_LABELS[receipt.status]}</span>
                </header>
                <dl className="noa-admin-receipt__facts">
                  <div><dt>مبلغ ثبت‌شده</dt><dd>{formatTomanFa(receipt.declaredToman || receipt.verifiedToman)}</dd></div>
                  <div><dt>زمان ثبت</dt><dd>{formatDate(receipt.submittedAt)}</dd></div>
                  <div><dt>نوآ نهایی</dt><dd>{formatDecimalFa(receipt.approvedNoa || receipt.calculatedNoa)} نوآ</dd></div>
                </dl>
                <button
                  type="button"
                  className="noa-admin-receipt__image"
                  onClick={() => setReceiptPreview({ receipt, url: null, loading: true, error: null })}
                >
                  <Icon name="attach-image" size={17} aria-hidden="true" />
                  مشاهده تصویر رسید
                </button>

                {isPending ? (
                  <div className="noa-admin-receipt__review">
                    <div className="noa-admin-receipt__review-heading">
                      <div>
                        <span className="noa-admin-receipt__step">مرحله ۱</span>
                        <strong>مبلغ را با رسید تطبیق دهید</strong>
                      </div>
                      <small>نرخ فعلی: {rate ? `هر نوآ ${formatTomanFa(rate.tomanPerNoa)}` : 'در حال دریافت'}</small>
                    </div>
                    <div className="noa-admin-receipt__review-grid">
                      <label htmlFor={`verified-${receipt.receiptId}`}>
                        <span>مبلغ تأییدشده <em>تومان</em></span>
                        <input
                          id={`verified-${receipt.receiptId}`}
                          type="text"
                          inputMode="decimal"
                          placeholder="مثلاً ۵۰۰٬۰۰۰"
                          value={draft.verifiedToman}
                          onChange={(event) => updateDraft(receipt.receiptId, {
                            verifiedToman: toAsciiDigits(event.target.value).replace(/[^\d.]/g, '')
                          })}
                          disabled={isSaving}
                        />
                      </label>
                      <div className="noa-admin-receipt__calculation" aria-live="polite">
                        <span>واریز پیشنهادی به کیف پول</span>
                        <strong>{calculatedNoa ? `${formatDecimalFa(calculatedNoa)} نوآ` : 'مبلغ معتبر وارد کنید'}</strong>
                        <small>با نرخ فعلی محاسبه می‌شود</small>
                      </div>
                    </div>
                    <label className="noa-override-toggle">
                      <input
                        type="checkbox"
                        checked={draft.useOverride}
                        onChange={(event) => updateDraft(receipt.receiptId, { useOverride: event.target.checked })}
                        disabled={isSaving}
                      />
                      <span>مقدار نوآ را دستی تعیین می‌کنم</span>
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
                          <span>دلیل ویرایش دستی <b>*</b></span>
                          <textarea
                            id={`override-reason-${receipt.receiptId}`}
                            rows={2}
                            minLength={5}
                            value={draft.overrideReason}
                            onChange={(event) => updateDraft(receipt.receiptId, { overrideReason: event.target.value })}
                            disabled={isSaving}
                          />
                        </label>
                      </div>
                    ) : null}
                    <label className="noa-admin-receipt__reason" htmlFor={`review-reason-${receipt.receiptId}`}>
                      <span>دلیل رد یا یادداشت بررسی <small>برای رد رسید الزامی است</small></span>
                      <textarea
                        id={`review-reason-${receipt.receiptId}`}
                        rows={2}
                        maxLength={420}
                        placeholder="مثلاً مبلغ رسید با واریز ثبت‌شده مطابقت ندارد"
                        value={draft.reason}
                        onChange={(event) => updateDraft(receipt.receiptId, { reason: event.target.value })}
                        disabled={isSaving}
                      />
                    </label>
                    {receiptError ? <p className="noa-admin-receipt__error" role="alert">{receiptError}</p> : null}
                    <div className="noa-admin-receipt__actions">
                      <Button type="button" onClick={() => requestApproveReceipt(receipt)} disabled={isSaving || !rate}>
                        <Icon name="check" size={17} aria-hidden="true" />
                        {isSaving ? 'در حال ثبت…' : 'بررسی نهایی و تأیید'}
                      </Button>
                      <Button type="button" variant="danger" onClick={() => requestRejectReceipt(receipt)} disabled={isSaving}>
                        رد رسید
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="noa-admin-receipt__result">
                    <strong>{receipt.status === 'approved' ? 'تصمیم ثبت و به کاربر اعلام شده است' : 'رد رسید به کاربر اعلام شده است'}</strong>
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

      {receiptPreview ? createPortal(
        <div
          className="noa-admin-receipt-viewer"
          role="presentation"
          onMouseDown={() => setReceiptPreview(null)}
        >
          <section
            className="noa-admin-receipt-viewer__panel"
            role="dialog"
            aria-modal="true"
            aria-label={`تصویر رسید ${receiptPreview.receipt.user?.name || 'کاربر'}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <strong>تصویر رسید {receiptPreview.receipt.user?.name || 'کاربر'}</strong>
              <Button
                type="button"
                variant="ghost"
                iconOnly
                aria-label="بستن تصویر رسید"
                onClick={() => setReceiptPreview(null)}
                startIcon={<Icon name="x-close" size={20} aria-hidden="true" />}
              />
            </header>
            <div className="noa-admin-image-preview">
              {receiptPreview.loading ? <p>در حال دریافت تصویر رسید…</p> : null}
              {receiptPreview.error ? <InlineMessage text={receiptPreview.error} variant="error" /> : null}
              {receiptPreview.url ? <img src={receiptPreview.url} alt="تصویر رسید واریز بانکی" /> : null}
            </div>
          </section>
        </div>,
        document.body
      ) : null}

      <Dialog
        open={Boolean(receiptDecision)}
        title={receiptDecision?.action === 'reject' ? 'تأیید نهایی رد رسید' : 'تأیید نهایی واریز نوآ'}
        onClose={() => setReceiptDecision(null)}
        showFooter={false}
      >
        {receiptDecision ? (
          <div className={`noa-admin-decision noa-admin-decision--${receiptDecision.action}`}>
            <div className="noa-admin-decision__icon" aria-hidden="true">
              <Icon name={receiptDecision.action === 'approve' ? 'check-circle' : 'info-circle'} size={25} />
            </div>
            <p>
              {receiptDecision.action === 'approve'
                ? `پس از تأیید، ${formatDecimalFa(receiptDecision.creditNoa || '0')} نوآ به کیف پول «${receiptDecision.receipt.user?.name || 'کاربر'}» اضافه و اعلان داخل‌اپ ارسال می‌شود.`
                : `رسید «${receiptDecision.receipt.user?.name || 'کاربر'}» رد می‌شود و دلیل زیر در اعلان داخل‌اپ برای او نمایش داده خواهد شد.`}
            </p>
            <dl className="noa-admin-decision__summary">
              {receiptDecision.action === 'approve' ? (
                <>
                  <div><dt>مبلغ تأییدشده</dt><dd>{formatTomanFa(receiptDecision.verifiedToman)}</dd></div>
                  <div><dt>نوآ قابل واریز</dt><dd>{formatDecimalFa(receiptDecision.creditNoa)} نوآ</dd></div>
                </>
              ) : null}
              <div className={receiptDecision.action === 'reject' ? 'is-full' : ''}>
                <dt>{receiptDecision.action === 'reject' ? 'دلیل رد برای کاربر' : 'یادداشت بررسی'}</dt>
                <dd>{receiptDecision.reason || 'یادداشتی ثبت نشده است.'}</dd>
              </div>
            </dl>
            <div className="noa-admin-decision__actions">
              <Button type="button" variant="secondary" onClick={() => setReceiptDecision(null)} disabled={savingKey === `receipt:${receiptDecision.receipt.receiptId}`}>
                بازگشت و ویرایش
              </Button>
              <Button
                type="button"
                variant={receiptDecision.action === 'reject' ? 'danger' : 'primary'}
                onClick={() => void submitReceiptDecision()}
                loading={savingKey === `receipt:${receiptDecision.receipt.receiptId}`}
              >
                {receiptDecision.action === 'reject' ? 'رد قطعی رسید' : 'تأیید و واریز نوآ'}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>

    </div>
  );
}

export default NoaFinanceAdmin;
