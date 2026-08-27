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
    localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks();
    vi.spyOn(videoGenerationService, 'getVideoOptions').mockResolvedValue(videoOptions);
    vi.spyOn(videoGenerationService, 'listVideoGenerations').mockResolvedValue({ items: [] });
    vi.spyOn(videoGenerationService, 'getVideoGeneration').mockResolvedValue(generation('succeeded'));
    vi.spyOn(videoGenerationService, 'prepareVideoContent').mockResolvedValue({ contentUrl: '/api/video-generations/job-1/content', downloadUrl: '/api/video-generations/job-1/content?download=1' });
  });
  afterEach(() => vi.useRealTimers());

  it('submits one text-to-video request without media and refreshes history', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(videoGenerationService, 'createVideoGeneration').mockResolvedValue({ generationId: 'job-1', status: 'queued', noaReservationId:'reservation-1', costNoa:'4.000000', unitPriceNoa:'0.800000', durationSeconds:'5', createdAt: '2026-07-20T10:00:00Z' });
    const list = vi.spyOn(videoGenerationService, 'listVideoGenerations').mockResolvedValue({ items: [] });
    render(<VideoGenerationPage onBack={vi.fn()} />);
    await screen.findByRole('heading',{name:'ویدیوت چه حال‌وهوایی داشته باشد؟'});
    await user.click(screen.getByRole('radio',{name:/واقعی و سینمایی/}));
    await user.click(screen.getByRole('button',{name:'ادامه با این سبک'}));
    await user.type(screen.getByRole('textbox',{name:/ایدهٔ ویدیو/}),'یک روباه در جنگل مه‌آلود قدم می‌زند');
    await user.click(screen.getByRole('button',{name:'ادامه و بازبینی'}));
    await user.dblClick(screen.getByRole('button',{name:'ساخت ویدیو'}));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0][0]).toMatchObject({ mode:'text_to_video',resolution:'480p',duration:'5',styleKey:'cinematic' });
    expect(create.mock.calls[0][0]).not.toHaveProperty('mediaId');
    expect(create.mock.calls[0][1]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('hands insufficient wallet details to the shared recovery dialog', async () => {
    const user = userEvent.setup();
    const onInsufficientBalance = vi.fn();
    vi.spyOn(videoGenerationService, 'createVideoGeneration').mockRejectedValue(Object.assign(new Error('اعتبار کافی نیست'), {
      code: 'NOA_INSUFFICIENT_FUNDS',
      status: 402,
      actionKey: 'video_generation',
      balanceNoa: '8',
      requiredNoa: '20',
      shortfallNoa: '12'
    }));
    render(<VideoGenerationPage onBack={vi.fn()} onInsufficientBalance={onInsufficientBalance} />);

    await screen.findByRole('heading',{name:'ویدیوت چه حال‌وهوایی داشته باشد؟'});
    await user.click(screen.getByRole('radio',{name:/واقعی و سینمایی/}));
    await user.click(screen.getByRole('button',{name:'ادامه با این سبک'}));
    await user.type(screen.getByRole('textbox',{name:/ایدهٔ ویدیو/}),'یک روباه در جنگل مه‌آلود قدم می‌زند');
    await user.click(screen.getByRole('button',{name:'ادامه و بازبینی'}));
    await user.click(screen.getByRole('button',{name:'ساخت ویدیو'}));

    await waitFor(() => expect(onInsufficientBalance).toHaveBeenCalledWith({
      actionKey: 'video_generation', balanceNoa: '8', requiredNoa: '20', shortfallNoa: '12'
    }));
    expect(screen.queryByText('اعتبار کافی نیست')).not.toBeInTheDocument();
  });

  it('uploads one reference image and automatically submits image-to-video', async () => {
    const user = userEvent.setup();
    vi.spyOn(videoGenerationService, 'uploadInputMedia').mockResolvedValue({ mediaId:'media-1', mimeType:'image/png', sizeBytes:5 });
    const create = vi.spyOn(videoGenerationService, 'createVideoGeneration').mockResolvedValue({ generationId:'job-1', status:'queued', noaReservationId:'reservation-1', costNoa:'4.000000', unitPriceNoa:'0.800000', durationSeconds:'5', createdAt:'2026-07-20T10:00:00Z' });
    render(<VideoGenerationPage onBack={vi.fn()} />);
    await screen.findByRole('heading',{name:'ویدیوت چه حال‌وهوایی داشته باشد؟'});
    await user.click(screen.getByRole('radio',{name:/واقعی و سینمایی/}));
    await user.click(screen.getByRole('button',{name:'ادامه با این سبک'}));
    const file = new File(['image'],'start.png',{type:'image/png'});
    await user.upload(screen.getByLabelText('انتخاب تصویر مرجع برای ساخت ویدیو'),file);
    await screen.findByText('تصویر مرجع آماده است');
    await user.type(screen.getByRole('textbox',{name:/ایدهٔ ویدیو/}),'دوربین آرام به سوژه نزدیک می‌شود');
    await user.click(screen.getByRole('button',{name:'ادامه و بازبینی'}));
    expect(screen.getByText('تصویر به ویدیو')).toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'ساخت ویدیو'}));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0][0]).toMatchObject({ mode:'image_to_video', mediaId:'media-1', resolution:'480p', duration:'5', styleKey:'cinematic' });
  });

  it('opens the video gallery and selects a gallery card', async () => {
    const user = userEvent.setup(); const item = generation('succeeded', 'gallery-video');
    const get = vi.spyOn(videoGenerationService, 'getVideoGeneration').mockResolvedValue(item);
    vi.spyOn(videoGenerationService, 'listVideoGenerations').mockResolvedValue({ items: [item] });
    render(<VideoGenerationPage onBack={vi.fn()} />);
    await user.click(screen.getByRole('tab', { name: 'ویدیوهای من' }));
    expect(await screen.findByRole('heading', { name: 'ویدیوهای من' })).toBeInTheDocument();
    const card = await screen.findByRole('button', { name: /یک جنگل مه آلود/ }); await user.click(card);
    expect(get).toHaveBeenCalledWith('gallery-video', expect.any(AbortSignal));
  });

  it('supports arrow-key navigation between the studio tabs', async () => {
    render(<VideoGenerationPage onBack={vi.fn()} />);
    const createTab = await screen.findByRole('tab', { name:'ساخت ویدیو' });
    createTab.focus();
    fireEvent.keyDown(createTab, { key:'ArrowLeft' });
    expect(screen.getByRole('tab', { name:'ویدیوهای من' })).toHaveAttribute('aria-selected','true');
    fireEvent.keyDown(screen.getByRole('tab', { name:'ویدیوهای من' }), { key:'Home' });
    expect(screen.getByRole('tab', { name:'ساخت ویدیو' })).toHaveAttribute('aria-selected','true');
  });

  it('resumes a valid local hint and removes a stale hint', async () => {
    localStorage.setItem(ACTIVE_GENERATION_HINT_KEY, 'hint'); const get = vi.spyOn(videoGenerationService, 'getVideoGeneration').mockResolvedValue(generation('processing', 'hint'));
    vi.spyOn(videoGenerationService, 'listVideoGenerations').mockResolvedValue({ items: [generation('processing', 'hint'), generation('queued', 'older')] }); render(<VideoGenerationPage onBack={vi.fn()} />);
    await waitFor(() => expect(get).toHaveBeenCalledWith('hint', expect.any(AbortSignal))); expect(localStorage.getItem(ACTIVE_GENERATION_HINT_KEY)).toBe('hint');
    localStorage.setItem(ACTIVE_GENERATION_HINT_KEY, 'deleted'); vi.restoreAllMocks(); vi.spyOn(videoGenerationService, 'getVideoOptions').mockResolvedValue(videoOptions); vi.spyOn(videoGenerationService, 'listVideoGenerations').mockResolvedValue({ items: [generation('succeeded', 'done')] }); render(<VideoGenerationPage onBack={vi.fn()} />);
    await waitFor(() => expect(localStorage.getItem(ACTIVE_GENERATION_HINT_KEY)).toBeNull());
  });

  it('uses the polling backoff and recognizes every terminal state', () => {
    vi.useFakeTimers(); const poll = vi.fn(); window.setTimeout(poll, POLL_DELAYS_MS[1]); vi.advanceTimersByTime(POLL_DELAYS_MS[1] - 1); expect(poll).not.toHaveBeenCalled(); vi.advanceTimersByTime(1); expect(poll).toHaveBeenCalledOnce();
    expect(POLL_DELAYS_MS).toEqual([1500, 2500, 4000, 6000, 8000]); expect(['succeeded', 'failed', 'cancelled', 'expired'].every(isTerminalVideoStatus)).toBe(true); expect(isTerminalVideoStatus('processing')).toBe(false);
  });

  it('aborts an active detail request on unmount', async () => {
    let signal: AbortSignal | undefined; vi.spyOn(videoGenerationService, 'listVideoGenerations').mockResolvedValue({ items: [generation('processing')] }); vi.spyOn(videoGenerationService, 'getVideoGeneration').mockImplementation((_id, currentSignal) => { signal = currentSignal; return new Promise(() => {}); });
    const { unmount } = render(<VideoGenerationPage onBack={vi.fn()} />); await waitFor(() => expect(signal).toBeDefined()); unmount(); expect(signal?.aborted).toBe(true);
    vi.spyOn(videoGenerationService, 'getVideoOptions').mockResolvedValue(noVideoOptions);
  });

  it('shows both styles even when unauthenticated history loading is rejected', async () => {
    vi.spyOn(videoGenerationService, 'listVideoGenerations').mockRejectedValue(new Error('برای ساخت ویدیو ابتدا وارد حساب کاربری شوید.'));
    render(<VideoGenerationPage onBack={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'ویدیوت چه حال‌وهوایی داشته باشد؟' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.queryByText('برای ساخت ویدیو ابتدا وارد حساب کاربری شوید.')).not.toBeInTheDocument();
  });

  it('runs the complete local text-only demo without upload, submit, or external API usage', async () => {
    const user = userEvent.setup();
    vi.spyOn(videoGenerationService, 'getVideoOptions').mockResolvedValue({ ...videoOptions, enabled: false, capabilities: {}, readiness: {} });
    const upload = vi.spyOn(videoGenerationService, 'uploadInputMedia');
    const create = vi.spyOn(videoGenerationService, 'createVideoGeneration');
    render(<VideoGenerationPage onBack={vi.fn()} localDemoEnabled />);

    await screen.findByText(/حالت تست محلی فعال است/);
    await user.click(screen.getByRole('radio', { name: /واقعی و سینمایی/ }));
    await user.click(screen.getByRole('button', { name: 'ادامه با این سبک' }));
    expect(screen.getByRole('heading', { name: 'چه ویدیویی بسازیم؟' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name:/تنظیمات ویدیو/ }));
    const durationSlider = screen.getByRole('slider', { name: 'مدت ویدیو به ثانیه' });
    expect(durationSlider).toHaveAttribute('min', '1'); expect(durationSlider).toHaveAttribute('max', '15'); expect(durationSlider).toHaveValue('5');
    fireEvent.change(durationSlider, { target: { value: '3' } });
    await user.type(screen.getByRole('textbox',{name:/ایدهٔ ویدیو/}), 'حرکت آرام دوربین روی یک شهر خیالی');
    await user.click(screen.getByRole('button', { name: 'ادامه و بازبینی' }));
    expect(screen.getByRole('heading', { name: 'بازبینی درخواست' })).toBeInTheDocument();
    expect(screen.getByText(/3 ثانیه · 480p/)).toBeInTheDocument();
    expect(screen.getByText(/با هوش مصنوعی ساخته می‌شود/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'تکمیل تست محلی' }));

    expect(await screen.findByText(/تست محلی با موفقیت کامل شد/)).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
