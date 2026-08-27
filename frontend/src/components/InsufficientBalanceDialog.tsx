import Icon from './Icon';
import { Button, Dialog } from '../design-system/components';
import { formatDecimalFa } from '../noa/decimal';
import type { InsufficientBalanceDetails } from '../noa/insufficientBalance';
import './InsufficientBalanceDialog.css';

type Props = {
  open: boolean;
  billingError: InsufficientBalanceDetails | null;
  onClose: () => void;
  onOpenWallet: () => void;
};

const actionLabels: Record<string, string> = {
  image_generation: 'ساخت تصویر',
  image_edit: 'ویرایش تصویر',
  image_to_image: 'ویرایش تصویر',
  video_generation: 'ساخت ویدیو'
};

const formatNoa = (value?: string) => value ? `${formatDecimalFa(value)} نوآ` : '—';

export default function InsufficientBalanceDialog({ open, billingError, onClose, onOpenWallet }: Props) {
  const actionLabel = actionLabels[billingError?.actionKey || ''] || 'این درخواست';
  const hasBreakdown = Boolean(
    billingError?.balanceNoa || billingError?.requiredNoa || billingError?.shortfallNoa
  );

  return (
    <Dialog
      open={open}
      title="اعتبار نوآ کافی نیست"
      onClose={onClose}
      showFooter={false}
      panelClassName="insufficient-balance-dialog"
    >
      <div className="insufficient-balance-dialog__content" dir="rtl">
        <span className="insufficient-balance-dialog__icon" aria-hidden="true">
          <Icon name="credit-card" size={24} />
        </span>
        <p className="insufficient-balance-dialog__lead">
          برای {actionLabel}، اعتبار کیف پولت کافی نیست.
        </p>

        {hasBreakdown ? (
          <dl className="insufficient-balance-dialog__breakdown" aria-label="جزئیات اعتبار موردنیاز">
            <div>
              <dt>موجودی فعلی</dt>
              <dd>{formatNoa(billingError?.balanceNoa)}</dd>
            </div>
            <div>
              <dt>هزینه درخواست</dt>
              <dd>{formatNoa(billingError?.requiredNoa)}</dd>
            </div>
            {billingError?.shortfallNoa ? (
              <div className="insufficient-balance-dialog__shortfall">
                <dt>حداقل شارژ لازم</dt>
                <dd>{formatNoa(billingError.shortfallNoa)}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="insufficient-balance-dialog__hint">
            برای ادامه، کیف پول نوآ را شارژ کن و دوباره درخواستت را ثبت کن.
          </p>
        )}

        <p className="insufficient-balance-dialog__preserve" role="status">
          ایده و تنظیماتت حفظ شده‌اند.
        </p>

        <div className="insufficient-balance-dialog__actions">
          <Button
            type="button"
            startIcon={<Icon name="credit-card" size={18} />}
            onClick={onOpenWallet}
          >
            شارژ کیف پول
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            بازگشت و ویرایش
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
