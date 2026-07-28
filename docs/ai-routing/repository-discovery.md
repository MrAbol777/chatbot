# AI Routing Repository Discovery

تاریخ بررسی: 2026-07-23

## وضعیت فعلی

- Backend از Node.js/CommonJS، Express و MariaDB استفاده می‌کند. Migration ویدیو با runner محافظت‌شده `backend/scripts/apply-video-generation-migration.js` اجرا می‌شود.
- API ویدیو زیر دو alias یعنی `/api/video-generations` و `/api/video-generation` قرار دارد. Submit در `video-generation.service.js` به‌صورت synchronous مستقیماً Adapter فعلی Metis را صدا می‌زند.
- Worker از lease دیتابیس استفاده می‌کند و Jobهای `submitted`، `processing` و `storing` را poll می‌کند. Provider بر اساس snapshot فعلی `app_video_generations.provider` انتخاب می‌شود.
- Quota شامل entitlement، reservation، finalize و release اتمیک است. Reservation برای هر generation یکتا است.
- نتیجه Provider با DNS pinning، جلوگیری از SSRF، محدودیت redirect/timeout/size، MIME و magic-byte validation دریافت و به‌صورت atomic در Storage خصوصی ذخیره می‌شود.
- Content API فقط فایل داخلی را با ownership check و range support تحویل می‌دهد و Provider URL/Storage Key را افشا نمی‌کند.
- پنل Admin ماژولارشدن تدریجی دارد، اما `AdminPanel.tsx` هنوز بزرگ است. بخش AI routing باید به feature component مستقل اضافه شود.
- Upload عمومی تصویر فعلی ownership دیتابیسی ندارد و برای I2V امن نیست.

## اجزای قابل استفاده مجدد

- `app_video_models`, `app_video_generations`, `app_video_usage`, `app_video_quota_reservations`
- Video state machine، repository و lease/transactionهای Worker
- Metis adapter و Fake provider
- Quota service و transactional settlement
- Result URL validator، file validator، result orchestrator و local storage
- Admin cookie/JWT authorization و audit عمومی
- Frontend Video page، polling، history و Design System موجود

## Refactorهای لازم

- Submit باید از API به Worker منتقل شود تا lock، restart safety و ambiguous outcome قابل کنترل باشد.
- Provider object مستقیم با Registry مرکزی جایگزین شود.
- Route/Attempt/Snapshot/Health/Cost مفاهیم جدید هستند و ساختار موجود مناسبی برای آنها ندارد.
- `app_video_models` توسعه می‌یابد و جدول model موازی ساخته نمی‌شود.
- ورودی I2V به جدول و Storage خصوصی مالک‌محور نیاز دارد؛ Upload عمومی فعلی تغییر داده یا برای Image module بازنویسی نمی‌شود.
- Admin AI routing در module/component مستقل ساخته می‌شود تا monolith فعلی رشد نکند.

## جدول‌های موجود و جدید

جدول‌های موجود: `app_video_models`, `app_video_generations`, `app_video_usage`, `app_video_quota_reservations`, `app_settings`.

جدول‌های واقعاً لازم: `app_ai_providers`, `app_ai_capability_routes`, `app_ai_route_audit_logs`, `app_ai_provider_attempts`, `app_ai_provider_health`, `app_video_input_media`.

## قراردادهای سازگار

- `GET /api/video-generation/options`
- `POST /api/video-generations` با `Idempotency-Key`
- `GET /api/video-generations`
- `GET /api/video-generations/:id`
- Content و content-auth فعلی
- مدل Metis با کلید `metis_kling_v25_turbo_pro` و payload فعلی آن
- Nano Banana و تمام routeهای Image بدون تغییر

## ریسک‌های Regression

- تغییر synchronous submit به queued submit
- Jobهای قدیمی فاقد route snapshot/attempt
- double reservation/finalize/release در raceهای Worker
- fallback پس از پذیرش مبهم Provider
- بازنویسی seedهای Admin هنگام rerun migration
- افشای HMAC token، Provider task ID، Authorization یا Result URL در log/API
- استفاده ناخواسته از Upload عمومی بدون ownership
- claim شدن queue واقعی در تست یا اتصال خارجی تصادفی

Baseline: 163 تست Backend Video، 48 تست Frontend Video و Frontend build در 2026-07-23 پاس شدند. درخواست خارجی Provider انجام نشد.
