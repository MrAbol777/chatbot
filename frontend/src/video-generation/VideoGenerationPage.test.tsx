import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generation, noVideoOptions, videoOptions } from '../test/fixtures/video-generation';
import { ACTIVE_GENERATION_HINT_KEY, POLL_DELAYS_MS } from './video-generation.constants';
import { isTerminalVideoStatus } from './video-generation.utils';
import VideoGenerationPage from './VideoGenerationPage';
import { videoGenerationService } from './video-generation.service';

describe('VideoGenerationPage submit, polling, resume, and cleanup', () => {
  beforeEach(() => {
    localStorage.clear(); vi.restoreAllMocks();
    vi.spyOn(videoGenerationService, 'getVideoOptions').mockResolvedValue(videoOptions);
    vi.spyOn(videoGenerationService, 'listVideoGenerations').mockResolvedValue({ items: [] });
    vi.spyOn(videoGenerationService, 'getVideoGeneration').mockResolvedValue(generation('succeeded'));
    vi.spyOn(videoGenerationService, 'prepareVideoContent').mockResolvedValue({ contentUrl: '/api/video-generations/job-1/content', downloadUrl: '/api/video-generations/job-1/content?download=1' });
  });
  afterEach(() => vi.useRealTimers());

  it('submits only once for a double click and refreshes history', async () => {
    const user = userEvent.setup(); const create = vi.spyOn(videoGenerationService, 'createVideoGeneration').mockResolvedValue({ generationId: 'job-1', status: 'queued', quotaUnitsReserved: 2, createdAt: '2026-07-20T10:00:00Z' });
    const list = vi.spyOn(videoGenerationService, 'listVideoGenerations').mockResolvedValue({ items: [] }); render(<VideoGenerationPage onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText(/توضیحات ویدیو/)).toBeEnabled()); await user.type(screen.getByLabelText(/توضیحات ویدیو/), 'یک متن معتبر'); await user.dblClick(screen.getByRole('button', { name: 'ساخت ویدیو' }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce()); expect(create.mock.calls[0][1]).toMatch(/^[0-9a-f-]{36}$/i); expect(list).toHaveBeenCalledTimes(2); expect(screen.queryByText(create.mock.calls[0][1])).toBeNull();
  });

  it('opens a dedicated video gallery from the my-videos tab and selects a gallery card', async () => {
    const user = userEvent.setup(); const item = generation('succeeded', 'gallery-video');
    const get = vi.spyOn(videoGenerationService, 'getVideoGeneration').mockResolvedValue(item);
    vi.spyOn(videoGenerationService, 'listVideoGenerations').mockResolvedValue({ items: [item] });
    render(<VideoGenerationPage onBack={vi.fn()} />);
    await user.click(screen.getByRole('tab', { name: 'ویدیوهای من' }));
    expect(await screen.findByRole('heading', { name: 'ویدیوهای من' })).toBeInTheDocument();
    const card = await screen.findByRole('button', { name: /یک جنگل مه آلود/ }); await user.click(card);
    expect(get).toHaveBeenCalledWith('gallery-video', expect.any(AbortSignal));
  });

  it('resumes a valid local hint, selects newest pending history, and removes a stale hint', async () => {
    localStorage.setItem(ACTIVE_GENERATION_HINT_KEY, 'hint'); const get = vi.spyOn(videoGenerationService, 'getVideoGeneration').mockResolvedValue(generation('processing', 'hint'));
    vi.spyOn(videoGenerationService, 'listVideoGenerations').mockResolvedValue({ items: [generation('processing', 'hint'), generation('queued', 'older')] }); render(<VideoGenerationPage onBack={vi.fn()} />);
    await waitFor(() => expect(get).toHaveBeenCalledWith('hint', expect.any(AbortSignal))); expect(localStorage.getItem(ACTIVE_GENERATION_HINT_KEY)).toBe('hint');
    localStorage.setItem(ACTIVE_GENERATION_HINT_KEY, 'deleted'); vi.restoreAllMocks(); vi.spyOn(videoGenerationService, 'getVideoOptions').mockResolvedValue(videoOptions); vi.spyOn(videoGenerationService, 'listVideoGenerations').mockResolvedValue({ items: [generation('succeeded', 'done')] }); render(<VideoGenerationPage onBack={vi.fn()} />);
    await waitFor(() => expect(localStorage.getItem(ACTIVE_GENERATION_HINT_KEY)).toBeNull());
  });

  it('uses fake timers for the exact polling backoff and recognizes every terminal state', () => {
    vi.useFakeTimers(); const poll = vi.fn(); window.setTimeout(poll, POLL_DELAYS_MS[1]); vi.advanceTimersByTime(POLL_DELAYS_MS[1] - 1); expect(poll).not.toHaveBeenCalled(); vi.advanceTimersByTime(1); expect(poll).toHaveBeenCalledOnce();
    expect(POLL_DELAYS_MS).toEqual([1500, 2500, 4000, 6000, 8000]); expect(['succeeded', 'failed', 'cancelled', 'expired'].every(isTerminalVideoStatus)).toBe(true); expect(isTerminalVideoStatus('processing')).toBe(false);
  });

  it('aborts an active detail request on unmount and presents unavailable options safely', async () => {
    let signal: AbortSignal | undefined; vi.spyOn(videoGenerationService, 'listVideoGenerations').mockResolvedValue({ items: [generation('processing')] }); vi.spyOn(videoGenerationService, 'getVideoGeneration').mockImplementation((_id, currentSignal) => { signal = currentSignal; return new Promise(() => {}); });
    const { unmount } = render(<VideoGenerationPage onBack={vi.fn()} />); await waitFor(() => expect(signal).toBeDefined()); unmount(); expect(signal?.aborted).toBe(true);
    vi.spyOn(videoGenerationService, 'getVideoOptions').mockResolvedValue(noVideoOptions);
  });
});
