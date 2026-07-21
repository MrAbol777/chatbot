import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { videoModel } from '../test/fixtures/video-generation';
import VideoGenerationForm from './VideoGenerationForm';

const props = (overrides: Partial<React.ComponentProps<typeof VideoGenerationForm>> = {}) => ({ models: [videoModel], loading: false, error: '', onRetry: vi.fn(), modelKey: 'test-video', setModelKey: vi.fn(), prompt: '', setPrompt: vi.fn(), aspectRatio: '16:9', setAspectRatio: vi.fn(), duration: '5', setDuration: vi.fn(), quality: 'standard', setQuality: vi.fn(), submitting: false, onSubmit: vi.fn(), ...overrides });

describe('VideoGenerationForm', () => {
  it('renders loading, retry error, and no-active-model states', () => {
    const retry = vi.fn(); const { rerender } = render(<VideoGenerationForm {...props({ loading: true, onRetry: retry })} />);
    expect(screen.getByRole('status')).toHaveTextContent('در حال دریافت مدل‌ها');
    rerender(<VideoGenerationForm {...props({ error: 'خطای امن', onRetry: retry })} />); fireEvent.click(screen.getByRole('button', { name: 'دریافت دوباره' })); expect(retry).toHaveBeenCalledOnce();
    rerender(<VideoGenerationForm {...props({ models: [] })} />); expect(screen.getByText(/فعلاً مدل فعالی/)).toBeInTheDocument();
  });

  it('validates empty, whitespace, too-long, and valid prompts', async () => {
    const user = userEvent.setup(); const onSubmit = vi.fn(); const setPrompt = vi.fn(); const { rerender } = render(<VideoGenerationForm {...props({ onSubmit, setPrompt })} />);
    expect(screen.getByRole('button', { name: 'ساخت ویدیو' })).toBeDisabled(); await user.type(screen.getByLabelText(/توضیحات ویدیو/), ' '); expect(setPrompt).toHaveBeenCalled();
    rerender(<VideoGenerationForm {...props({ prompt: '  ', onSubmit })} />); expect(screen.getByText('توضیحات ویدیو را وارد کنید.')).toBeInTheDocument();
    rerender(<VideoGenerationForm {...props({ prompt: 'x'.repeat(41), onSubmit })} />); expect(screen.getByText('حداکثر 40 کاراکتر مجاز است.')).toBeInTheDocument();
    rerender(<VideoGenerationForm {...props({ prompt: 'یک متن معتبر', onSubmit })} />); await user.click(screen.getByRole('button', { name: 'ساخت ویدیو' })); expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('has labelled settings controls and keeps image-to-video/upload unavailable', () => {
    const setAspectRatio = vi.fn(); const { container } = render(<VideoGenerationForm {...props({ prompt: 'یک متن معتبر', setAspectRatio })} />);
    expect(screen.getByLabelText(/مدل ساخت ویدیو/)).toHaveValue('test-video'); expect(screen.getByRole('group', { name: /نسبت تصویر/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /عمودی/ })); fireEvent.change(screen.getByLabelText(/کیفیت/), { target: { value: 'high' } });
    expect(setAspectRatio).toHaveBeenCalledWith('9:16');
    expect(screen.getByText('تصویر به ویدیو به‌زودی')).toBeInTheDocument(); expect(container.querySelector('input[type=file]')).toBeNull(); expect(screen.queryByText(/providerModelId|provider_model/i)).toBeNull();
  });
});
