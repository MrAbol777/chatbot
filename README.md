# دانوآ — چت‌بات فارسی کودک و نوجوان

دانوآ یک چت‌بات فارسی، RTL و مناسب کاربران ۸ تا ۱۸ سال است. پروژه یک فرانت‌اند React و یک API مبتنی بر Node.js دارد و امکانات گفت‌وگو، احراز هویت پیامکی، مدیریت مکالمه، پنل ادمین، پردازش تصویر و تولید ویدئو را فراهم می‌کند.

> این مخزن فقط شامل کد و نمونه‌تنظیمات است. کلیدها، فایل‌های `.env`، دادهٔ کاربران، مکالمه‌ها، رسانه‌های تولیدشده، گزارش‌ها و cacheها نباید commit شوند.

راهنمای ورود اختیاری Viana، تنظیمات و rollout در
[`docs/viana-signin.md`](docs/viana-signin.md) قرار دارد. ورود و ثبت‌نام OTP
موجود مستقل از این integration باقی می‌ماند.

## قابلیت‌ها

- رابط واکنش‌گرا و راست‌به‌چپ با React، TypeScript و Vite
- گفت‌وگوی فارسی با پشتیبانی از streaming، حافظهٔ مکالمه، عنوان‌گذاری خودکار و بهینه‌سازی ورودی
- ورود و ثبت‌نام با شمارهٔ موبایل و OTP؛ تشخیص کاربر جدید/قدیمی و انتقال گفت‌وگوی مهمان پس از ثبت‌نام
- محدودسازی درخواست‌های OTP و تلاش‌های ناموفق، انقضا و مصرف یک‌بارهٔ کد
- گفت‌وگوهای چندگانه: ایجاد، بارگذاری، همگام‌سازی، تغییر عنوان و سنجاق‌کردن
- ورودی صوتی فارسی با Web Speech API و امکان پیوست تصویر
- تولید، ویرایش، نمایش و مدیریت تصاویر؛ تحلیل تصویر با محدودیت نوع و تعداد فایل
- تولید ویدئو با صف، worker مستقل، سهمیهٔ پلن، ذخیره‌سازی خصوصی و کنترل URL نتیجه
- پنل ادمین برای کاربران، آمار، تنظیمات مدل، گزارش‌ها، اشتراک‌ها و لاگ‌های audit
- پرداخت و اشتراک، پیامک IPPanel و webhook/monitor سرویس Bale (در صورت تنظیم)
- اجرا با Docker Compose و MariaDB؛ health checkهای `/healthz` و `/api/health`

## معماری

```text
frontend/                 React + TypeScript + Vite
  src/design-system/      primitiveهای قابل‌استفادهٔ مجدد UI
  src/video-generation/   رابط تولید و پخش ویدئو
  src/studio/             رابط تولید و ویرایش تصویر

backend/                  Express API
  src/modules/            auth, ai, conversations, image, video, admin, sms, ...
  src/repositories/       دسترسی متمرکز به پایگاه‌داده
  migrations/             migrationهای MySQL/MariaDB
  scripts/                migration، worker و ابزارهای عملیاتی

deploy/                   پیکربندی Nginx و اسکریپت deployment
docs/                     معماری و runbookهای عملیاتی
```

لایهٔ composition در `backend/src/server.js` وابستگی‌ها را می‌سازد و routeها را mount می‌کند. منطق دامنه در `backend/src/modules` و دسترسی مستقیم به داده در `backend/src/repositories` نگه‌داری می‌شود. جزئیات بیشتر در [docs/architecture.md](docs/architecture.md) است.

## پیش‌نیازها

- Node.js 20 LTS یا جدیدتر
- npm 10 یا جدیدتر
- MySQL 8 / MariaDB 10.11 برای اجرای محلی یا Docker Desktop برای اجرای containerized
- حساب و کلید سرویس‌های اختیاری موردنیاز شما (Metis/Gemini، IPPanel و ...)

## راه‌اندازی محلی

1. وابستگی‌ها را نصب کنید:

```bash
npm run install-all
```

2. نمونه‌تنظیمات بک‌اند را کپی کنید:

```bash
cp backend/.env.example backend/.env
```

در PowerShell:

```powershell
Copy-Item backend/.env.example backend/.env
```

3. مقدارهای لازم را در `backend/.env` وارد کنید. هیچ‌گاه این فایل را commit نکنید.

4. پایگاه‌داده را آماده و migrationهای موردنیاز را اجرا کنید. برای امکانات تصویر و ویدئو از اسکریپت‌های migration زیر استفاده کنید:

```bash
cd backend
npm run db:migrate-image-studio
npm run db:migrate-video-generation
```

5. در ریشهٔ پروژه سرویس‌ها را اجرا کنید:

```bash
npm run dev
```

- فرانت‌اند: `http://localhost:5173`
- API بک‌اند: `http://localhost:3000`

## متغیرهای محیطی

فایل مرجع کامل، [backend/.env.example](backend/.env.example) است. کلیدها را فقط در secret manager یا فایل محیطیِ خارج از Git نگه دارید.

| گروه | متغیرهای مهم |
| --- | --- |
| پایگاه‌داده و API | `PORT`، `DATABASE_URL`، `ADMIN_API_KEY`، `ADMIN_JWT_SECRET` |
| مدل گفت‌وگو | `METIS_API_KEY`، `METIS_OPENAI_BASE_URL`، `OPENAI_MODEL`، `GEMINI_API_KEY` |
| پیامک | `IPPANEL_API_KEY`، `IPPANEL_PATTERN_CODE`، `IPPANEL_SENDER`، `OTP_EXPIRE` |
| تصویر | `METIS_IMAGE_API_KEY`، `GEMINI_IMAGE_API_KEY`، `IMAGE_PROVIDER`، `IMAGE_MODEL` |
| ویدئو | `VIDEO_GENERATION_ENABLED`، `METIS_BASE_URL`، `VIDEO_STORAGE_ROOT`، allowlistهای `VIDEO_RESULT_*` |
| حافظه و پرداخت | `CONVERSATION_MEMORY_STORAGE_DIR`، `ZARINPAL_*`، `BALE_*` |

برای توسعهٔ بدون ارسال پیامک واقعی، فقط در محیط محلی مقدار `OTP_DEV_MOCK=true` را قرار دهید. در production این مقدار باید غیرفعال باشد.

## Docker Compose

ابتدا یک فایل `.env` محلی کنار `docker-compose.yml` بسازید و secretها را در آن قرار دهید. سپس:

```bash
docker compose up --build
```

Compose یک MariaDB و سرویس برنامه را بالا می‌آورد. داده‌های پایدار به volumeهای Docker یا مسیرهای mount شده منتقل می‌شوند و نباید وارد مخزن شوند.

برای reverse proxy و استقرار سرور به [deploy/nginx.conf](deploy/nginx.conf) و [docs/video-generation-deployment.md](docs/video-generation-deployment.md) رجوع کنید.

## اسکریپت‌ها

### ریشهٔ پروژه

| دستور | کاربرد |
| --- | --- |
| `npm run install-all` | نصب وابستگی‌های frontend و backend |
| `npm run dev` | اجرای هم‌زمان سرویس‌ها و ثبت لاگ محلی |

### فرانت‌اند

```bash
cd frontend
npm run dev
npm run build
npm test
npm run test:video-generation
```

### بک‌اند

```bash
cd backend
npm run dev
npm start
npm run test:stream
npm run test:video-generation
npm run check:video-generation-readiness
npm run video-worker
```

اسکریپت‌های `db:migrate-*` و ابزارهای مدیریت ویدئو در [backend/package.json](backend/package.json) فهرست شده‌اند. پیش از اجرای worker یا فعال‌سازی مدل ویدئو، runbook مربوطه را کامل بخوانید.

## APIهای کلیدی

| حوزه | مسیرهای نمونه |
| --- | --- |
| احراز هویت | `POST /api/send-verification-code`، `POST /api/verify-code`، `POST /api/register-profile` |
| گفت‌وگو | `POST /api/chat`، routeهای `/api/conversations` |
| تصویر | routeهای `/api/images` برای generate، edit، status و serve |
| تحلیل تصویر | `POST /api/image-understanding/analyze` |
| ویدئو | routeهای `/api/video-generations` برای submit، status، history و content |
| سلامت | `GET /healthz`، `GET /api/health`، `GET /api/health/video-generation` |
| ادمین | routeهای محافظت‌شدهٔ `/api/admin/*` |

پاسخ‌ها، مجوزها و جزئیات endpointها ممکن است با ماژول تغییر کنند؛ routeهای موجود در `backend/src/modules/*/*.routes.js` مرجع اجرایی هستند.

## نکات امنیتی و عملیاتی

- `.env`، backupهای تنظیمات، tokenها، دادهٔ کاربران، رسانه‌های آپلودی/تولیدی و coverage را هرگز commit نکنید.
- اگر هر کلیدی حتی در یک commit محلی یا عمومی ثبت شده است، آن را افشا‌شده فرض و فوراً rotate کنید.
- برای production، secretها را در محیط اجرا یا secret manager تنظیم کنید؛ به فایل‌های env داخل image یا repository تکیه نکنید.
- `ADMIN_JWT_SECRET` و `ADMIN_API_KEY` باید تصادفی، بلند و یکتا باشند.
- OTP mock، debug logging و endpointهای آزمایشی را در production غیرفعال کنید.
- ذخیره‌سازی ویدئو باید خارج از مسیر public web، با مجوز محدود و allowlist دقیق نتیجهٔ provider باشد.
- پیش از فعال‌سازی تولید ویدئو، migration، مسیر storage، سهمیه و health check را طبق [runbook](docs/video-generation-deployment.md) بررسی کنید.

## توسعهٔ UI

برای هر کنترل تعاملی جدید، ابتدا primitiveهای موجود در `frontend/src/design-system` را بررسی کنید. migrationهای UI باید رفتار API و state را حفظ کنند، CSS را scoped نگه دارند و با `npm run build` و بررسی دستی کیبورد/موبایل اعتبارسنجی شوند.

## بررسی پیش از انتشار

```bash
cd frontend && npm run build && npm test
cd ../backend && npm run test:stream && npm run test:video-generation
```

همچنین `git status` را بررسی کنید تا هیچ فایل env، دادهٔ کاربر، خروجی تولیدی یا گزارش runtime وارد commit نشده باشد.

## مجوز

مجوز پروژه در حال حاضر در این مخزن اعلام نشده است. پیش از استفاده یا انتشار مجدد، با مالک مخزن هماهنگ کنید.
