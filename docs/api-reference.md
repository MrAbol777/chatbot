# مرجع API

> وضعیت: ✅ catalog بر اساس routeهای backend — بازبینی: ۲۰۲۶-۰۸-۱۵

## قرارداد عمومی

- Base URL در توسعه معمولاً `http://localhost:<PORT>` و در تولید origin عمومی برنامه است.
- پاسخ‌های JSON در خطا معمولاً فیلد `error` و گاهی `message`، `details` یا `retryable` دارند.
- درخواست‌های حفاظت‌شده با session cookie یا `Authorization: Bearer <token>` احراز می‌شوند.
- برای درخواست‌های state-changing از origin مجاز، cookie و CSRF protection استفاده می‌شود.
- stream چت با `Accept: application/x-ndjson` فعال می‌شود و هر خط یک JSON مستقل است.
- فایل‌ها با `multipart/form-data` ارسال می‌شوند.

## سلامت و تنظیمات عمومی

| Method | مسیر | Auth | توضیح |
|---|---|---|---|
| GET | `/healthz` | عمومی | probe سبک برای load balancer |
| GET | `/health` | عمومی | alias probe |
| GET | `/api/health` | عمومی | سلامت backend و DB |
| GET | `/api/health/upstream` | عمومی | بررسی upstream مدل |
| GET | `/api/health/video-generation` | عمومی | وضعیت قابلیت و worker ویدیو |
| GET | `/api/settings/public` | عمومی | تنظیمات public قابل نمایش در frontend |

## احراز هویت کاربر

| Method | مسیر | توضیح |
|---|---|---|
| POST | `/api/auth/phone-status` | تشخیص وجود کاربر و mode پیشنهادی login/signup |
| POST | `/api/send-verification-code` | ارسال OTP؛ محدودیت و `Retry-After` دارد |
| POST | `/api/verify-code` | اعتبارسنجی OTP؛ کاربر قدیمی token می‌گیرد و کاربر جدید signup token |
| POST | `/api/register-profile` | تکمیل profile کاربر جدید با signup token |
| GET | `/api/auth/session` | خواندن وضعیت session فعلی |
| POST | `/api/auth/logout` | ابطال session و پاک‌کردن cookie |
| GET | `/api/auth/viana/config` | اعلام فعال بودن Sign in with Viana |
| GET | `/api/auth/viana/start` | شروع Authorization Code + PKCE |
| GET | `/api/auth/viana/callback` | callback، اعتبارسنجی state/nonce و ساخت session |

### نمونه body فلو OTP

```json
{
  "phone": "09120000000",
  "mode": "login"
}
```

برای verify:

```json
{
  "phone": "09120000000",
  "code": "12345",
  "mode": "login"
}
```

پشتیبانی از ارقام فارسی و عربی در phone، code و age در validator احراز هویت انجام می‌شود. OTP بعد از مصرف موفق یا انقضا حذف می‌شود.

## چت و گفتگو

| Method | مسیر | توضیح |
|---|---|---|
| POST | `/api/chat` | چت معمولی، تشخیص intent، vision-chat و image routing |
| POST | `/api/conversations` | ایجاد گفتگو |
| POST | `/api/conversations/load` | بارگذاری گفتگوهای کاربر |
| POST | `/api/conversations/sync` | همگام‌سازی گفتگوهای frontend و backend |
| PATCH | `/api/conversations/:conversationId/title` | تغییر دستی عنوان |

نمونه payload حداقلی چت:

```json
{
  "message": "یک مسئله ریاضی را توضیح بده",
  "conversationId": "conversation-id",
  "history": [],
  "profile": { "name": "کاربر", "age": 12 },
  "clientMessageId": "client-message-id",
  "turnId": "turn-id",
  "attemptId": "attempt-id"
}
```

در حالت stream، رویدادهای مهم شامل `start`، `delta`، `done`، `error` و `cancelled` هستند. `turnId` و `attemptId` برای idempotency، lock و recovery استفاده می‌شوند.

## Upload و تصویر

| Method | مسیر | توضیح |
|---|---|---|
| POST | `/api/uploads/images` | upload تصویر ورودی با multipart field به نام `images` |
| GET | `/api/uploads/images/:imageId` | دریافت تصویر upload‌شده |
| POST | `/api/images/generate` | تولید تصویر asynchronous |
| POST | `/api/images/edit` | ویرایش تصویر موجود |
| GET | `/api/images` | فهرست تصاویر کاربر با cursor/limit |
| GET | `/api/images/status/:taskId` | وضعیت task تولید |
| GET | `/api/images/:taskId/details` | جزئیات task |
| GET | `/api/images/result/:taskId` | دریافت نتیجه |
| GET | `/api/images/serve/:taskId` | serve نتیجه با بررسی مالکیت |
| DELETE | `/api/images/:taskId` | حذف منطقی/کاربری task |
| POST | `/api/vision/analyze` | تحلیل مستقیم تصویر با multipart field `images` |
| POST | `/api/vision/analyze-dry-run` | بررسی pipeline بدون فراخوانی واقعی provider |

تصاویر مجاز upload در کد فعلی jpg، jpeg، png و webp هستند. سقف حجم و تعداد از settings خوانده می‌شود؛ مقدار واقعی را از `/api/settings/public` یا تنظیمات admin بررسی کنید.

## تولید ویدیو

| Method | مسیر | توضیح |
|---|---|---|
| GET | `/api/video-generation/options` | گزینه‌های عمومی قابل عرضه |
| POST | `/api/video-generations/input-media` | دریافت رسانه ورودی برای job |
| POST | `/api/video-generations` | ایجاد job با `Idempotency-Key` |
| GET | `/api/video-generations` | فهرست jobهای کاربر |
| GET | `/api/video-generations/:generationId` | جزئیات و status |
| GET | `/api/video-generations/:generationId/content-auth` | آماده‌سازی دسترسی محتوای خروجی |
| GET | `/api/video-generations/:generationId/content` | پخش/دانلود خروجی، با مالکیت یا دسترسی admin |
| GET | `/api/video-provider-input/:token` | دریافت موقت input امضاشده برای provider |

مسیر alias `/api/video-generation` نیز برای برخی endpointهای عمومی وجود دارد. providerها، مدل‌ها، quota و وضعیت job را از admin یا health بررسی کنید؛ provider URL نباید به frontend نشت کند.

## کیف پول نوآ

| Method | مسیر | توضیح |
|---|---|---|
| GET | `/api/noa/config` | نرخ تبدیل و تنظیمات public |
| GET | `/api/noa/wallet` | کیف پول کاربر |
| GET | `/api/noa/balance` | موجودی خلاصه |
| GET | `/api/noa/transactions` | تراکنش‌ها |
| GET | `/api/noa/notifications/pending` | اعلان‌های مالی pending |
| POST | `/api/noa/receipts` | ثبت رسید واریز |
| GET | `/api/noa/receipts` | رسیدهای کاربر |
| GET | `/api/noa/receipts/:receiptId` | جزئیات رسید |
| GET | `/api/noa/receipts/:receiptId/image` | تصویر رسید |

Billing برای عملیات مصرفی از الگوی `reserve → capture/release` استفاده می‌کند. در retry کلاینت، `Idempotency-Key` را ثابت نگه دارید.

## API ادمین

تمام مسیرهای زیر با session ادمین محافظت می‌شوند؛ برخی عملیات role اختصاصی دارند.

### ورود و پایش

| Method | مسیر |
|---|---|
| POST | `/api/admin/login` |
| POST | `/api/admin/logout` |
| GET | `/api/admin/me` |
| GET | `/api/admin/stats` |
| GET | `/api/admin/dashboard/stats` |
| GET | `/api/admin/errors` |
| GET | `/api/admin/audit-logs` |
| GET | `/api/admin/reports/csv` |
| GET | `/api/admin/reports/export` |

### کاربران و moderation

| Method | مسیر |
|---|---|
| GET | `/api/admin/users` |
| GET | `/api/admin/users/:id` |
| PATCH | `/api/admin/users/:id/ban` |
| DELETE | `/api/admin/users/:id` |
| GET | `/api/admin/users/:id/images/:taskId` |
| GET | `/api/admin/moderation/flagged` |
| GET/PUT/DELETE | `/api/admin/supervised-otp` |
| POST | `/api/admin/supervised-otp/reset-used-count` |

### تنظیمات AI و سیستم

| Method | مسیر |
|---|---|
| GET/PUT | `/api/admin/settings` |
| GET/PUT | `/api/admin/config` |
| GET/PUT | `/api/admin/config/system-prompt` |
| GET | `/api/admin/config/system-prompt/history` |
| POST | `/api/admin/config/system-prompt/rollback` |
| GET/PUT | `/api/admin/image-settings` |
| GET/PUT | `/api/admin/image-prompt-refiner-settings` |
| GET/PUT | `/api/admin/vision-settings` |
| GET | `/api/admin/ai-runtime-status` |
| GET/PUT | `/api/admin/intent-router-settings` |
| GET/PATCH | `/api/admin/ai-routing/providers` |
| GET/PATCH | `/api/admin/ai-routing/models` |
| GET/PATCH | `/api/admin/ai-routing/routes` |
| GET | `/api/admin/ai-routing/health` |

### ویدیو و نوآ در ادمین

| Method | مسیر |
|---|---|
| GET | `/api/admin/video-generations` |
| GET | `/api/admin/video-generations/:generationId` |
| GET | `/api/admin/video-generations/:generationId/input` |
| GET/PATCH | `/api/admin/video-prompt-profiles/...` |
| GET/PUT/PATCH | `/api/admin/noa/config` و `/pricing` |
| GET/PUT/PATCH | `/api/admin/noa/bank-account` |
| GET | `/api/admin/noa/users/:userId/wallet` |
| POST | `/api/admin/noa/wallet-adjustments` |
| GET/PATCH/POST | `/api/admin/noa/receipts/...` |

## خطا و observability

- هر request یک `requestId` در log دارد.
- خطاهای داخلی در `app_app_errors` و auditهای مدیریتی در audit log ثبت می‌شوند.
- در production، پاسخ خطا نباید secret، stack یا provider token را به client بدهد.
- برای تشخیص خطا، زمان، مسیر، request id، status و رخداد مربوط را کنار هم ثبت کنید.

