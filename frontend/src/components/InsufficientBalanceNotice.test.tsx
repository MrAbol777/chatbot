import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import InsufficientBalanceNotice from './InsufficientBalanceNotice';

describe('InsufficientBalanceNotice', () => {
  it('shows a useful balance breakdown and recovery actions', async () => {
    const user = userEvent.setup();
    const onOpenWallet = vi.fn();
    const onRetry = vi.fn();

    render(
      <InsufficientBalanceNotice
        billingError={{
          kind: 'insufficient_balance',
          actionKey: 'image_generation',
          balanceNoa: '8',
          requiredNoa: '20',
          shortfallNoa: '12',
          retryable: true,
          retryMessage: 'یک تصویر بساز'
        }}
        onOpenWallet={onOpenWallet}
        onRetry={onRetry}
      />
    );

    expect(screen.getByRole('alert', { name: 'کمبود موجودی نوآ' })).toBeInTheDocument();
    expect(screen.getByText('برای ساخت تصویر، اعتبار کیف پولت کافی نیست.')).toBeInTheDocument();
    expect(screen.getByText('۲۰ نوآ')).toBeInTheDocument();
    expect(screen.getByText('۸ نوآ')).toBeInTheDocument();
    expect(screen.getByText('۱۲ نوآ')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'افزایش موجودی' }));
    await user.click(screen.getByRole('button', { name: 'تلاش مجدد' }));

    expect(onOpenWallet).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
