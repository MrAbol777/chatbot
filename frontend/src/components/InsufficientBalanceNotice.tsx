import Icon from './Icon';
import { Button } from '../design-system/components';
import { formatDecimalFa } from '../noa/decimal';
import type { ChatMessage } from '../types';
import './InsufficientBalanceNotice.css';

type BillingError = NonNullable<ChatMessage['billingError']>;

type Props = {
  billingError: BillingError;
  onOpenWallet: () => void;
  onRetry?: () => void;
};

const actionLabels: Record<string, string> = {
  text_chat: 'این پاسخ',
  image_generation: 'ساخت تصویر',
  image_edit: 'ویرایش تصویر',
  image_understanding: 'تحلیل تصویر',
  video_generation: 'ساخت ویدئو'
};

function valueOrDash(value: string | undefined): string {
  return value ? `${formatDecimalFa(value)} نوآ` : '—';
}

export default function InsufficientBalanceNotice({ billingError, onOpenWallet, onRetry }: Props) {
  const actionLabel = actionLabels[billingError.actionKey || ''] || 'این درخواست';
  const hasBreakdown = Boolean(
    billingError.balanceNoa || billingError.requiredNoa || billingError.shortfallNoa
  );

  return (
    <section className="insufficient-balance-notice" role="alert" aria-label="کمبود موجودی نوآ">
      <div className="insufficient-balance-notice__heading">
        <span className="insufficient-balance-notice__icon" aria-hidden="true">
          <Icon name="credit-card" size={21} />
        </span>
        <div>
          <strong>موجودی نوآ کافی نیست</strong>
          <p>برای {actionLabel}، اعتبار کیف پولت کافی نیست.</p>
        </div>
      </div>

      {hasBreakdown ? (
        <dl className="insufficient-balance-notice__breakdown">
          <div>
            <dt>هزینه درخواست</dt>
            <dd>{valueOrDash(billingError.requiredNoa)}</dd>
          </div>
          <div>
            <dt>موجودی فعلی</dt>
            <dd>{valueOrDash(billingError.balanceNoa)}</dd>
          </div>
          {billingError.shortfallNoa ? (
            <div className="insufficient-balance-notice__shortfall">
              <dt>مقدار موردنیاز برای شارژ</dt>
              <dd>{valueOrDash(billingError.shortfallNoa)}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="insufficient-balance-notice__hint">
          درخواستت حفظ شده است؛ کیف پول را شارژ کن و دوباره ادامه بده.
        </p>
      )}

      <div className="insufficient-balance-notice__actions">
        <Button
          type="button"
          size="sm"
          startIcon={<Icon name="credit-card" size={17} />}
          onClick={onOpenWallet}
        >
          افزایش موجودی
        </Button>
        {billingError.retryable && onRetry ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            startIcon={<Icon name="retry" size={17} />}
            onClick={onRetry}
          >
            تلاش مجدد
          </Button>
        ) : null}
      </div>
    </section>
  );
}
