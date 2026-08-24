import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { generation } from '../test/fixtures/video-generation';
import VideoGenerationProgressModal, { getVideoProgressPresentation } from './VideoGenerationProgressModal';

describe('VideoGenerationProgressModal', () => {
  it('maps live provider statuses to the visible generation phases', () => {
    expect(getVideoProgressPresentation('queued')).toMatchObject({ currentStep: 1, state: 'active' });
    expect(getVideoProgressPresentation('processing')).toMatchObject({ currentStep: 2, state: 'active' });
    expect(getVideoProgressPresentation('storing')).toMatchObject({ currentStep: 3, state: 'active' });
    expect(getVideoProgressPresentation('succeeded')).toMatchObject({ currentStep: 4, state: 'success' });
    expect(getVideoProgressPresentation('failed')).toMatchObject({ currentStep: 2, state: 'error' });
  });

  it('renders a dismissible success state with the complete stepper', () => {
    render(<VideoGenerationProgressModal generation={generation('succeeded')} onClose={vi.fn()} onView={vi.fn()} onBackToForm={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'ویدیو آماده است' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'مشاهده ویدیو' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'بستن وضعیت ساخت' })).toBeInTheDocument();
    expect(screen.getAllByText('ویدیو آماده است').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('مراحل واقعی ساخت ویدیو')).toBeInTheDocument();
  });
});
