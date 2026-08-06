import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    vi.spyOn(videoGenerationService, 'uploadInputMedia').mockResolvedValue({mediaId:'media-1',mimeType:'image/jpeg',sizeBytes:12});
  });
  afterEach(() => vi.useRealTimers());

  it('submits only once for a double click and refreshes history', async () => {
    const user = userEvent.setup(); const create = vi.spyOn(videoGenerationService, 'createVideoGeneration').mockResolvedValue({ generationId: 'job-1', status: 'queued', noaReservationId:'reservation-1', costNoa:'4.000000', unitPriceNoa:'0.800000', durationSeconds:'5', createdAt: '2026-07-20T10:00:00Z' });
    const list = vi.spyOn(videoGenerationService, 'listVideoGenerations').mockResolvedValue({ items: [] }); render(<VideoGenerationPage onBack={vi.fn()} />);
    await screen.findByRole('heading',{name:'سبک ویدیوت را انتخاب کن'}); await user.click(screen.getByRole('radio',{name:/واقعی و سینمایی/})); await user.click(screen.getByRole('button',{name:'ادامه با این سبک'}));
    const file=new File([new Uint8Array(12)],'input.jpg',{type:'image/jpeg'});     await user.upload(screen.getByLabelText(/تصاویر ورودی خصوصی/),file); await user.type(screen.getByLabelText(/توضیح حرکت/),'یک متن معتبر'); await user.click(screen.getByRole('button',{name:'ادامه و بازبینی'})); await user.dblClick(screen.getByRole('button',{name:'تایید و ساخت ویدیو'}));
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

  it('keeps both style cards visible while the production I2V route remains disabled',async()=>{const user=userEvent.setup();vi.spyOn(videoGenerationService,'getVideoOptions').mockResolvedValue({...videoOptions,enabled:false,capabilities:{}});render(<VideoGenerationPage onBack={vi.fn()}/>);expect(await screen.findAllByRole('radio')).toHaveLength(2);await user.click(screen.getByRole('radio',{name:/انیمیشنی/}));await user.click(screen.getByRole('button',{name:'ادامه با این سبک'}));expect(screen.getByText(/فعلاً توسط مدیر سامانه فعال نشده/)).toBeInTheDocument();});

  it('shows the style menu even when unauthenticated history loading is rejected', async () => {
    vi.spyOn(videoGenerationService, 'listVideoGenerations').mockRejectedValue(new Error('برای ساخت ویدیو ابتدا وارد حساب کاربری شوید.'));
    render(<VideoGenerationPage onBack={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'سبک ویدیوت را انتخاب کن' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.queryByText('برای ساخت ویدیو ابتدا وارد حساب کاربری شوید.')).not.toBeInTheDocument();
  });

  it('runs the complete local UI demo without upload, submit, or external API usage', async () => {
    const user = userEvent.setup();
    vi.spyOn(videoGenerationService, 'getVideoOptions').mockResolvedValue({ ...videoOptions, enabled: false, capabilities: {} });
    const upload = vi.spyOn(videoGenerationService, 'uploadInputMedia');
    const create = vi.spyOn(videoGenerationService, 'createVideoGeneration');
    render(<VideoGenerationPage onBack={vi.fn()} localDemoEnabled />);

    await screen.findByText(/حالت تست محلی فعال است/);
    await user.click(screen.getByRole('radio', { name: /واقعی و سینمایی/ }));
    await user.click(screen.getByRole('button', { name: 'ادامه با این سبک' }));
    expect(screen.getByRole('heading', { name: 'عکس را چطور زنده کنیم؟' })).toBeInTheDocument();
    const durationSlider = screen.getByRole('slider', { name: 'مدت ویدیو به ثانیه' });
    expect(durationSlider).toHaveAttribute('min', '1'); expect(durationSlider).toHaveAttribute('max', '15');
    fireEvent.change(durationSlider, { target: { value: '15' } });
    await user.click(screen.getByRole('button', { name: 'وضوح 480p' }));

    await user.upload(screen.getByLabelText(/تصاویر ورودی خصوصی/), new File([new Uint8Array(12)], 'demo.jpg', { type: 'image/jpeg' }));
    await user.type(screen.getByLabelText(/توضیح حرکت/), 'حرکت آرام دوربین');
    await user.click(screen.getByRole('button', { name: 'ادامه و بازبینی' }));
    expect(screen.getByRole('heading', { name: 'بازبینی درخواست' })).toBeInTheDocument();
    expect(screen.getByText(/15 ثانیه · 480p/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'تکمیل تست محلی' }));

    expect(await screen.findByText(/تست محلی با موفقیت کامل شد/)).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
