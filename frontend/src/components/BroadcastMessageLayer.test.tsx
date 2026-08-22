import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../design-system/components';
import BroadcastMessageLayer from './BroadcastMessageLayer';

const updateMessage = {
  id: '42',
  title: 'نسخه جدید دانا آماده است',
  message: 'نسخه اول دانا منتشر شده است.',
  actionLabel: 'به‌روزرسانی',
  displayMode: 'notification',
  priority: 'normal',
  unread: true
};

const response = (payload: unknown) => ({ ok: true, json: async () => payload });

describe('BroadcastMessageLayer update announcement', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('shows update notifications as a non-blocking banner and hides them for the session when closed', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      return String(input).startsWith('/api/notifications?')
        ? response({ items: [updateMessage] })
        : response({ success: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ToastProvider>
        <BroadcastMessageLayer userId="user-1" enabled placement="hidden" />
      </ToastProvider>
    );

    expect(await screen.findByRole('status')).toHaveTextContent(updateMessage.message);
    await userEvent.click(screen.getByRole('button', { name: 'بستن اعلان به‌روزرسانی' }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem('danoa:broadcast:update-dismissed:user-1:42')).toBe('1');
  });

  it('shows the success notification once after the refresh marker is consumed', async () => {
    window.sessionStorage.setItem('danoa:broadcast:update-success:user-1', '1');
    vi.stubGlobal('fetch', vi.fn(async () => response({ items: [] })));

    render(
      <ToastProvider>
        <BroadcastMessageLayer userId="user-1" enabled placement="hidden" />
      </ToastProvider>
    );

    await waitFor(() => expect(screen.getByText(/نسخه اول دانا برای شما فعال شد/)).toBeInTheDocument());
    expect(window.sessionStorage.getItem('danoa:broadcast:update-success:user-1')).toBeNull();
  });
});
