import { FormEvent, useEffect, useId, useRef, useState } from 'react';
import Icon from '../components/Icon';
import { Button, InlineMessage } from '../design-system/components';
import { formatDecimalFa, formatTomanFa } from './decimal';
import { createIdempotencyKey, listNoaReceipts, submitNoaReceipt } from './noa.service';
import type { NoaReceipt, NoaWallet } from './noa.types';
import './NoaWalletPanel.css';

const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED_RECEIPT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type Props = {
  wallet: NoaWallet | null;
  walletLoading: boolean;
  walletError: string;
  onRefreshWallet: () => Promise<NoaWallet | null>;
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

function NoaWalletPanel({ wallet, walletLoading, walletError, onRefreshWallet }: Props) {
  const receiptId = useId();
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [receipts, setReceipts] = useState<NoaReceipt[]>([]);
  const [receiptsLoading, setReceiptsLoading] = useState(true);
  const [receiptsError, setReceiptsError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; kind: 'success' | 'error' } | null>(null);
  const idempotencyRef = useRef<{ signature: string; key: string } | null>(null);

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

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const fileError = validateFile(receiptFile);
    const nextErrors: FormErrors = {
      receipt: fileError
    };
    setErrors(nextErrors);
    setFeedback(null);
    if (Object.values(nextErrors).some(Boolean) || !receiptFile) return;

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
    <section className="noa-wallet" aria-labelledby="noa-wallet-title">
      <div className="noa-wallet__heading">
        <div>
          <span className="noa-wallet__eyebrow">اعتبار هوش مصنوعی</span>
          <h2 id="noa-wallet-title">کیف پول نوآ</h2>
          <p>موجودی و رسیدهای واریز بانکی خود را از این بخش مدیریت کنید.</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void Promise.all([onRefreshWallet(), refreshReceipts()])}
          disabled={walletLoading || receiptsLoading}
        >
          <Icon name="retry" size={18} aria-hidden="true" />
          {walletLoading || receiptsLoading ? 'در حال بروزرسانی' : 'بروزرسانی'}
        </Button>
      </div>

      <div className="noa-wallet__balance" aria-busy={walletLoading}>
        <span className="noa-wallet__balance-icon" aria-hidden="true">
          <Icon name="credit-card" size={26} />
        </span>
        <div className="noa-wallet__balance-main">
          <span>موجودی قابل استفاده</span>
          <strong>{walletLoading && !wallet ? 'در حال دریافت…' : `${formatDecimalFa(wallet?.availableBalance)} نوآ`}</strong>
        </div>
        {wallet ? (
          <dl className="noa-wallet__balance-meta">
            <div>
              <dt>رزرو شده</dt>
              <dd>{formatDecimalFa(wallet.reservedBalance)} نوآ</dd>
            </div>
            <div>
              <dt>نرخ فعلی</dt>
              <dd>هر نوآ {formatTomanFa(wallet.exchangeRate.tomanPerNoa)}</dd>
            </div>
          </dl>
        ) : null}
      </div>

      <div className="noa-wallet__live" role="status" aria-live="polite">
        {walletError ? <InlineMessage text={walletError} variant="error" /> : null}
        {feedback ? <InlineMessage text={feedback.text} variant={feedback.kind} /> : null}
      </div>

      <div className="noa-wallet__grid">
        <form className="noa-receipt-form" onSubmit={handleSubmit} noValidate>
          <div className="noa-wallet__section-title">
            <span className="noa-wallet__section-icon" aria-hidden="true"><Icon name="upload" size={20} /></span>
            <div>
              <h3>ثبت رسید واریز بانکی</h3>
              <p>فقط تصویر رسید را ارسال کنید؛ مبلغ و اعتبار نهایی پس از بررسی مالی ثبت می‌شود.</p>
            </div>
          </div>

          <section className="noa-bank-transfer" aria-labelledby="noa-bank-transfer-title">
            <div className="noa-bank-transfer__heading">
              <span className="noa-wallet__section-icon" aria-hidden="true"><Icon name="credit-card" size={20} /></span>
              <div>
                <h4 id="noa-bank-transfer-title">کارت مقصد واریز</h4>
                <p>پس از واریز به این کارت، تصویر رسید را در همین فرم ارسال کنید.</p>
              </div>
            </div>
            {wallet?.bankTransferAccount ? (
              <dl className="noa-bank-transfer__details">
                <div>
                  <dt>شماره کارت</dt>
                  <dd dir="ltr">{formatCardNumber(wallet.bankTransferAccount.cardNumber)}</dd>
                </div>
                <div>
                  <dt>به نام</dt>
                  <dd>{wallet.bankTransferAccount.cardHolderName}</dd>
                </div>
              </dl>
            ) : (
              <p className="noa-bank-transfer__pending" role="status">اطلاعات کارت واریز هنوز توسط مدیریت ثبت نشده است.</p>
            )}
          </section>

          <div className="noa-file-field" data-invalid={Boolean(errors.receipt)}>
            <input
              id={receiptId}
              type="file"
              accept="image/jpeg,image/png,image/webp"
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
              <Icon name="attach-image" size={20} aria-hidden="true" />
              <span>{receiptFile ? receiptFile.name : 'انتخاب تصویر رسید'}</span>
            </label>
            <small id={`${receiptId}-help`}>JPEG، PNG یا WebP، حداکثر ۵ مگابایت</small>
            {errors.receipt ? <span id={`${receiptId}-error`} role="alert">{errors.receipt}</span> : null}
          </div>

          {bankTransferUnavailable ? (
            <p className="noa-receipt-submit-hint" id={`${receiptId}-bank-transfer-hint`} role="status">
              برای ثبت رسید، ابتدا باید اطلاعات کارت مقصد توسط مدیریت فعال شود.
            </p>
          ) : null}

          <Button
            type="submit"
            size="lg"
            aria-describedby={bankTransferUnavailable ? `${receiptId}-bank-transfer-hint` : undefined}
            disabled={submitting || walletLoading || !wallet || !wallet.bankTransferAccount}
          >
            {submitting ? <Icon className="noa-spinner" name="spinner" size={20} aria-hidden="true" /> : <Icon name="upload" size={20} aria-hidden="true" />}
            {submitting ? 'در حال ثبت امن رسید…' : 'ثبت رسید برای بررسی'}
          </Button>
        </form>

        <section className="noa-receipts" aria-labelledby="noa-receipts-title" aria-busy={receiptsLoading}>
          <div className="noa-wallet__section-title">
            <span className="noa-wallet__section-icon" aria-hidden="true"><Icon name="book" size={20} /></span>
            <div>
              <h3 id="noa-receipts-title">پیگیری رسیدها</h3>
              <p>آخرین وضعیت بررسی و مقدار اعتبار تأییدشده</p>
            </div>
          </div>

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
                  <a
                    className="noa-receipt-item__link"
                    href={receipt.imageUrl || `/api/noa/receipts/${encodeURIComponent(receipt.receiptId)}/image`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    مشاهده تصویر رسید
                    <Icon name="external-link" size={16} aria-hidden="true" />
                  </a>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

export default NoaWalletPanel;
