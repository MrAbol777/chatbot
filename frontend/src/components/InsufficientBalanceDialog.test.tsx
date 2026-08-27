import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import InsufficientBalanceDialog from './InsufficientBalanceDialog';

describe('InsufficientBalanceDialog', () => {
  it('explains the shortfall and directs the user to wallet charging', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onOpenWallet = vi.fn();

    render(
      <InsufficientBalanceDialog
        open
        billingError={{ actionKey: 'video_generation', balanceNoa: '8', requiredNoa: '20', shortfallNoa: '12' }}
        onClose={onClose}
        onOpenWallet={onOpenWallet}
      />
    );

    expect(screen.getByRole('dialog', { name: 'اعتبار نوآ کافی نیست' })).toBeInTheDocument();
    expect(screen.getByText('برای ساخت ویدیو، اعتبار کیف پولت کافی نیست.')).toBeInTheDocument();
    expect(screen.getByText('۸ نوآ')).toBeInTheDocument();
    expect(screen.getByText('۲۰ نوآ')).toBeInTheDocument();
    expect(screen.getByText('۱۲ نوآ')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'شارژ کیف پول' }));
    expect(onOpenWallet).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'بازگشت و ویرایش' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
