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

  it('accepts an active model with no prompt-length limit, matching the local backend response', async () => {
    const optionsWithoutPromptLimit = { models: [{ ...videoOptions.models[0], maxPromptLength: null }] };
    fetchMock.mockResolvedValueOnce(json(optionsWithoutPromptLimit));

    await expect(videoGenerationService.getVideoOptions()).resolves.toEqual(optionsWithoutPromptLimit);
  });

  it('submits a text-to-video job through a mocked local API response', async () => {
    fetchMock.mockResolvedValueOnce(json({ generationId: 'job-1', status: 'queued', quotaUnitsReserved: 2, createdAt: '2026-07-20T10:00:00Z' }, 202));

    await expect(videoGenerationService.createVideoGeneration({ mode: 'text-to-video', modelKey: 'test-video', prompt: 'یک جنگل مه آلود', aspectRatio: '16:9', duration: '5', quality: 'standard' }, 'local-attempt-key')).resolves.toMatchObject({ generationId: 'job-1', status: 'queued' });
    const [, init] = fetchMock.mock.calls[0];
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('local-attempt-key');
  });

  it('lists history, fetches encoded details, and rejects provider content URLs', async () => {
    fetchMock.mockResolvedValueOnce(json({ items: [generation()] })).mockResolvedValueOnce(json(generation('processing', 'job a/b'))).mockResolvedValueOnce(json({ contentUrl: 'https://provider.invalid/file.mp4', downloadUrl: 'https://provider.invalid/file.mp4' }));
    await expect(videoGenerationService.listVideoGenerations()).resolves.toMatchObject({ items: [expect.objectContaining({ id: 'job-1' })] });
    await videoGenerationService.getVideoGeneration('job a/b');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/video-generations/job%20a%2Fb');
    await expect(videoGenerationService.prepareVideoContent('job-1')).rejects.toMatchObject({ code: 'UNKNOWN_ERROR' });
  });

  it.each([[400, 'VIDEO_INVALID_SETTINGS'], [401, 'VIDEO_GENERATION_LOGIN_REQUIRED'], [403, 'VIDEO_SUBSCRIPTION_REQUIRED'], [409, 'VIDEO_GENERATION_IDEMPOTENCY_CONFLICT'], [429, 'VIDEO_QUOTA_EXCEEDED'], [503, 'VIDEO_PROVIDER_UNAVAILABLE']])('maps HTTP %i to the safe %s error', async (status, code) => {
    fetchMock.mockResolvedValueOnce(json({ message: 'provider stack trace' }, status));
    await expect(videoGenerationService.getVideoOptions()).rejects.toMatchObject({ code, status });
  });

  it('maps malformed success and network failure safely', async () => {
    fetchMock.mockResolvedValueOnce(json({ models: [{}] })).mockRejectedValueOnce(new TypeError('offline'));
    await expect(videoGenerationService.getVideoOptions()).rejects.toMatchObject({ code: 'UNKNOWN_ERROR' });
    await expect(videoGenerationService.getVideoOptions()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});
