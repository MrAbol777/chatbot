import type { VideoGenerationError, VideoGenerationErrorCode } from './video-generation.types';

const messages: Partial<Record<VideoGenerationErrorCode, string>> = {
  VIDEO_GENERATION_DISABLED: 'ساخت ویدیو در حال حاضر فعال نیست.', VIDEO_MODEL_NOT_AVAILABLE: 'مدل انتخاب‌شده در دسترس نیست.', VIDEO_GENERATION_MODEL_UNAVAILABLE: 'مدل انتخاب‌شده در دسترس نیست.', VIDEO_SUBSCRIPTION_REQUIRED: 'برای ساخت ویدیو به اشتراک فعال نیاز دارید.', VIDEO_PLAN_NOT_ACTIVE: 'پلن شما فعال نیست.', VIDEO_QUOTA_NOT_CONFIGURED: 'سهمیه ساخت ویدیو برای پلن شما تنظیم نشده است.', VIDEO_QUOTA_EXCEEDED: 'سهمیه ساخت ویدیوی شما کافی نیست.', VIDEO_INVALID_SETTINGS: 'تنظیمات انتخاب‌شده معتبر نیست.', VIDEO_GENERATION_OPTIONS_NOT_ALLOWED: 'این تنظیمات برای مدل انتخاب‌شده قابل استفاده نیست.', VIDEO_GENERATION_IDEMPOTENCY_CONFLICT: 'این درخواست پیش‌تر با اطلاعات دیگری ثبت شده است.', VIDEO_PROVIDER_UNAVAILABLE: 'سرویس ساخت ویدیو موقتاً در دسترس نیست.', VIDEO_PROVIDER_SUBMIT_FAILED: 'ثبت درخواست ساخت ویدیو ناموفق بود.', VIDEO_GENERATION_FAILED: 'ساخت ویدیو ناموفق بود.', VIDEO_GENERATION_NOT_FOUND: 'این درخواست ویدیو پیدا نشد.', VIDEO_RESULT_NOT_READY: 'فایل ویدیو هنوز آماده نیست.', VIDEO_RESULT_FILE_MISSING: 'فایل ویدیو در دسترس نیست.', VIDEO_GENERATION_LOGIN_REQUIRED: 'برای ساخت ویدیو ابتدا وارد حساب کاربری شوید.', NETWORK_ERROR: 'اتصال به سرویس برقرار نشد. کمی بعد دوباره تلاش کنید.'
};

export function createVideoGenerationError(value?: string, status?: number): VideoGenerationError {
  const statusFallback: Partial<Record<number, VideoGenerationErrorCode>> = {
    400: 'VIDEO_INVALID_SETTINGS',
    401: 'VIDEO_GENERATION_LOGIN_REQUIRED',
    403: 'VIDEO_SUBSCRIPTION_REQUIRED',
    409: 'VIDEO_GENERATION_IDEMPOTENCY_CONFLICT',
    429: 'VIDEO_QUOTA_EXCEEDED',
    503: 'VIDEO_PROVIDER_UNAVAILABLE'
  };
  const code = (value && value in messages ? value : statusFallback[status || 0] || 'UNKNOWN_ERROR') as VideoGenerationErrorCode;
  return Object.assign(new Error(messages[code] || 'خطایی رخ داد. کمی بعد دوباره تلاش کنید.'), { code, status });
}
