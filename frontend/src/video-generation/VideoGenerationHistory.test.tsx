import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { generation } from '../test/fixtures/video-generation';
import VideoGenerationHistory from './VideoGenerationHistory';
import VideoGenerationStatus from './VideoGenerationStatus';

describe('VideoGenerationHistory and status UI', () => {
  it('renders loading, empty, safe retry error, ordered items, and mouse/keyboard selection', async () => {
    const user = userEvent.setup(); const retry = vi.fn(); const onSelect = vi.fn(); const { rerender } = render(<VideoGenerationHistory items={[]} loading error="" onRetry={retry} onSelect={onSelect} />);
    expect(screen.getByRole('status')).toHaveTextContent('در حال دریافت تاریخچه');
    rerender(<VideoGenerationHistory items={[]} loading={false} error="خطای امن" onRetry={retry} onSelect={onSelect} />); await user.click(screen.getByRole('button', { name: 'تلاش دوباره' })); expect(retry).toHaveBeenCalledOnce();
    rerender(<VideoGenerationHistory items={[]} loading={false} error="" onRetry={retry} onSelect={onSelect} />); expect(screen.getByText(/هنوز ویدیویی/)).toBeInTheDocument();
    const items = [generation('processing', 'new'), generation('succeeded', 'old')]; rerender(<VideoGenerationHistory items={items} selectedId="new" loading={false} error="" onRetry={retry} onSelect={onSelect} />);
    const buttons = screen.getAllByRole('button'); expect(buttons[0]).toHaveAttribute('aria-pressed', 'true'); await user.click(buttons[1]); fireEvent.keyDown(buttons[0], { key: 'Enter' }); fireEvent.keyDown(buttons[0], { key: ' ' });
    expect(onSelect).toHaveBeenCalledWith('old'); expect(screen.getAllByText('یک جنگل مه آلود')).toHaveLength(2); expect(screen.queryByText(/provider_job_id|storage_key/i)).toBeNull();
  });

  it.each(['queued', 'submitting', 'submitted', 'processing', 'storing', 'succeeded', 'failed', 'cancelled', 'expired', 'unknown-value'])('renders the safe Persian status %s', (status) => {
    render(<VideoGenerationStatus status={status} live />);
    const node = document.querySelector('.video-status')!; expect(node).toHaveAttribute('aria-live', 'polite'); expect(node.textContent).toMatch(/[آ-ی]/);
    expect(Boolean(document.querySelector('.video-status__spinner'))).toBe(!['succeeded', 'failed', 'cancelled', 'expired'].includes(status));
  });
});
