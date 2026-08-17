# تنظیمات و متغیرهای محیطی

> وضعیت: ✅ مرجع تنظیمات — بازبینی: ۲۰۲۶-۰۸-۱۵

منبع نمونه تنظیمات `backend/.env.example` و برای Docker، `deploy/env.production.example` است. مقدارهای secret در این سند عمداً placeholder هستند.

## اصول

- backend تنها محل نگهداری API key و secret است.
- `.env` واقعی نباید commit یا داخل image عمومی قرار گیرد.
- در production برای هر secret مقدار تصادفی جداگانه بسازید.
- بعد از تغییر env در Docker، container را recreate کنید.
- مقدارهای URL باید origin/path مورد انتظار کد را رعایت کنند.

## هسته برنامه و دیتابیس

| متغیر | کاربرد |
|---|---|
| `NODE_ENV` | `development` یا `production` |
| `PORT` | پورت Express |
| `BACKEND_URL` | URL backend در deployment |
| `DATABASE_URL` | اتصال `mysql://user:password@host:3306/database` |
| `APP_ALLOWED_ORIGINS` | originهای دقیق مجاز، جداشده با comma |
| `ADMIN_PANEL_PATH` | مسیر غیرقابل حدس پنل |
| `ADMIN_COOKIE_NAME` | نام cookie نشست ادمین |

## احراز هویت و session

| متغیر | کاربرد |
|---|---|
| `AUTH_JWT_SECRET` | امضای token کاربر و signup token |
| `ADMIN_JWT_SECRET` | امضای session/token ادمین |
| `ADMIN_API_KEY` | مسیرهای legacy یا bootstrap ادمین؛ با secret مستقل نگهداری شود |
| `OTP_EXPIRE` | عمر OTP بر حسب ثانیه |
| `IPPANEL_API_KEY` | کلید ارسال SMS |
| `IPPANEL_PATTERN_CODE` | pattern ارسال OTP |
| `IPPANEL_SENDER` | شماره فرستنده |
| `LOCAL_DEV_SESSION_ENABLED` | local-only؛ در سرور عمومی `false` |
| `DANOA_SESSION_IDLE_TIMEOUT_SECONDS` | timeout بیکاری session |
| `DANOA_SESSION_ABSOLUTE_TIMEOUT_SECONDS` | حداکثر عمر session |
| `DANOA_SESSION_TTL_SECONDS` | alias قدیمی برای absolute timeout |

### Viana OAuth

| متغیر | کاربرد |
|---|---|
| `VIANA_OAUTH_ENABLED` | فعال/غیرفعال کردن ورود Viana |
| `VIANA_ENVIRONMENT` | کلید محیط پایدار برای flow |
| `VIANA_DISCOVERY_URL` | discovery endpoint |
| `VIANA_FRONTEND_URL` | دامنه رابط ویانا |
| `VIANA_API_BASE_URL` | API base provider |
| `VIANA_AUTHORIZATION_URL` | endpoint شروع Authorization Code |
| `VIANA_TOKEN_URL` | endpoint تبادل code با token |
| `VIANA_STUDENT_PROFILE_URL` | endpoint `students/me` |
| `VIANA_CLIENT_ID` / `VIANA_CLIENT_SECRET` | credentials OAuth |
| `VIANA_SCOPES` | scopeهای OAuth؛ باید شامل `students.sensitive:read` باشد |
| `VIANA_REDIRECT_URI` | callback دقیق ثبت‌شده در provider |
| `VIANA_POST_LOGIN_PATH` | مسیر local بعد از callback |
| `VIANA_HTTP_TIMEOUT_MS` | timeout درخواست‌های provider |

در production همه URLهای Viana باید HTTPS باشند. flow از state، browser binding، PKCE و nonce یک‌بارمصرف استفاده می‌کند.

## مدل‌ها و providerهای AI

| متغیر | کاربرد |
|---|---|
| `METIS_API_KEY` | کلید اصلی backend AI |
| `METIS_CHAT_API_KEY` | کلید اختصاصی chat در صورت استفاده |
| `METIS_VISION_API_KEY` | کلید vision |
| `METIS_INTENT_ROUTER_API_KEY` | کلید intent router |
| `METIS_INPUT_OPTIMIZER_API_KEY` | کلید بهینه‌سازی ورودی |
| `METIS_CONVERSATION_TITLE_API_KEY` | کلید تولید عنوان |
| `METIS_CONVERSATION_MEMORY_API_KEY` | کلید حافظه گفتگو |
| `METIS_OPENAI_BASE_URL` | endpoint سازگار با OpenAI |
| `OPENAI_MODEL` | مدل پیش‌فرض chat |
| `GEMINI_API_KEY` | کلید Gemini |
| `GEMINI_API_BASE_URL` | base URL رسمی Gemini |
| `GEMINI_IMAGE_MODEL` | مدل image |
| `CONVERSATION_TITLE_ENABLED` | فعال‌سازی title generation |
| `CONVERSATION_TITLE_MODEL` | مدل عنوان |
| `CONVERSATION_TITLE_TIMEOUT_MS` | timeout عنوان |
| `INPUT_OPTIMIZER_ENABLED` | فعال‌سازی input optimizer |
| `INPUT_OPTIMIZER_MODEL` | مدل optimizer |
| `INPUT_OPTIMIZER_TIMEOUT_MS` | timeout optimizer |

جزئیات runtime image، vision و routing از `app_settings` و پنل ادمین نیز قابل کنترل است؛ env و DB setting باید با هم سازگار باشند.

## تصویر و فایل

| متغیر | کاربرد |
|---|---|
| `IMAGE_STORAGE_DIR` | محل ذخیره محلی نتیجه تصویر |
| `IMAGE_PUBLIC_BASE_URL` | base URL عمومی در صورت نیاز |
| `IMAGE_MAX_DOWNLOAD_MB` | سقف دریافت تصویر خارجی |
| `CONVERSATION_MEMORY_STORAGE_DIR` | فایل حافظه گفتگو |
| `VIDEO_INPUT_STORAGE_ROOT` | storage رسانه ورودی ویدیو |
| `VIDEO_STORAGE_ROOT` | storage خروجی ویدیو |
| `VIDEO_STORAGE_TEMP_ROOT` | storage موقت دانلود/commit |

## ویدیو و worker

برای فعال‌سازی production، مقادیر را فقط طبق [راهنمای استقرار ویدیو](./danoa-vps-video-deployment.md) تنظیم کنید.

| متغیر | کاربرد |
|---|---|
| `VIDEO_GENERATION_ENABLED` | feature flag اصلی |
| `VIDEO_GENERATION_ACTIVATION_EXPECTED` | guardrail فعال‌سازی |
| `AI_VIDEO_ROUTING_ENABLED` | routing دیتابیسی provider/model |
| `BANANAAI_API_KEY` / `BANANAAI_BASE_URL` | اتصال BananaAI |
| `VIDEO_GENERATION_WORKER_MODE` | embedded یا disabled |
| `VIDEO_GENERATION_WORKER_ENABLED` | فعال‌سازی worker |
| `VIDEO_GENERATION_WORKER_INTERVAL_MS` | فاصله poll |
| `VIDEO_GENERATION_WORKER_BATCH_SIZE` | تعداد job هر نوبت |
| `VIDEO_GENERATION_WORKER_LEASE_MS` | زمان lease |
| `VIDEO_JOB_TIMEOUT_MINUTES` | timeout کل job |
| `VIDEO_POLL_BASE_DELAY_MS` / `VIDEO_POLL_MAX_DELAY_MS` | backoff poll |
| `VIDEO_RESULT_MAX_BYTES` | سقف فایل خروجی |
| `VIDEO_RESULT_ALLOWED_HOSTS` | allowlist host نتیجه |
| `VIDEO_RESULT_ALLOWED_PATH_PREFIXES` | allowlist path نتیجه |
| `VIDEO_RESULT_MAX_REDIRECTS` | تعداد redirect مجاز |
| `VIDEO_PROVIDER_INPUT_MODE` | gateway یا fallback توسعه |
| `VIDEO_PROVIDER_INPUT_PUBLIC_BASE_URL` | URL عمومی gateway |
| `VIDEO_PROVIDER_INPUT_SIGNING_SECRET` | امضای URL موقت |
| `VIDEO_PROVIDER_INPUT_TTL_SECONDS` | عمر URL ورودی |
| `VIDEO_INPUT_MAX_BYTES` | سقف ورودی |
| `VIDEO_INPUT_RETENTION_MINUTES` | retention رسانه ورودی |

## پایش Bale و پرداخت

- `BALE_BOT_TOKEN`، `BALE_WEBHOOK_PUBLIC_URL` و `BALE_WEBHOOK_PATH` برای monitor/integration Bale.
- `ZARINPAL_MERCHANT_ID`، `ZARINPAL_SANDBOX`، `ZARINPAL_CALLBACK_URL` و `FRONTEND_PAYMENT_RESULT_URL` برای پرداخت در صورت فعال بودن مسیر پرداخت.

## ماتریس حداقل تنظیمات

| محیط | حداقل لازم |
|---|---|
| توسعه بدون provider واقعی | `PORT`، `DATABASE_URL`، `AUTH_JWT_SECRET`، `ADMIN_JWT_SECRET` |
| توسعه چت | موارد بالا + `METIS_API_KEY` و base URL |
| توسعه SMS واقعی | موارد بالا + سه متغیر IPPanel |
| production پایه | `NODE_ENV`، DB credentials، secretهای جداگانه، origin مجاز، provider keyها |
| production ویدیو | production پایه + همه guardrailها، signing secret، allowlist و worker |
