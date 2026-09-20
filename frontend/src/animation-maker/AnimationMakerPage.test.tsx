import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../design-system/components';
import AnimationMakerPage from './AnimationMakerPage';

vi.mock('./animationMaker.api', () => ({
  listAnimationProjects: vi.fn().mockResolvedValue([]),
  createAnimationProject: vi.fn().mockImplementation(async (project) => ({
    ...project,
    id: 'animation-test',
    createdAt: '2026-09-19T00:00:00.000Z',
    updatedAt: '2026-09-19T00:00:00.000Z'
  })),
  getAnimationProject: vi.fn(),
  updateAnimationProject: vi.fn().mockImplementation(async (id, project) => ({
    ...project,
    id,
    createdAt: '2026-09-19T00:00:00.000Z',
    updatedAt: '2026-09-19T00:00:00.000Z'
  })),
  uploadAnimationReference: vi.fn()
}));

describe('AnimationMakerPage', () => {
  it('accepts a short idea and advances to one question at a time', async () => {
    const user = userEvent.setup();
    render(<ToastProvider><AnimationMakerPage onBack={vi.fn()} onOpenCharacterMaker={vi.fn()} /></ToastProvider>);
    await user.click(screen.getByRole('button', { name: 'شروع ساخت فیلم' }));
    await user.type(screen.getByLabelText('ایدهٔ فیلم'), 'یک گربه به دوستش کمک می‌کند.');
    await user.click(screen.getByRole('button', { name: 'ادامه' }));
    expect(await screen.findByRole('heading', { name: 'فیلمت چقدر طول بکشد؟' })).toBeInTheDocument();
    expect(screen.queryByText('فیلمت چه شکلی باشد؟')).not.toBeInTheDocument();
  });

  it('allows user to select and enter custom duration in seconds', async () => {
    const user = userEvent.setup();
    render(<ToastProvider><AnimationMakerPage onBack={vi.fn()} onOpenCharacterMaker={vi.fn()} /></ToastProvider>);
    await user.click(screen.getByRole('button', { name: 'شروع ساخت فیلم' }));
    await user.type(screen.getByLabelText('ایدهٔ فیلم'), 'ماجرای کارآگاه برفی');
    await user.click(screen.getByRole('button', { name: 'ادامه' }));
    expect(await screen.findByRole('heading', { name: 'فیلمت چقدر طول بکشد؟' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /مدت دلخواه/ }));
    const customInput = screen.getByLabelText(/مدت فیلم به ثانیه/);
    expect(customInput).toBeInTheDocument();

    await user.clear(customInput);
    await user.type(customInput, '45');
    await user.click(screen.getByRole('button', { name: 'ادامه' }));

    expect(await screen.findByRole('heading', { name: 'فیلمت چه شکلی باشد؟' })).toBeInTheDocument();
  });
});
