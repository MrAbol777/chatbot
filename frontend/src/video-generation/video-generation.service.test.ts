import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generation, json, videoOptions } from '../test/fixtures/video-generation';
import { videoGenerationService } from './video-generation.service';

const fetchMock = vi.fn();

describe('mocked video-generation API requests', () => {
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });

  it('requests real backend options through a mocked local API response', async () => {
    fetchMock.mockResolvedValueOnce(json(videoOptions));

    await expect(videoGenerationService.getVideoOptions()).resolves.toEqual(videoOptions);
    expect(fetchMock).toHaveBeenCalledWith('/api/video-generation/options', expect.objectContaining({ credentials: 'include', cache: 'no-store' }));
  });

  it('accepts a routed capability with no prompt-length limit', async () => {
    const optionsWithoutPromptLimit = { ...videoOptions, capabilities: { 'video.text_to_video': { ...videoOptions.capabilities['video.text_to_video'], maxPromptLength: null } } };
    fetchMock.mockResolvedValueOnce(json(optionsWithoutPromptLimit));

    await expect(videoGenerationService.getVideoOptions()).resolves.toEqual(optionsWithoutPromptLimit);
  });

  it('submits only the public text-to-video fields through a mocked local API response', async () => {
    fetchMock.mockResolvedValueOnce(json({ generationId: 'job-1', status: 'queued', noaReservationId:'reservation-1', costNoa:'4.000000', unitPriceNoa:'0.800000', durationSeconds:'5', createdAt: '2026-07-20T10:00:00Z' }, 202));

    await expect(videoGenerationService.createVideoGeneration({ mode: 'text_to_video', styleKey:'cinematic', prompt: 'یک جنگل مه آلود', aspectRatio: '9:16', duration: '5', resolution:'480p' }, 'local-attempt-key')).resolves.toMatchObject({ generationId: 'job-1', status: 'queued' });
    const [, init] = fetchMock.mock.calls[0];
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('local-attempt-key');
    expect(JSON.parse(init.body as string)).toEqual({mode:'text_to_video',styleKey:'cinematic',prompt:'یک جنگل مه آلود',aspectRatio:'9:16',duration:'5',resolution:'480p'});
  });

  it('uploads I2V input as authenticated multipart and returns only safe media metadata', async () => {
    fetchMock.mockResolvedValueOnce(json({ mediaId: 'media-1', mimeType: 'image/png', sizeBytes: 12 }, 201));
    const file = new File([new Uint8Array(12)], 'input.png', { type: 'image/png' });
    await expect(videoGenerationService.uploadInputMedia(file)).resolves.toEqual({ mediaId: 'media-1', mimeType: 'image/png', sizeBytes: 12 });
    const [, init] = fetchMock.mock.calls[0]; expect(init.method).toBe('POST'); expect(init.body).toBeInstanceOf(FormData); expect(new Headers(init.headers).has('Content-Type')).toBe(false);
  });

  it('lists history, fetches encoded details, and rejects provider content URLs', async () => {
    fetchMock.mockResolvedValueOnce(json({ items: [generation()] })).mockResolvedValueOnce(json(generation('processing', 'job a/b'))).mockResolvedValueOnce(json({ contentUrl: 'https://provider.invalid/file.mp4', downloadUrl: 'https://provider.invalid/file.mp4' }));
    await expect(videoGenerationService.listVideoGenerations()).resolves.toMatchObject({ items: [expect.objectContaining({ id: 'job-1' })] });
    await videoGenerationService.getVideoGeneration('job a/b');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/video-generations/job%20a%2Fb');
    await expect(videoGenerationService.prepareVideoContent('job-1')).rejects.toMatchObject({ code: 'UNKNOWN_ERROR' });
  });

  it.each([[400, 'VIDEO_INVALID_SETTINGS'], [401, 'VIDEO_GENERATION_LOGIN_REQUIRED'], [402, 'NOA_INSUFFICIENT_FUNDS'], [403, 'VIDEO_GENERATION_LOGIN_REQUIRED'], [409, 'VIDEO_GENERATION_IDEMPOTENCY_CONFLICT'], [429, 'VIDEO_PROVIDER_RATE_LIMITED'], [503, 'VIDEO_PROVIDER_UNAVAILABLE']])('maps HTTP %i to the safe %s error', async (status, code) => {
    fetchMock.mockResolvedValueOnce(json({ message: 'provider stack trace' }, status));
    await expect(videoGenerationService.getVideoOptions()).rejects.toMatchObject({ code, status });
  });

  it('keeps the safe balance breakdown from a rejected video request', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'NOA_INSUFFICIENT_FUNDS', actionKey: 'video_generation', balanceNoa: '8', requiredNoa: '20', shortfallNoa: '12' }, 402));

    await expect(videoGenerationService.createVideoGeneration({ mode: 'text_to_video', styleKey: 'cinematic', prompt: 'یک جنگل مه‌آلود', aspectRatio: '9:16', duration: '5', resolution: '480p' }, 'local-attempt-key'))
      .rejects.toMatchObject({ code: 'NOA_INSUFFICIENT_FUNDS', status: 402, actionKey: 'video_generation', balanceNoa: '8', requiredNoa: '20', shortfallNoa: '12' });
  });

  it('maps malformed success and network failure safely', async () => {
    fetchMock.mockResolvedValueOnce(json({ models: [{}] })).mockRejectedValueOnce(new TypeError('offline'));
    await expect(videoGenerationService.getVideoOptions()).rejects.toMatchObject({ code: 'UNKNOWN_ERROR' });
    await expect(videoGenerationService.getVideoOptions()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});
