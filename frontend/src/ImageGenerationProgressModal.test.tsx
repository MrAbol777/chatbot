import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GalleryImage } from './services/imageGeneration';
import ImageGenerationProgressModal, { getImageProgressPresentation } from './ImageGenerationProgressModal';

const item = (status: GalleryImage['status']): GalleryImage => ({
  id: 'image-job-1', taskId: 'image-job-1', originalPrompt: 'یک شهر خیالی', refinedPrompt: 'یک شهر خیالی', aspectRatio: '1:1', operation: 'generate', status,
  createdAt: '2026-08-24T10:00:00.000Z', updatedAt: '2026-08-24T10:00:00.000Z', source: 'image-generation', imageUrl: status === 'COMPLETED' ? '/api/images/result/image-job-1' : null
});

describe('ImageGenerationProgressModal', () => {
  it('maps image task states to the visible steps', () => {
    expect(getImageProgressPresentation('QUEUE')).toMatchObject({ title: 'دارم ایده‌ات رو آماده می‌کنم...', currentStep: 1 });
    expect(getImageProgressPresentation('RUNNING')).toMatchObject({ currentStep: 2, state: 'active' });
    expect(getImageProgressPresentation('COMPLETED')).toMatchObject({ currentStep: 3, state: 'success' });
    expect(getImageProgressPresentation('ERROR')).toMatchObject({ currentStep: 2, state: 'error' });
  });

  it('renders the requested pending copy and stepper', () => {
    render(<ImageGenerationProgressModal item={item('QUEUE')} onClose={vi.fn()} onView={vi.fn()} onRetry={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'دارم ایده‌ات رو آماده می‌کنم...' })).toBeInTheDocument();
    expect(screen.getByText('دارم ایده‌ات رو آماده می‌کنم...')).toBeInTheDocument();
    expect(screen.getByLabelText('مراحل واقعی ساخت تصویر')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'بستن وضعیت ساخت' })).toBeInTheDocument();
  });
});
