import type { VideoGenerationDetail, VideoGenerationOption, VideoGenerationStatus } from '../../video-generation/video-generation.types';

export const videoModel: VideoGenerationOption = { internalKey: 'test-video', displayNameFa: 'مدل آزمایشی', descriptionFa: 'برای آزمون محلی', supportsTextToVideo: true, supportsImageToVideo: false, allowedAspectRatios: ['16:9', '9:16'], allowedDurations: ['5'], allowedQualities: ['standard', 'high'], maxPromptLength: 40, quotaUnits: 2 };
export const videoOptions = { models: [videoModel] };
export const noVideoOptions = { models: [] };
export const generation = (status: VideoGenerationStatus | string = 'queued', id = 'job-1'): VideoGenerationDetail => ({ id, mode: 'text-to-video', model_key: 'test-video', status, prompt: 'یک جنگل مه آلود', aspect_ratio: '16:9', duration: '5', quality: 'standard', created_at: '2026-07-20T10:00:00.000Z', updated_at: '2026-07-20T10:00:00.000Z', result: status === 'succeeded' ? { contentUrl: `/api/video-generations/${id}/content`, downloadUrl: `/api/video-generations/${id}/content?download=1`, mimeType: 'video/mp4', sizeBytes: 64 } : null });
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
