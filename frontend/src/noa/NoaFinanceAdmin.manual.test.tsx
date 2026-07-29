import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NoaFinanceAdmin from '../admin/noa/NoaFinanceAdmin';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

describe('NoaFinanceAdmin user wallet management', () => {
  beforeEach(() => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/admin/noa/pricing') return response({ items: [] });
      if (url === '/api/admin/noa/config') return response({ tomanPerNoa: '10000', version: '1' });
      if (url === '/api/admin/noa/bank-account') {
        if (init?.method === 'PATCH') {
          return response({
            bankTransferAccount: {
              cardNumber: '6037991234567890',
              cardHolderName: 'نام مالک',
              version: '1',
              updatedAt: null
            }
          });
        }
        return response({ bankTransferAccount: null });
      }
      if (url.startsWith('/api/admin/noa/receipts?')) return response({ items: [] });
      if (url.startsWith('/api/admin/users?')) {
        return response({ items: [{ user_id: 'user-1', name: 'کاربر اول', phone: '09120000000' }] });
      }
      if (url === '/api/admin/noa/users/user-1/wallet') {
        return response({ user: { userId: 'user-1', name: 'کاربر اول', phone: '09120000000' }, wallet: { availableNoa: '25', reservedNoa: '0', totalNoa: '25' } });
      }
      if (url === '/api/admin/noa/wallet-adjustments') {
        return response({
          transactionId: 'tx-1',
          deltaNoa: '-300',
          amountNoa: '300',
          replayed: false,
          wallet: { availableNoa: '300', reservedNoa: '0', totalNoa: '300' }
        }, 201);
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
  });

  it('shows balance then submits a selected user adjustment', async () => {
    const user = userEvent.setup();
    render(<NoaFinanceAdmin />);

    await screen.findByRole('heading', { name: 'مدیریت نوآ کاربران' });
    await user.type(screen.getByLabelText('کاربر مقصد'), 'کار');
    await screen.findByRole('option', { name: /کاربر اول/ });
    await user.click(screen.getByRole('option', { name: /کاربر اول/ }));
    await screen.findByText('۲۵ نوآ');
    await user.click(screen.getByRole('button', { name: 'کاهش' }));
    await user.type(screen.getByLabelText('مقدار نوآ'), '300');
    await user.type(screen.getByLabelText(/یادداشت برای کاربر/), 'یادداشت آزمایشی');
    await user.click(screen.getByRole('button', { name: 'ثبت تغییر موجودی' }));

    expect(window.confirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url) === '/api/admin/noa/wallet-adjustments')).toBe(true));
    expect(screen.getByText(/با موفقیت کسر شد/)).toBeInTheDocument();
  });

  it('saves the destination card and owner name through the admin API', async () => {
    const user = userEvent.setup();
    render(<NoaFinanceAdmin />);

    await screen.findByRole('heading', { name: 'کارت مقصد واریز بانکی' });
    await user.type(screen.getByLabelText('شماره کارت'), '۶۰۳۷۹۹۱۲۳۴۵۶۷۸۹۰');
    await user.type(screen.getByLabelText('به نام'), 'نام مالک');
    await user.click(screen.getByRole('button', { name: 'ذخیره کارت' }));

    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) => (
      String(url) === '/api/admin/noa/bank-account' && init?.method === 'PATCH'
    ))).toBe(true));
    const call = vi.mocked(fetch).mock.calls.find(([url, init]) => (
      String(url) === '/api/admin/noa/bank-account' && init?.method === 'PATCH'
    ));
    expect(call).toBeDefined();
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      cardNumber: '6037991234567890',
      cardHolderName: 'نام مالک',
      expectedVersion: null
    });
    expect(screen.getByText('کارت مقصد واریز بانکی ذخیره شد.')).toBeInTheDocument();
  });
});
