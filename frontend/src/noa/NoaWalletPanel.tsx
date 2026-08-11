import { FormEvent, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../components/Icon';
import { Button, Dialog, InlineMessage } from '../design-system/components';
import { formatDecimalFa, formatTomanFa } from './decimal';
import { createIdempotencyKey, fetchNoaReceiptImage, listNoaReceipts, submitNoaReceipt } from './noa.service';
import type { NoaReceipt, NoaWallet } from './noa.types';
import './NoaWalletPanel.css';

const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED_RECEIPT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type Props = {
  wallet: NoaWallet | null;
  walletLoading: boolean;
  walletError: string;
  onRefreshWallet: () => Promise<NoaWallet | null>;
  refreshVersion?: number;
};

type FormErrors = {
  receipt?: string;
};

const statusLabels: Record<NoaReceipt['status'], string> = {
  pending: 'در انتظار بررسی',
  approved: 'تأیید شده',
  rejected: 'رد شده'
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function validateFile(file: File | null): string | undefined {
  if (!file) return 'تصویر رسید را انتخاب کنید.';
  if (!ACCEPTED_RECEIPT_TYPES.has(file.type)) return 'فرمت رسید باید JPEG، PNG یا WebP باشد.';
  if (file.size > RECEIPT_MAX_BYTES) return 'حجم تصویر رسید باید حداکثر ۵ مگابایت باشد.';
  return undefined;
}

function formatCardNumber(cardNumber: string): string {
  return cardNumber.replace(/(\d{4})(?=\d)/g, '$1-');
}

function NoaWalletPanel({ wallet, walletLoading, walletError, onRefreshWallet, refreshVersion = 0 }: Props) {
  const receiptId = useId();
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [receipts, setReceipts] = useState<NoaReceipt[]>([]);
  const [receiptsLoading, setReceiptsLoading] = useState(true);
  const [receiptsError, setReceiptsError] = useState('');
  const [receiptsOpen, setReceiptsOpen] = useState(false);
  const [cardCopied, setCardCopied] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [previewReceipt, setPreviewReceipt] = useState<NoaReceipt | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewImageError, setPreviewImageError] = useState('');
  const [previewImageLoading, setPreviewImageLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; kind: 'success' | 'error' } | null>(null);
  const idempotencyRef = useRef<{ signature: string; key: string } | null>(null);
  const receiptsContentRef = useRef<HTMLDivElement>(null);

  const refreshReceipts = async () => {
    setReceiptsLoading(true);
    setReceiptsError('');
    try {
      setReceipts(await listNoaReceipts());
    } catch (cause) {
      setReceiptsError(cause instanceof Error ? cause.message : 'دریافت وضعیت رسیدها انجام نشد.');
    } finally {
      setReceiptsLoading(false);
    }
  };

  useEffect(() => {
    void refreshReceipts();
  }, []);

  useEffect(() => {
    if (refreshVersion > 0) void refreshReceipts();
  }, [refreshVersion]);

  useEffect(() => {
    if (feedback?.kind !== 'success') return;
    const timeoutId = window.setTimeout(() => setFeedback(null), 6500);
    return () => window.clearTimeout(timeoutId);
  }, [feedback?.kind]);

  useEffect(() => {
    const content = receiptsContentRef.current as (HTMLDivElement & { inert?: boolean }) | null;
    if (content) content.inert = !receiptsOpen;
  }, [receiptsOpen]);

  useEffect(() => {
    if (!previewReceipt) return;
    let active = true;
    let objectUrl = '';
    setPreviewImageLoading(true);
    setPreviewImageError('');

    void fetchNoaReceiptImage(previewReceipt.receiptId)
      .then((image) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(image);
        setPreviewImageUrl(objectUrl);
      })
      .catch((cause) => {
        if (!active) return;
        setPreviewImageError(cause instanceof Error ? cause.message : 'نمایش تصویر رسید انجام نشد.');
      })
      .finally(() => {
        if (active) setPreviewImageLoading(false);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewReceipt]);

  const openReceiptPreview = (receipt: NoaReceipt) => {
    setPreviewImageUrl(null);
    setPreviewImageError('');
    setPreviewImageLoading(true);
    setPreviewReceipt(receipt);
  };

  const closeReceiptPreview = () => {
    setPreviewReceipt(null);
    setPreviewImageUrl(null);
    setPreviewImageError('');
    setPreviewImageLoading(false);
  };

  const copyCardNumber = async () => {
    const cardNumber = wallet?.bankTransferAccount?.cardNumber;
    if (!cardNumber) return;
    try {
      await navigator.clipboard.writeText(cardNumber);
      setCardCopied(true);
      window.setTimeout(() => setCardCopied(false), 2200);
    } catch {
      setFeedback({ text: 'کپی شماره کارت انجام نشد. لطفاً شماره را دستی کپی کنید.', kind: 'error' });
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const fileError = validateFile(receiptFile);
    const nextErrors: FormErrors = {
      receipt: fileError
    };
    setErrors(nextErrors);
    setFeedback(null);
    if (Object.values(nextErrors).some(Boolean) || !receiptFile) return;
    setReviewOpen(false);

    const signature = [
      receiptFile.name,
      receiptFile.size,
      receiptFile.lastModified
    ].join('|');
    if (idempotencyRef.current?.signature !== signature) {
      idempotencyRef.current = { signature, key: createIdempotencyKey('manual-receipt') };
    }

    setSubmitting(true);
    try {
      await submitNoaReceipt({
        receipt: receiptFile,
        idempotencyKey: idempotencyRef.current.key
      });
      setFeedback({
        text: 'رسید با موفقیت ثبت شد و پس از بررسی واحد مالی، نوآ به کیف پول اضافه می‌شود.',
        kind: 'success'
      });
      setReceiptFile(null);
      idempotencyRef.current = null;
      const input = document.getElementById(receiptId) as HTMLInputElement | null;
      if (input) input.value = '';
      await Promise.all([refreshReceipts(), onRefreshWallet()]);
    } catch (cause) {
      setFeedback({
        text: cause instanceof Error ? cause.message : 'ثبت رسید انجام نشد. دوباره تلاش کنید.',
        kind: 'error'
      });
    } finally {
      setSubmitting(false);
    }
  };

  const bankTransferUnavailable = !walletLoading && wallet?.bankTransferAccount === null;

  return (
    <section className="noa-wallet" aria-label="مدیریت اعتبار نوآ">
      <div className="noa-wallet__balance" aria-busy={walletLoading}>
        <span className="noa-wallet__balance-icon" aria-hidden="true">
          <Icon name="credit-card" size={26} />
        </span>
        <div className="noa-wallet__balance-main">
          <span>موجودی قابل استفاده شما</span>
          <strong>{walletLoading && !wallet ? 'در حال دریافت…' : `${formatDecimalFa(wallet?.availableBalance)} نوآ`}</strong>
        </div>
        {wallet ? (
          <dl className="noa-wallet__balance-meta">
            <div>
              <dt>نرخ تبدیل فعلی</dt>
              <dd>هر نوآ {formatTomanFa(wallet.exchangeRate.tomanPerNoa)}</dd>
            </div>
            <div>
              <dt>اعتبار رزروشده</dt>
              <dd>{formatDecimalFa(wallet.reservedBalance)} نوآ</dd>
            </div>
          </dl>
        ) : null}
      </div>

      {feedback?.kind === 'success' && typeof document !== 'undefined' ? createPortal(
        <section className="noa-success-notice" role="status" aria-live="polite" aria-label="ثبت موفق رسید">
          <span className="noa-success-notice__icon" aria-hidden="true"><Icon name="check-circle" size={24} /></span>
          <div className="noa-success-notice__content">
            <div className="noa-success-notice__meta"><span>کیف پول نوآ</span><time>اکنون</time></div>
            <strong>رسید با موفقیت ثبت شد</strong>
            <p>رسید شما در صف بررسی مالی است؛ پس از تأیید، نوآ به کیف پول اضافه می‌شود.</p>
          </div>
          <Button
            className="noa-success-notice__dismiss"
            type="button"
            variant="ghost"
            iconOnly
            startIcon={<Icon name="x-close" size={18} aria-hidden="true" />}
            aria-label="بستن پیام ثبت موفق رسید"
            onClick={() => setFeedback(null)}
          />
          <Button
            className="noa-success-notice__action"
            type="button"
            variant="secondary"
            size="sm"
            startIcon={<Icon name="book" size={17} aria-hidden="true" />}
            onClick={() => {
              setReceiptsOpen(true);
              setFeedback(null);
            }}
          >
            مشاهده وضعیت رسید
          </Button>
        </section>,
        document.body
      ) : null}

      <div className="noa-wallet__live">
        {walletError ? <InlineMessage text={walletError} variant="error" /> : null}
        {feedback?.kind === 'error' ? <InlineMessage text={feedback.text} variant="error" /> : null}
      </div>

      <div className="noa-wallet__grid">
        <form id="noa-receipt-form" className="noa-receipt-form" onSubmit={handleSubmit} noValidate>
          <header className="noa-receipt-form__header">
            <div className="noa-wallet__section-title">
              <span className="noa-wallet__section-icon" aria-hidden="true"><Icon name="upload" size={20} /></span>
              <div>
                <h2>افزایش موجودی نوآ</h2>
                <p>دو گام کوتاه تا ثبت درخواست واریز</p>
              </div>
            </div>
            <span className="noa-receipt-form__steps" aria-label="فرآیند دو مرحله‌ای">۲ گام</span>
          </header>

          <section className="noa-bank-transfer" aria-labelledby="noa-bank-transfer-title">
            <div className="noa-bank-transfer__heading">
              <span className="noa-workflow-step" aria-hidden="true">۱</span>
              <div>
                <h4 id="noa-bank-transfer-title">کارت مقصد واریز</h4>
                <p>به این کارت واریز کنید؛ هر نوآ با نرخ نمایش‌داده‌شده در بالا محاسبه می‌شود.</p>
              </div>
            </div>
            {wallet?.bankTransferAccount ? (
                <div className="noa-bank-transfer__details">
                  <dl>
                    <div className="noa-card-number">
                      <button
                        className="noa-card-number__copy"
                        type="button"
                        onClick={() => void copyCardNumber()}
                        aria-label={cardCopied ? 'شماره کارت کپی شد' : `کپی شماره کارت ${formatCardNumber(wallet.bankTransferAccount.cardNumber)}`}
                        title={cardCopied ? 'شماره کارت کپی شد' : 'برای کپی شماره کارت بزنید'}
                      >
                        <span className="noa-card-number__label">شماره کارت</span>
                        <span className="noa-card-number__value" dir="ltr">
                          {formatCardNumber(wallet.bankTransferAccount.cardNumber)}
                          <Icon name={cardCopied ? 'check' : 'copy'} size={19} aria-hidden="true" />
                        </span>
                      </button>
                    </div>
                    <div>
                      <dt>به نام</dt>
                      <dd>{wallet.bankTransferAccount.cardHolderName}</dd>
                    </div>
                  </dl>
                </div>
            ) : (
              <p className="noa-bank-transfer__pending" role="status">اطلاعات کارت واریز هنوز توسط مدیریت ثبت نشده است.</p>
            )}
          </section>

          <section className="noa-upload-card" aria-labelledby={`${receiptId}-upload-title`}>
            <div className="noa-upload-card__heading">
                <span className="noa-workflow-step" aria-hidden="true">۲</span>
                <div>
                  <h3 id={`${receiptId}-upload-title`}>بارگذاری رسید واریز</h3>
                  <p>
                    {receiptFile
                      ? 'رسید انتخاب شد؛ برای ادامه، روی دکمه بنفش «ادامه و بررسی رسید» بزنید.'
                      : 'تصویر رسید را انتخاب کنید؛ سپس آن را برای بررسی مالی ثبت کنید.'}
                  </p>
                </div>
                <Button
                  className="noa-upload-card__review"
                  type="button"
                  variant="primary"
                  size="md"
                  startIcon={<Icon name="upload" size={18} aria-hidden="true" />}
                  onClick={() => setReviewOpen(true)}
                  disabled={submitting || walletLoading || !receiptFile || !wallet?.bankTransferAccount}
                >
                  ادامه و بررسی رسید
                </Button>
            </div>
            <div className="noa-file-field" data-invalid={Boolean(errors.receipt)}>
              <input
                id={receiptId}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="انتخاب تصویر رسید"
                onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  setReceiptFile(file);
                  setErrors((current) => ({ ...current, receipt: validateFile(file) }));
                }}
                aria-invalid={Boolean(errors.receipt)}
                aria-describedby={`${receiptId}-help${errors.receipt ? ` ${receiptId}-error` : ''}`}
                disabled={submitting}
              />
              <label htmlFor={receiptId}>
                <Icon name="attach-image" size={22} aria-hidden="true" />
                <span>{receiptFile ? receiptFile.name : 'انتخاب تصویر رسید'}</span>
                <small>JPEG، PNG یا WebP · حداکثر ۵ مگابایت</small>
              </label>
              <small id={`${receiptId}-help`}>پس از بررسی واحد مالی، اعتبار نوآ به کیف پول شما اضافه می‌شود.</small>
              {errors.receipt ? <span id={`${receiptId}-error`} role="alert">{errors.receipt}</span> : null}
            </div>
          </section>

          {bankTransferUnavailable ? (
            <p className="noa-receipt-submit-hint" id={`${receiptId}-bank-transfer-hint`} role="status">
              برای ثبت رسید، ابتدا باید اطلاعات کارت مقصد توسط مدیریت فعال شود.
            </p>
          ) : null}

        </form>

          <Dialog open={reviewOpen} title="تأیید ثبت رسید" onClose={() => setReviewOpen(false)} showFooter={false}>
          <div className="noa-submit-dialog">
            <p>رسید شما برای بررسی مالی آماده است. پس از تأیید، اعتبار نوآ به کیف پول اضافه می‌شود.</p>
            <dl>
              <div><dt>فایل انتخاب‌شده</dt><dd>{receiptFile?.name || '—'}</dd></div>
              <div><dt>نرخ فعلی</dt><dd>{wallet ? `هر نوآ ${formatTomanFa(wallet.exchangeRate.tomanPerNoa)}` : '—'}</dd></div>
            </dl>
            <div className="noa-submit-dialog__actions">
              <Button type="button" variant="secondary" onClick={() => setReviewOpen(false)} disabled={submitting}>بازگشت</Button>
              <Button
                type="submit"
                form="noa-receipt-form"
                aria-describedby={bankTransferUnavailable ? `${receiptId}-bank-transfer-hint` : undefined}
                disabled={submitting || walletLoading || !wallet || !wallet.bankTransferAccount || !receiptFile}
              >
                {submitting ? <Icon className="noa-spinner" name="spinner" size={20} aria-hidden="true" /> : <Icon name="upload" size={20} aria-hidden="true" />}
                {submitting ? 'در حال ثبت امن رسید…' : 'ثبت رسید برای بررسی'}
              </Button>
            </div>
          </div>
          </Dialog>

          <Dialog open={Boolean(previewReceipt)} title="تصویر رسید واریز" onClose={closeReceiptPreview} showFooter={false}>
            <div className="noa-receipt-preview">
              {previewImageLoading ? (
                <div className="noa-receipt-preview__loading" role="status">
                  <Icon className="noa-spinner" name="spinner" size={24} aria-hidden="true" />
                  <span>در حال بارگذاری تصویر رسید…</span>
                </div>
              ) : null}
              {previewImageError ? (
                <InlineMessage text={previewImageError} variant="error" />
              ) : null}
              {previewImageUrl ? (
                <img src={previewImageUrl} alt={`تصویر رسید ثبت‌شده در ${formatDate(previewReceipt?.submittedAt || null)}`} />
              ) : null}
              {!previewImageLoading && !previewImageError && !previewImageUrl ? (
                <InlineMessage text="تصویر رسید برای نمایش در دسترس نیست." variant="help" />
              ) : null}
            </div>
          </Dialog>

        <section className={`noa-receipts ${receiptsOpen ? 'is-open' : ''}`} aria-labelledby="noa-receipts-title" aria-busy={receiptsLoading}>
          <div className="noa-receipts__header">
            <div className="noa-wallet__section-title">
              <span className="noa-wallet__section-icon" aria-hidden="true"><Icon name="book" size={20} /></span>
              <div>
                <h3 id="noa-receipts-title">پیگیری رسیدها</h3>
                <p>{receiptsLoading ? 'در حال دریافت وضعیت رسیدها…' : receipts.length ? `${formatDecimalFa(String(receipts.length))} رسید ثبت‌شده دارید` : 'هنوز رسیدی ثبت نشده است'}</p>
              </div>
            </div>
            <button
              className="noa-receipts__toggle"
              type="button"
              onClick={() => setReceiptsOpen((current) => !current)}
              aria-expanded={receiptsOpen}
              aria-controls="noa-receipts-content"
            >
              <span>{receiptsOpen ? 'بستن پیگیری' : 'مشاهده رسیدها'}</span>
              <Icon name={receiptsOpen ? 'chevron-right' : 'chevron-left'} size={18} aria-hidden="true" />
            </button>
          </div>

          <div className="noa-receipts__content-shell">
            <div
              id="noa-receipts-content"
              className="noa-receipts__content"
              ref={receiptsContentRef}
              aria-hidden={!receiptsOpen}
            >
              {receiptsError ? <InlineMessage text={receiptsError} variant="error" /> : null}
              {receiptsLoading ? (
                <div className="noa-receipts__loading" role="status">در حال دریافت رسیدها…</div>
              ) : receipts.length === 0 ? (
                <div className="noa-receipts__empty">
                  <Icon name="credit-card" size={28} aria-hidden="true" />
                  <strong>هنوز رسیدی ثبت نشده است</strong>
                  <span>پس از ثبت واریز، وضعیت آن در این بخش نمایش داده می‌شود.</span>
                </div>
              ) : (
                <div className="noa-receipts__list">
                  {receipts.map((receipt) => (
                    <article className="noa-receipt-item" key={receipt.receiptId}>
                      <div className="noa-receipt-item__header">
                        <strong>رسید واریز بانکی</strong>
                        <span className={`noa-status noa-status--${receipt.status}`}>{statusLabels[receipt.status]}</span>
                      </div>
                      <dl>
                        <div><dt>مبلغ تأییدشده</dt><dd>{formatTomanFa(receipt.verifiedToman)}</dd></div>
                        <div><dt>اعتبار</dt><dd>{formatDecimalFa(receipt.approvedNoa || receipt.calculatedNoa)} نوآ</dd></div>
                        <div><dt>زمان ثبت</dt><dd>{formatDate(receipt.submittedAt)}</dd></div>
                      </dl>
                      {receipt.reviewReason ? <p className="noa-receipt-item__reason">{receipt.reviewReason}</p> : null}
                      <button
                        className="noa-receipt-item__link"
                        type="button"
                        onClick={() => openReceiptPreview(receipt)}
                      >
                        مشاهده تصویر رسید
                        <Icon name="attach-image" size={16} aria-hidden="true" />
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

export default NoaWalletPanel;
