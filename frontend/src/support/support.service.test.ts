import { afterEach, describe, expect, it, vi } from 'vitest';
import { listSupportTickets } from './support.service';

describe('support service authentication', () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('sends the saved OTP bearer token when listing support tickets', async () => {
    localStorage.setItem('chat_auth_token', 'support-token');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), {
      headers: { 'Content-Type': 'application/json' }
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listSupportTickets()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith('/api/support', expect.objectContaining({
      credentials: 'include',
      headers: expect.objectContaining({ Authorization: 'Bearer support-token' })
    }));
  });
});
