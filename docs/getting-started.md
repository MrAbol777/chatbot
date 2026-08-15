# راه‌اندازی محیط توسعه

> وضعیت: ✅ مرجع توسعه محلی — بازبینی: ۲۰۲۶-۰۸-۱۵

## پیش‌نیازها

- Node.js نسخه ۱۸ یا بالاتر
- npm
- MySQL یا MariaDB با دسترسی ساخت جدول و index
- Git
- برای قابلیت‌های خارجی: کلیدهای provider مربوطه؛ برای توسعه می‌توان providerهای غیرضروری را خاموش نگه داشت.

## نصب وابستگی‌ها

از ریشه پروژه اجرا کنید:

```bash
npm run install-all
```

این دستور وابستگی‌های `frontend/` و `backend/` را نصب می‌کند. برای نصب جداگانه:

```bash
npm install --prefix frontend
npm install --prefix backend
```

## تنظیم محیط

فایل نمونه را کپی کنید و فقط مقدارهای لازم را تکمیل کنید:

```bash
cp backend/.env.example backend/.env
```

حداقل تنظیمات توسعه معمولاً شامل موارد زیر است:

```env
PORT=4000
DATABASE_URL=mysql://USER:PASSWORD@localhost:3306/chatbot
AUTH_JWT_SECRET=یک-رشته-تصادفی-حداقل-۳۲-کاراکتری
ADMIN_JWT_SECRET=یک-رشته-تصادفی-جداگانه
ADMIN_API_KEY=کلید-ادمین-محلی
METIS_API_KEY=کلید-سرویس-مدل
METIS_OPENAI_BASE_URL=https://api.metisai.ir/openai/v1
OTP_EXPIRE=120
LOCAL_DEV_SESSION_ENABLED=false
```

فایل `.env` واقعی را commit نکنید. برای فهرست کامل متغیرها و تفاوت توسعه/تولید به [configuration.md](./configuration.md) مراجعه کنید.

## آماده‌سازی دیتابیس

در startup، `DatabaseClient` جداول پایه را به‌صورت idempotent ایجاد می‌کند و schemaهای احراز هویت، session و نوآ را نیز ensure می‌کند. برای قابلیت‌هایی که migration اختصاصی دارند، اسکریپت همان قابلیت را اجرا کنید:

```bash
cd backend
npm run db:migrate-image-studio
npm run db:migrate-video-generation
npm run db:migrate-noa
```

در محیط تازه، اجرای migrationها را با توجه به وضعیت واقعی دیتابیس انجام دهید؛ قبل از migration تولیدی backup بگیرید.

## اجرای برنامه

از ریشه:

```bash
npm run dev
```

این دستور با `scripts/dev-with-logs.cjs` سرویس‌ها را هم‌زمان اجرا می‌کند و لاگ را در `logs/terminal.txt` می‌نویسد.

آدرس‌های معمول:

- Frontend توسعه: `http://localhost:5173`
- Backend توسعه: مقدار `PORT` در `backend/.env`؛ مقدار نمونه `4000` است.

اجرای جداگانه:

```bash
npm run dev --prefix frontend
npm run dev --prefix backend
```

برای اجرای backend بدون nodemon:

```bash
npm run start --prefix backend
```

## بررسی اولیه

```bash
curl http://localhost:4000/healthz
curl http://localhost:4000/api/health
```

سپس در فرانت‌اند این مسیرها را بررسی کنید:

1. لندینگ و انتقال به `/chat`.
2. ارسال شماره موبایل و دریافت OTP.
3. تکمیل پروفایل کاربر جدید.
4. ارسال یک پیام چت.
5. ایجاد گفتگوی جدید و بارگذاری مجدد آن.
6. در صورت فعال بودن نوآ، مشاهده موجودی.

## توسعه OTP بدون ارسال SMS

برای توسعه محلی، در کدهای قدیمی/محیط‌هایی که پشتیبانی می‌کنند `OTP_DEV_MOCK=true` استفاده می‌شود؛ در مسیر canonical احراز هویت، تنظیمات IPPanel و `LOCAL_DEV_SESSION_ENABLED` را مطابق `.env.example` بررسی کنید. mock یا local session را روی سرور قابل دسترس عمومی فعال نکنید.

## خطاهای رایج

### `DATABASE_URL must be set`

مقدار `DATABASE_URL` باید با `mysql://` شروع شود و database قابل دسترس باشد.

### frontend به backend وصل نمی‌شود

پورت backend، proxy مربوط به Vite و origin مجاز را بررسی کنید. مقدار `APP_ALLOWED_ORIGINS` باید origin دقیق، بدون path باشد.

### `401 AUTHENTICATION_REQUIRED`

ابتدا فلو OTP را کامل کنید. درخواست‌های حفاظت‌شده از session cookie یا Bearer token استفاده می‌کنند؛ token را در frontend hard-code نکنید.

### پاسخ مدل timeout می‌شود

کلید، `METIS_OPENAI_BASE_URL`، DNS و timeoutهای provider را بررسی کنید. health endpoint upstream و لاگ request id را نیز ببینید.

