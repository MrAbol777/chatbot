import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VideoGenerationsAdmin from './VideoGenerationsAdmin';

const listItem = {
  id: 'video-1',
  userId: 'user-1',
  user: { name: 'علی رضایی', phone: '09120000000', age: 28 },
  status: 'succeeded',
  mode: 'image-to-video',
  prompt: 'حرکت آرام دوربین به سمت سوژه',
  provider: 'metis',
  model: 'kling-video',
  aspectRatio: '16:9',
  duration: '5',
  resolution: '1080p',
  hasInput: true,
  inputImageUrl: '/api/admin/video-generations/video-1/input',
  hasResult: true,
  resultContentUrl: '/api/video-generations/video-1/content',
  resultMimeType: 'video/mp4',
  resultSizeBytes: 4096,
  createdAt: '2026-07-29T08:30:00.000Z',
  updatedAt: '2026-07-29T08:31:00.000Z',
  completedAt: '2026-07-29T08:31:00.000Z'
};

const detail = {
  ...listItem,
  internalRequestId: 'request-internal-1',
  prompts: {
    user: listItem.prompt,
    compiled: 'پرامپت نهایی کامپایل‌شده برای ارائه‌دهنده',
    negative: 'بدون لرزش',
    compiledHash: 'a'.repeat(64)
  },
  settings: {
    mode: 'image-to-video',
    aspectRatio: '16:9',
    duration: '5',
    quality: 'high',
    resolution: '1080p',
    generateAudio: false
  },
  routing: {
    capability: 'video.image-to-video',
    routeId: 'route-1',
    routeVersion: 3,
    provider: 'metis',
    model: 'kling-video',
    providerModel: 'kling-v2',
    attemptState: 'completed'
  },
  promptProfile: { key: 'cinematic', version: 2, compilerVersion: '1' },
  input: {
    url: '/api/admin/video-generations/video-1/input',
    mediaId: 'media-1',
    filename: 'photo.webp',
    mimeType: 'image/webp',
    sizeBytes: 1024,
    createdAt: '2026-07-29T08:30:00.000Z'
  },
  result: {
    contentUrl: '/api/video-generations/video-1/content',
    downloadUrl: '/api/video-generations/video-1/content?download=1',
    mimeType: 'video/mp4',
    sizeBytes: 4096,
    sha256: 'b'.repeat(64),
    originalFilename: 'output.mp4',
    storedAt: '2026-07-29T08:31:00.000Z'
  },
  billing: {
    reservationId: 'reservation-1',
    status: 'captured',
    quantity: '5.000000',
    unit: 'second',
    unitPriceNoa: '0.250000',
    amountNoa: '1.250000',
    capturedAt: '2026-07-29T08:31:00.000Z',
    releasedAt: null,
    releaseReason: null
  },
  providerMetrics: {
    estimatedCost: '0.100000',
    actualCost: '0.090000',
    costCurrency: 'USD',
    processingTimeMs: 8400
  },
  errors: { code: null, message: null },
  timeline: {
    createdAt: '2026-07-29T08:30:00.000Z',
    completedAt: '2026-07-29T08:31:00.000Z'
  },
  diagnostics: {
    providerStatus: 'completed',
    pollAttempts: 4,
    storageAttempts: 1,
    resultStorageStatus: 'stored'
  }
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

describe('VideoGenerationsAdmin', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/admin/video-generations/video-1') return json(detail);
      if (url.startsWith('/api/admin/video-generations?')) {
        return json({
          items: [listItem],
          total: 1,
          page: 1,
          pageSize: 12,
          summary: { total: 1, succeeded: 1, active: 0, failed: 0 }
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
  });

  it('shows the overall job context and opens a complete input-to-output detail view', async () => {
    const user = userEvent.setup();
    render(<VideoGenerationsAdmin />);

    expect(await screen.findByText('علی رضایی')).toBeInTheDocument();
    expect(screen.getByText('حرکت آرام دوربین به سمت سوژه')).toBeInTheDocument();
    expect(screen.getByText('۱ درخواست')).toBeInTheDocument();

    const detailButton = screen.getByRole('button', { name: 'مشاهده جزئیات' });
    await user.click(detailButton);

    expect(await screen.findByRole('dialog', { name: /ویدیو/ })).toBeInTheDocument();
    expect(screen.getByText('تصویر ورودی کاربر')).toBeInTheDocument();
    expect(screen.getByText('ویدیوی خروجی')).toBeInTheDocument();
    expect(screen.getByText('پرامپت نهایی کامپایل‌شده برای ارائه‌دهنده')).toBeInTheDocument();
    expect(screen.getByText('۱٫۲۵ نوآ')).toBeInTheDocument();

    const videoSource = document.querySelector('video source');
    expect(videoSource).toHaveAttribute('src', '/api/video-generations/video-1/content');
    expect(document.querySelector('video')).not.toHaveAttribute('autoplay');

    await user.click(screen.getByRole('button', { name: 'بستن جزئیات ویدیو' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(detailButton).toHaveFocus();
  });

  it('applies explicit search and status filters without firing on every keystroke', async () => {
    const user = userEvent.setup();
    render(<VideoGenerationsAdmin />);
    await screen.findByText('علی رضایی');

    const fetchMock = vi.mocked(fetch);
    const initialCalls = fetchMock.mock.calls.length;
    await user.type(screen.getByRole('searchbox'), 'حرکت');
    await user.selectOptions(screen.getByRole('combobox'), 'succeeded');
    expect(fetchMock).toHaveBeenCalledTimes(initialCalls);

    await user.click(screen.getByRole('button', { name: 'اعمال فیلتر' }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(initialCalls + 1));
    const requestedUrl = String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1]?.[0]);
    expect(requestedUrl).toContain(`q=${encodeURIComponent('حرکت')}`);
    expect(requestedUrl).toContain('status=succeeded');
  });
});
