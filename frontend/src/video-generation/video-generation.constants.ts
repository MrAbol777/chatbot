import type { VideoGenerationStatus } from './video-generation.types';

export const TERMINAL_VIDEO_STATUSES = new Set<VideoGenerationStatus>(['succeeded', 'failed', 'cancelled', 'expired']);
export const POLL_DELAYS_MS = [1_500, 2_500, 4_000, 6_000, 8_000] as const;
export const ACTIVE_GENERATION_HINT_KEY = 'danoa:video-generation:active-id';
export const statusLabel: Record<VideoGenerationStatus, string> = {
  queued: 'در صف ساخت', routing: 'در حال انتخاب مسیر امن', submitting: 'در حال ارسال درخواست', submitted: 'درخواست ثبت شد', processing: 'در حال ساخت ویدیو', storing: 'در حال آماده‌سازی فایل نهایی', provider_status_unknown: 'نیازمند بررسی مدیر', succeeded: 'ویدیو آماده است', failed: 'ساخت ویدیو ناموفق بود', cancelled: 'ساخت ویدیو لغو شد', expired: 'زمان پردازش به پایان رسید', unknown: 'وضعیت ساخت در حال بررسی است'
};
