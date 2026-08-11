import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AiProviderManagement from './AiProviderManagement';
import { ToastProvider } from '../../design-system/components';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const provider = { providerKey: 'metis', displayName: 'Metis Video', enabled: true, keyConfigured: false, maxConcurrency: null, dailyCostLimit: null, readiness: 'READY', version: 1 };
const model = { internalKey: 'metis_model', providerKey: 'metis', providerModelId: 'fixture-model', displayNameFa: 'مدل مسیر', active: true, public: false, capabilities: { textToVideo: true, imageToVideo: false, negativePrompt: true, audio: false }, version: 1 };
const route = { routeId: 'video-t2v', capability: 'video.text_to_video', primary: { providerKey: 'metis', modelKey: 'metis_model' }, fallback: null, policy: 'AUTO_FALLBACK', enabled: true, maxConcurrency: null, dailyCostLimit: null, version: 1 };

describe('AiProviderManagement', () => {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'PATCH' || init?.method === 'POST') return Promise.resolve(json({ success: true, version: 2 }));
    if (url.endsWith('/providers')) return Promise.resolve(json({ items: [provider] }));
    if (url.endsWith('/models')) return Promise.resolve(json({ items: [model] }));
    if (url.endsWith('/routes')) return Promise.resolve(json({ items: [route] }));
    return Promise.resolve(json({ items: [] }));
  });

  beforeEach(() => { fetchMock.mockClear(); vi.stubGlobal('fetch', fetchMock); });

  it('renders six accessible tabs and never displays secrets or provider endpoints', async () => {
    render(<ToastProvider><AiProviderManagement /></ToastProvider>);
    expect(await screen.findByRole('heading', { name: 'مدیریت ارائه‌دهندگان هوش مصنوعی' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(6);
    expect(screen.getByText(/Fallback فقط پیش از Submit/)).toBeInTheDocument();
    expect(screen.queryByText(/Bearer|api\.metisai\.ir|BANANAAI_API_KEY/i)).not.toBeInTheDocument();
  });

  it('requires a reason and confirmation before an optimistic route write', async () => {
    const user = userEvent.setup();
    render(<ToastProvider><AiProviderManagement /></ToastProvider>);
    const save = await screen.findByRole('button', { name: 'ثبت Route' }); expect(save).toBeDisabled();
    await user.type(screen.getByLabelText('دلیل تغییر'), 'تغییر کنترل‌شده مسیر'); expect(save).toBeEnabled(); await user.click(save);

    const confirmBtn = await screen.findByRole('button', { name: 'ثبت' });
    await user.click(confirmBtn);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/ai-routing/routes/video.text_to_video', expect.objectContaining({ method: 'PATCH' })));
    const dialog = document.querySelector('.ds-confirm');
    expect(dialog).not.toBeInTheDocument();
  });
});