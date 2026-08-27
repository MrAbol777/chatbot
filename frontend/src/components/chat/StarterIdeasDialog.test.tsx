import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import StarterIdeasDialog, { STARTER_IDEAS } from './StarterIdeasDialog';

describe('StarterIdeasDialog', () => {
  it('shows a large categorized idea library', () => {
    render(<StarterIdeasDialog open onClose={vi.fn()} onSelectIdea={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'ایده‌ای برای شروع پیدا کن' })).toBeInTheDocument();
    expect(STARTER_IDEAS).toHaveLength(25);
    expect(screen.getByRole('button', { name: /برنامهٔ یادگیری شخصی/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /چالش خلاقانهٔ امروز/ })).toBeInTheDocument();
  });

  it('filters ideas by category and search query', async () => {
    const user = userEvent.setup();
    render(<StarterIdeasDialog open onClose={vi.fn()} onSelectIdea={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /خلاقیت و سرگرمی/ }));
    expect(screen.getByRole('button', { name: /جرقهٔ یک داستان/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /برنامهٔ یادگیری شخصی/ })).not.toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'جست‌وجوی ایده‌ها' }), 'آینده');
    expect(screen.getByRole('button', { name: /محصولی از آینده/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /جرقهٔ یک داستان/ })).not.toBeInTheDocument();
  });

  it('returns the selected prompt and closes', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSelectIdea = vi.fn();
    render(<StarterIdeasDialog open onClose={onClose} onSelectIdea={onSelectIdea} />);

    await user.click(screen.getByRole('button', { name: /ماتریس تصمیم‌گیری/ }));

    expect(onSelectIdea).toHaveBeenCalledWith(expect.stringContaining('ماتریس تصمیم‌گیری'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
