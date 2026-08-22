import { describe, expect, it, vi } from 'vitest';
import { startImageToImage } from './imageToImage';

describe('image-to-image service', () => {
  it('sends selected files to the dedicated image-to-image endpoint', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      id: 'job-1', status: 'queued', prompt: 'آسمان را آبی کن', aspectRatio: '1:1', inputCount: 1,
      safeErrorCode: null, safeErrorMessage: null, createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z', completedAt: null, result: null
    }), { status: 202, headers: { 'Content-Type': 'application/json' } }));
    localStorage.setItem('chat_auth_token', 'token-1');
    const job = await startImageToImage({
      prompt: 'آسمان را آبی کن', aspectRatio: '1:1', idempotencyKey: 'request-1', files: [new File(['source'], 'source.png', { type: 'image/png' })]
    });
    expect(job.id).toBe('job-1');
    const [, init] = fetchMock.mock.calls[0];
    expect(fetchMock.mock.calls[0][0]).toBe('/api/image-to-image/jobs');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer token-1', 'Idempotency-Key': 'request-1' });
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).get('prompt')).toBe('آسمان را آبی کن');
    expect((init?.body as FormData).getAll('images')).toHaveLength(1);
  });
});
