import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generation } from '../test/fixtures/video-generation';
import { videoGenerationService } from './video-generation.service';
import VideoGenerationPlayer from './VideoGenerationPlayer';

describe('VideoGenerationPlayer and download', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  it('only renders native player controls for succeeded results with an internal URL', async () => {
    vi.spyOn(videoGenerationService, 'prepareVideoContent').mockResolvedValue({ contentUrl: '/api/video-generations/job-1/content', downloadUrl: '/api/video-generations/job-1/content?download=1' });
    const { rerender, container } = render(<VideoGenerationPlayer generation={generation('processing')} />); expect(screen.queryByRole('button', { name: 'دانلود ویدیو' })).toBeNull();
    rerender(<VideoGenerationPlayer generation={generation('succeeded')} />); await screen.findByText('ویدیو آماده است'); const media = container.querySelector('video'); expect(media).toHaveAttribute('controls'); expect(media).toHaveAttribute('preload', 'metadata'); expect(media).toHaveAttribute('src', '/api/video-generations/job-1/content'); expect(media?.outerHTML).not.toMatch(/provider|storage|api.?key/i);
  });
  it('uses a preparation call before download and renders a safe media failure', async () => {
    vi.spyOn(videoGenerationService, 'prepareVideoContent').mockResolvedValue({ contentUrl: '/api/video-generations/job-1/content', downloadUrl: '/api/video-generations/job-1/content?download=1' });
    const { container } = render(<VideoGenerationPlayer generation={generation('succeeded')} />); await screen.findByText('ویدیو آماده است'); const media = container.querySelector('video')!; fireEvent.error(media); expect(screen.getByText(/پخش ویدیو با خطا/)).toBeInTheDocument();
  });
  it('handles content-auth/result failures without using a provider URL', async () => {
    vi.spyOn(videoGenerationService, 'prepareVideoContent').mockRejectedValue(new Error('فایل ویدیو در دسترس نیست.'));
    render(<VideoGenerationPlayer generation={generation('succeeded')} />); expect(await screen.findByText('فایل ویدیو در دسترس نیست.')).toBeInTheDocument(); expect(document.querySelector('video')).toBeNull();
  });
  it('prepares the internal download once and disables a second click while it is loading', async () => {
    const prepare = vi.spyOn(videoGenerationService, 'prepareVideoContent').mockResolvedValueOnce({ contentUrl: '/api/video-generations/job-1/content', downloadUrl: '/api/video-generations/job-1/content?download=1' }).mockImplementationOnce(() => new Promise(() => {}));
    render(<VideoGenerationPlayer generation={generation('succeeded')} />); await screen.findByText('ویدیو آماده است'); const button = screen.getByRole('button', { name: 'دانلود ویدیو' }); fireEvent.click(button); expect(button).toBeDisabled(); fireEvent.click(button); expect(prepare).toHaveBeenCalledTimes(2); expect(videoGenerationService.getVideoDownloadUrl('job-1')).toBe('/api/video-generations/job-1/content?download=1');
  });
});
