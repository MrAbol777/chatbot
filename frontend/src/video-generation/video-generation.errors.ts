import type { VideoGenerationError, VideoGenerationErrorCode } from './video-generation.types';

const messages: Partial<Record<VideoGenerationErrorCode, string>> = {
  VIDEO_GENERATION_DISABLED: 'ساخت ویدیو در حال حاضر فعال نیست.', VIDEO_MODEL_NOT_AVAILABLE: 'مدل انتخاب‌شده در دسترس نیست.', VIDEO_GENERATION_MODEL_UNAVAILABLE: 'مدل انتخاب‌شده در دسترس نیست.', NOA_INSUFFICIENT_FUNDS: 'موجودی نوآ برای ساخت این ویدیو کافی نیست. ابتدا کیف پول را شارژ کنید.', NOA_INSUFFICIENT_BALANCE: 'موجودی نوآ برای ساخت این ویدیو کافی نیست. ابتدا کیف پول را شارژ کنید.', NOA_PRICING_UNAVAILABLE: 'قیمت ساخت ویدیو فعلاً در دسترس نیست.', VIDEO_INVALID_SETTINGS: 'تنظیمات انتخاب‌شده معتبر نیست.', VIDEO_GENERATION_OPTIONS_NOT_ALLOWED: 'این تنظیمات برای مدل انتخاب‌شده قابل استفاده نیست.', VIDEO_GENERATION_IDEMPOTENCY_CONFLICT: 'این درخواست پیش‌تر با اطلاعات دیگری ثبت شده است.', VIDEO_PROVIDER_UNAVAILABLE: 'سرویس ساخت ویدیو موقتاً در دسترس نیست.', VIDEO_PROVIDER_SUBMIT_FAILED: 'ثبت درخواست ساخت ویدیو ناموفق بود.', VIDEO_PROVIDER_INVALID_REQUEST: 'درخواست ارسالی برای سرویس ساخت ویدیو معتبر نیست.', VIDEO_PROVIDER_INSUFFICIENT_CREDITS: 'اعتبار سرویس بالادستی برای ساخت ویدیو کافی نیست.', VIDEO_PROVIDER_RATE_LIMITED: 'سرویس ساخت ویدیو موقتاً با محدودیت درخواست مواجه است.', VIDEO_PROVIDER_AUTH_FAILED: 'دسترسی سرویس ساخت ویدیو به Provider معتبر نیست.', VIDEO_GENERATION_COMPILED_PROMPT_TOO_LONG: 'متن نهایی درخواست از سقف مدل ویدیو بیشتر است.', VIDEO_GENERATION_FAILED: 'ساخت ویدیو ناموفق بود. تنظیمات را بررسی کنید و دوباره تلاش کنید.', VIDEO_GENERATION_NOT_FOUND: 'این درخواست ویدیو پیدا نشد. به فهرست ویدیوها برگردید و دوباره امتحان کنید.', VIDEO_RESULT_NOT_READY: 'فایل ویدیو هنوز آماده نیست. چند لحظه دیگر دوباره بررسی کنید.', VIDEO_RESULT_FILE_MISSING: 'فایل ویدیو در دسترس نیست. درخواست را دوباره بسازید.', VIDEO_GENERATION_LOGIN_REQUIRED: 'برای ساخت ویدیو ابتدا وارد حساب کاربری شوید.', NETWORK_ERROR: 'اتصال به سرویس برقرار نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.'
};

type BillingDetails = Pick<VideoGenerationError, 'actionKey' | 'balanceNoa' | 'requiredNoa' | 'shortfallNoa'>;

export function createVideoGenerationError(value?: string, status?: number, details: BillingDetails = {}): VideoGenerationError {
  const statusFallback: Partial<Record<number, VideoGenerationErrorCode>> = {
    400: 'VIDEO_INVALID_SETTINGS',
    401: 'VIDEO_GENERATION_LOGIN_REQUIRED',
    402: 'NOA_INSUFFICIENT_FUNDS',
    403: 'VIDEO_GENERATION_LOGIN_REQUIRED',
    409: 'VIDEO_GENERATION_IDEMPOTENCY_CONFLICT',
    429: 'VIDEO_PROVIDER_RATE_LIMITED',
    503: 'VIDEO_PROVIDER_UNAVAILABLE'
  };
  const code = (value && value in messages ? value : statusFallback[status || 0] || 'UNKNOWN_ERROR') as VideoGenerationErrorCode;
  return Object.assign(new Error(messages[code] || 'مشکلی در آماده‌سازی استودیو پیش آمد. دوباره تلاش کنید؛ اگر ادامه داشت، کمی بعد برگردید.'), { code, status, ...details });
}
