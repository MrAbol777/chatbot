import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import NoaWalletPanel from './NoaWalletPanel';
import type { NoaWallet } from './noa.types';

const wallet: NoaWallet = {
  currency: 'NOA',
  availableBalance: '3.000000',
  reservedBalance: '0.000000',
  totalBalance: '3.000000',
  updatedAt: null,
  bankTransferAccount: {
    cardNumber: '6037991234567890',
    cardHolderName: 'نام دارنده کارت',
    version: '1',
    updatedAt: null
  },
  exchangeRate: {
    fiatCurrency: 'TOMAN',
    tomanPerNoa: '10000.000000',
    version: '1'
  }
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

describe('NoaWalletPanel', () => {
  it('submits a manual receipt with only its image and never sends a transaction identifier', async () => {
    const user = userEvent.setup();
    const refreshWallet = vi.fn(async () => wallet);
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === '/api/noa/receipts' && (!init?.method || init.method === 'GET')) {
        return json({ items: [] });
      }
      if (url === '/api/noa/receipts' && init?.method === 'POST') {
        return json({
          receipt: {
            receiptId: 'receipt-1',
            declaredToman: null,
            verifiedToman: null,
            calculatedNoa: null,
            approvedNoa: null,
            status: 'pending',
            submittedAt: null,
            reviewedAt: null,
            reviewReason: null
          }
        }, 201);
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(
      <NoaWalletPanel
        wallet={wallet}
        walletLoading={false}
        walletError=""
        onRefreshWallet={refreshWallet}
      />
    );

    await user.click(await screen.findByRole('button', { name: 'مشاهده رسیدها' }));
    expect(await screen.findAllByText('هنوز رسیدی ثبت نشده است')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'بستن پیگیری' }));
    expect(document.getElementById('noa-receipts-content')).toHaveAttribute('aria-hidden', 'true');
    await user.click(screen.getByRole('button', { name: 'مشاهده رسیدها' }));
    expect(document.getElementById('noa-receipts-content')).toHaveAttribute('aria-hidden', 'false');
    expect(screen.getByText('نام دارنده کارت')).toBeInTheDocument();
    expect(screen.getByText('6037-9912-3456-7890')).toBeInTheDocument();
    const receipt = new File(['receipt-image'], 'receipt.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('انتخاب تصویر رسید'), receipt);
    await user.click(screen.getByRole('button', { name: 'ادامه و بررسی رسید' }));
    expect(screen.getByRole('dialog', { name: 'تأیید ثبت رسید' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ثبت رسید برای بررسی' }));

    await waitFor(() => expect(screen.getByRole('status', { name: 'ثبت موفق رسید' })).toBeInTheDocument());
    expect(screen.getByText('رسید با موفقیت ثبت شد')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'مشاهده وضعیت رسید' })).toBeInTheDocument();
    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(postCall).toBeDefined();
    const body = postCall?.[1]?.body as FormData;
    expect(body.get('receipt')).toBeInstanceOf(File);
    expect(body.get('transactionId')).toBeNull();
    expect(body.get('transferReference')).toBeNull();
    expect(body.get('paidAmount')).toBeNull();
    expect(refreshWallet).toHaveBeenCalledTimes(1);
  });

  it('previews a receipt inside a dialog without navigating away from the wallet', async () => {
    const user = userEvent.setup();
    const createObjectUrl = vi.fn(() => 'blob:receipt-preview');
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === '/api/noa/receipts' && (!init?.method || init.method === 'GET')) {
        return json({
          items: [{
            receiptId: 'receipt-1',
            status: 'pending',
            submittedAt: '2026-08-09T10:00:00.000Z',
            verifiedToman: null,
            approvedNoa: null,
            calculatedNoa: null
          }]
        });
      }
      if (url === '/api/noa/receipts/receipt-1/image') {
        return new Response(new Blob(['image-bytes'], { type: 'image/png' }), {
          headers: { 'Content-Type': 'image/png' }
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(
      <NoaWalletPanel
        wallet={wallet}
        walletLoading={false}
        walletError=""
        onRefreshWallet={async () => wallet}
      />
    );

    await user.click(await screen.findByRole('button', { name: 'مشاهده رسیدها' }));
    await user.click(await screen.findByRole('button', { name: 'مشاهده تصویر رسید' }));

    expect(screen.getByRole('dialog', { name: 'تصویر رسید واریز' })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: /تصویر رسید ثبت‌شده/ })).toHaveAttribute('src', 'blob:receipt-preview');
    expect(fetchMock).toHaveBeenCalledWith('/api/noa/receipts/receipt-1/image', expect.objectContaining({
      credentials: 'include'
    }));
  });
});
