دانوآ (چت‌بات فارسی کودک و نوجوان)
 
یک چت‌بات امن و دوستانه برای سنین ۸ تا ۱۸ سال با `React + TypeScript + Vite` در فرانت‌اند و `Node.js + Express` در بک‌اند.

## وضعیت فعلی Design System (خرداد ۱۴۰۵)

- وضعیت کلی: **Foundation پایدار است، ولی هنوز Full Adoption کامل نشده است**.
- مسیر DS: `frontend/src/design-system/`
- Primitiveهای موجود:
  - `Button`
  - `TextField`
  - `TextAreaField`
  - `Card`
  - `FieldGroup`
  - `InlineMessage`
  - `Dialog`
  - `Toast` 
- Adoption انجام‌شده:
  - `AdminLogin` با DS هماهنگ شده است.
  - بخش‌هایی از `AdminPanel` (از جمله Config و برخی actionها) مهاجرت شده‌اند.
  - بخشی از `App` (quick chips) به DS Button/FieldGroup مهاجرت شده است.
- کارهای باقی‌مانده برای Full Adoption:
  - جایگزینی کنترل‌های raw باقی‌مانده در `App.tsx` (composer controls، textarea، برخی buttonها)
  - جایگزینی کنترل‌های raw در `AdminPanel.tsx` (checkbox/select)
  - استانداردسازی کامل message/help/error rendering روی DS

## Guardrailهای فرانت/DS (Stage 5)

- برای UI جدید یا تغییر UI، ابتدا از primitiveهای موجود DS استفاده شود.
- اگر primitive مناسب وجود ندارد، در PR جداگانه پیشنهاد شود (نیاز + API + A11y).
- migrationها باید behavior-preserving باشند (بدون تغییر API/state/business logic).
- CSS تغییرات باید scoped باشد و از leak روی legacy DOM جلوگیری شود.
- برای هر PR فرانت:
  - `frontend: npm run build` پاس شود.
  - یک manual test checklist ارائه شود.

## امکانات اصلی

- ورود/ثبت‌نام یکپارچه با شماره موبایل و کد تأیید
- تشخیص خودکار `login` یا `signup` بعد از تأیید OTP
- تکمیل پروفایل فقط برای کاربر جدید (نام و سن)
- انتقال خودکار تاریخچه مهمان به حساب کاربری بعد از ثبت‌نام موفق
- ذخیره پروفایل، مکالمه‌ها و تنظیمات در `localStorage`
- مدیریت مکالمه‌ها (گفتگوی جدید، سنجاق، تغییر نام، حذف)
- ورودی صوتی فارسی با Web Speech API (`fa-IR`)
- پشتیبانی از انتخاب تم (`energy` و `calm`)
- امکان انتخاب تصویر از UI چت (پیش‌نمایش و حذف قبل از ارسال)
- رابط RTL واکنش‌گرا با طراحی مناسب کودک/نوجوان

## تغییرات جدید

- مهاجرت سرویس مدل از GapGPT به Gemini (از طریق `GEMINI_BASE_URL`)
- افزودن و تثبیت اولیه Design System و migration مرحله‌ای UIها
- تکمیل فلو احراز هویت پیامکی در بک‌اند:
  - `POST /api/send-verification-code`
  - `POST /api/verify-code`
  - `POST /api/register-profile`
- افزودن rate limit برای OTP:
  - حداکثر `3` درخواست کد در `10` دقیقه برای هر شماره
  - حداکثر `5` تلاش ناموفق برای تأیید هر کد
- پاک‌سازی OTP بعد از تأیید موفق یا انقضا
- پشتیبانی از ارقام فارسی/عربی برای شماره موبایل، سن و کد OTP
- پشتیبانی از `OTP_DEV_MOCK=true` برای توسعه محلی بدون ارسال SMS واقعی
- اضافه شدن `GET /api/admin/stats` با `ADMIN_API_KEY`
- اضافه شدن اسکریپت توسعه با لاگ فایل (`logs/terminal.txt`)

## ساختار پروژه

```text
project-root/
├── frontend/
├── backend/
├── logs/
├── scripts/
├── package.json
└── README.md
```

## پیش‌نیازها

- `Node.js` نسخه ۱۸ یا بالاتر
- `npm`

## راه‌اندازی

1) نصب وابستگی‌ها از ریشه پروژه:

```bash
npm run install-all
```

2) ساخت فایل محیطی بک‌اند:

```bash
cp backend/.env.example backend/.env
```

3) تنظیم `backend/.env`:

```env
GEMINI_API_KEY=your_metis_key
GEMINI_BASE_URL=https://api.metisai.ir
GEMINI_MODEL=gemini-2.0-flash
GAPGPT_TIMEOUT_MS=30000
ADMIN_API_KEY=your-secret-key
PORT=3000
DATABASE_URL=mysql://root:@localhost:3306/chatbot
AUTH_JWT_SECRET=change-me
IPPANEL_API_KEY=your-ippanel-api-key
IPPANEL_PATTERN_CODE=your-pattern-code
IPPANEL_SENDER=3000505
OTP_EXPIRE=120
OTP_DEV_MOCK=true
```

- اگر `OTP_DEV_MOCK=true` باشد، کد OTP در لاگ بک‌اند چاپ می‌شود و درخواست واقعی به IPPanel ارسال نمی‌شود.

4) اجرای همزمان فرانت و بک‌اند:

```bash
npm run dev
```

- فرانت‌اند: `http://localhost:5173`
- بک‌اند: `http://localhost:3000`

## اسکریپت‌ها

### ریشه پروژه

- `npm run install-all`: نصب وابستگی‌های `frontend` و `backend`
- `npm run dev`: اجرای همزمان دو سرویس + ثبت لاگ در `logs/terminal.txt`

### frontend

- `npm run dev`
- `npm run build`
- `npm run preview`

## چک سریع کیفیت (قبل از Merge)

برای تغییرات فرانت‌اند/Design System:

```bash
cd frontend
npm run build
```

چک دستی پیشنهادی:

- از لندینگ، دکمه‌های `شروع رایگان` و `ورود به حساب` کاربر را واقعاً به `/chat` ببرند.
- فلو auth به ترتیب `شماره موبایل -> کد تایید -> تکمیل پروفایل برای کاربر جدید` کار کند.
- برای کاربر قدیمی بعد از OTP، ورود مستقیم انجام شود و فرم نام/سن نمایش داده نشود.
- در سناریوی مهمان، بعد از رسیدن به سقف پیام و ثبت‌نام موفق، تاریخچه گفتگو منتقل شود.
- در `AdminPanel` دکمه‌های `پروفایل` / `مسدود-رفع مسدود` / `حذف` فعال باشند.
- در چت، quick chips همچنان پیام صحیح ارسال کنند.
- ناوبری کیبورد (Tab/Enter/Space) روی کنترل‌های جدید درست عمل کند.
- روی موبایل و دسکتاپ شکست CSS نداشته باشیم.

### backend

- `npm run dev`
- `npm run start`

## نکات

- فرانت‌اند هیچ API Key نگه نمی‌دارد و فقط به API بک‌اند درخواست می‌فرستد.
- بک‌اند برای هر پیام، پرامپت پویا بر اساس پروفایل و تاریخچه می‌سازد.
- برای ورودی صوتی، مرورگر باید دسترسی میکروفون داشته باشد.

## ماژول‌های بک‌اند (ریزبه‌ریز)

بک‌اند در مسیر `backend/src` ماژولار شده و هر بخش مسئولیت مشخص خودش را دارد:

### 1) هسته اجرا (`backend/src/server.js`)

- نقطه شروع برنامه و بالا آوردن سرور `Express`
- بارگذاری متغیرهای محیطی از `backend/.env`
- اعمال Middlewareهای اصلی: `cors`، `helmet`، `compression`، `cookie-parser` و `express.json`
- ساخت و تزریق Dependencyها به ماژول‌ها (Repositoryها، سرویس AI، سرویس SMS و...)
- رجیستر کردن تمام Routeها:
  - `auth`
  - `ai/chat`
  - `conversations`
  - `sms`
  - `admin`
  - `health`
- اجرای `bale_monitor` و سرو فایل استاتیک خروجی فرانت

### 2) لایه Repository (`backend/src/repositories`)

این لایه دسترسی به دیتا را متمرکز می‌کند تا بقیه ماژول‌ها مستقیم به DB وصل نشوند:

- `DatabaseClient.js`: مدیریت اتصال و اجرای Query
- `UserRepository.js`: عملیات کاربران (ثبت، یافتن، اطمینان از وجود کاربر)
- `ConversationRepository.js`: عملیات مکالمه‌ها
- `EventRepository.js`: ثبت رویدادها (مثل پیام ارسال‌شده)
- `ErrorRepository.js`: ثبت خطاهای سیستمی/API
- `AnalyticsRepository.js`: خواندن داده خام برای آمار و گزارش
- `helpers.js` و `index.js`: ابزارهای مشترک و Factory ساخت Repositoryها
- `GuestRepository.js`: مدیریت guest user، شمارش پیام مهمان، و migration گفتگوها از `guest_id` به `user_id`

### 3) ماژول احراز هویت (`backend/src/modules/auth`)

مسئول چرخه کامل OTP و مدیریت کاربر:

- `auth.routes.js`: تعریف endpointهای احراز هویت
- `auth.controller.js`: دریافت Request و تبدیل خطا/خروجی به Response استاندارد
- `auth.service.js`: منطق اصلی:
  - ارسال کد تایید برای شماره موبایل
  - تشخیص کاربر قدیمی/جدید بعد از verify
  - ورود مستقیم کاربر قدیمی با JWT
  - صدور `signupToken` کوتاه‌عمر برای تکمیل پروفایل کاربر جدید
  - ثبت/تکمیل پروفایل و migration مهمان به کاربر
  - صدور JWT نهایی
- `auth.repository.js`: دسترسی داده‌ای اختصاصی auth
  - جدول `app_auth_otps` برای نگهداری OTP
  - جدول `app_auth_otp_request_limits` برای rate limit درخواست کد
  - محدودیت تلاش اشتباه و invalidate کردن کد پس از مصرف/انقضا
- `auth.module.js`: Compose کردن Route + Service + Repository برای تزریق در `server.js`

### 4) ماژول SMS (`backend/src/modules/sms`)

مسئول ارتباط با IPPanel برای ارسال OTP:

- `sms.routes.js`: مسیرهای API پیامک (ارسال/وضعیت)
- `sms.controller.js`: کنترل ورودی و خروجی HTTP
- `sms.service.js`: منطق ارسال Pattern OTP به IPPanel، مدیریت timeout و خطا
  - پشتیبانی از `IPPANEL_API_KEY`، `IPPANEL_PATTERN_CODE` و `IPPANEL_SENDER`
  - پشتیبانی از `OTP_DEV_MOCK=true` برای توسعه محلی
- `sms.module.js`: سیم‌کشی وابستگی‌ها برای مصرف در سرور

> نکته: در `backend/src/services` چند فایل قدیمی/آزمایشی SMS هم هست (`smsService.js`، `sms.service.ts`، `testSMS.js`) که مسیر اصلی اجرای فعلی نیستند؛ مسیر عملیاتی اصلی پروژه، `modules/sms` است.

### 5) ماژول هوش مصنوعی (`backend/src/modules/ai`)

مسئول پردازش پیام چت و ارتباط با مدل:

- `ai.routes.js`: تعریف `POST /api/chat`
- `ai.controller.js`: اعتبارسنجی ورودی، مدیریت error codeها و پاسخ HTTP
- `ai.service.js`: منطق اصلی:
  - نرمال‌سازی history
  - ساخت payload استاندارد چت
  - فراخوانی مدل با timeout
  - استخراج پاسخ متنی
  - حذف greeting اضافی در پیام‌های غیرابتدایی
  - دسته‌بندی موضوع پیام (academic/emotional/creative/general)
  - ثبت event/خطا/ذخیره در مکالمه‌ها
- `prompt.service.js`: مدیریت system prompt و config مدل (همراه با cache و invalidation)

### 6) ماژول مکالمه‌ها (`backend/src/modules/conversations`)

مسئول CRUD مکالمات کاربر:

- `routes.js`: endpointهای لیست/ذخیره مکالمه
- `controller.js`: مدیریت ورودی/خروجی API
- `service.js`: منطق اعمال روی مکالمات (خواندن، جایگزینی، اعتبارسنجی)
- `index.js`: ساخت ماژول و تزریق dependency

### 7) ماژول Health (`backend/src/modules/health`)

پایش سلامت سرویس:

- `health.routes.js`: مسیرهای health check
- `health.controller.js`: پاسخ‌دهی وضعیت سرویس
- `health.service.js`: چک داخلی سرور و چک اتصال به سرویس مدل

### 8) ماژول ادمین (`backend/src/adminRoutes.js` + `backend/src/modules/admin`)

مسئول پنل مدیریت، تنظیمات و گزارش‌ها:

- `adminRoutes.js`:
  - لاگین ادمین، صدور/بررسی JWT و cookie
  - محافظت مسیرها با `requireAdminAuth`
  - bootstrap فایل‌های `admin.json`، `config.json`، `audit.log`
  - mount زیرماژول‌های admin
- زیرماژول‌ها:
  - `modules/admin/analytics`:
    - آمار داشبورد
    - خروجی CSV گزارش
    - پشتیبانی از `GET /api/admin/stats` (legacy key-based)
  - `modules/admin/system`:
    - مشاهده/ویرایش config
    - مشاهده/ویرایش system prompt
    - ثبت audit برای تغییرات مهم
  - `modules/admin/logs`:
    - مشاهده خطاها با فیلتر تاریخ/نوع
    - صفحه‌بندی audit log

### 9) ماژول مانیتورینگ Bale (`backend/src/modules/bale_monitor`)

ماژول زمان‌بندی‌شده برای مانیتورینگ یک منبع Bale:

- `scheduler.js`: اجرای دوره‌ای Job
- `checker.js`: منطق چک داده/وضعیت
- `baleClient.js`: ارتباط با endpoint منبع
- `parser.js`: تبدیل داده خام به ساختار قابل استفاده
- `storage.js`: ذخیره snapshot و state مانیتورینگ
- `config.js`: تنظیمات ماژول
- `index.js`: راه‌اندازی (`initBaleMonitor`)

### 10) ابزارهای مشترک (`backend/src/shared`)

- `shared/validators/phone.validator.js`:
  - نرمال‌سازی شماره موبایل ایران (local/international)
  - پشتیبانی از ارقام فارسی و عربی
  - اعتبارسنجی موبایل
  - نرمال‌سازی کد OTP (اعداد فارسی/عربی به انگلیسی)
  - تولید variantهای شماره برای تطبیق بهتر
