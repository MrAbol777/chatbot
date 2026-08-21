# دانوآ — چت‌بات فارسی برای کودک و نوجوان

یک پلتفرم هوش مصنوعی امن و دوستانه برای سنین ۸ تا ۱۸ سال با قابلیت‌های چت، استودیوی تصویر، تولید ویدیو و سیستم اعتبار (نوآ).
فرانت‌اند با **React 18 + TypeScript + Vite** و بک‌اند با **Node.js + Express** ساخته شده است.

---

## فهرست مطالب

- [امکانات اصلی](#امکانات-اصلی)
- [ساختار پروژه](#ساختار-پروژه)
- [پیش‌نیازها](#پیش‌نیازها)
- [راه‌اندازی محلی](#راه‌اندازی-محلی)
- [متغیرهای محیطی](#متغیرهای-محیطی)
- [پایگاه داده](#پایگاه-داده)
- [اسکریپت‌های npm](#اسکریپت‌های-npm)
- [معماری بک‌اند](#معماری-بک‌اند)
- [معماری فرانت‌اند](#معماری-فرانت‌اند)
- [Design System](#design-system)
- [دیپلوی](#دیپلوی)
- [تست‌ها](#تست‌ها)
- [نکات امنیتی](#نکات-امنیتی)
- [چک‌لیست کیفیت قبل از Merge](#چک‌لیست-کیفیت-قبل-از-merge)

---

## امکانات اصلی

### احراز هویت

- ثبت‌نام و ورود با **شماره موبایل + OTP** (از طریق IPPanel)
- تشخیص خودکار کاربر جدید یا قدیمی بعد از تأیید OTP
- تکمیل پروفایل (نام و سن) فقط برای کاربر جدید
- ورود با **Viana OAuth 2.0 / OIDC** (سرویس احراز هویت ویانا)
- نشست‌های امن با JWT و Cookie httpOnly
- Rate limit: حداکثر ۳ درخواست OTP در ۱۰ دقیقه و ۵ تلاش ناموفق برای هر کد
- پشتیبانی از ارقام فارسی/عربی در شماره، سن و کد OTP
- حالت توسعه محلی (`LOCAL_DEV_SESSION_ENABLED=true`) بدون نیاز به SMS

### چت هوشمند

- چت کامل با مدل‌های زبانی از طریق **Metis AI** (سازگار با OpenAI API)
- **Streaming** پاسخ‌های بلادرنگ
- **Intent Router**: تشخیص خودکار نوع درخواست (تصویر / ویدیو / چت / بینایی)
- **Input Optimizer**: بهینه‌سازی ورودی کاربر قبل از ارسال به مدل
- **Conversation Memory**: خلاصه‌سازی خودکار تاریخچه مکالمه
- **Conversation Title**: تولید خودکار عنوان مکالمه
- دسته‌بندی موضوع پیام (academic / emotional / creative / general)
- System Prompt پویا بر اساس پروفایل کاربر (نام، سن)
- ورودی صوتی فارسی با Web Speech API (`fa-IR`)
- مدیریت مکالمه‌ها: جدید، سنجاق، تغییر نام، حذف
- ذخیره مکالمات در پایگاه داده MySQL

### استودیوی تصویر (Image Studio)

- **تولید تصویر** با مدل‌های مختلف (Flux، Gemini Image، BananaAI)
- **ویرایش تصویر** با prompt (Image Edit Pipeline)
- **تحلیل و بینایی تصویر** (Image Understanding) با streaming
- **بهینه‌ساز prompt تصویر** (Image Prompt Refiner)
- گالری تصاویر تولیدشده
- تنظیمات runtime قابل مدیریت از پنل ادمین
- محدودیت تعداد تولید در ساعت

### استودیوی ویدیو (Video Studio)

- تولید ویدیو از طریق **BananaAI** و **Metis (Kling)**
- پشتیبانی از input تصویر برای تبدیل تصویر به ویدیو
- **Video Worker** جداگانه با صف‌بندی job و polling
- سیستم routing ویدیو با قابلیت مدیریت provider از پنل ادمین
- پروفایل‌های prompt آماده برای سبک‌های مختلف ویدیو
- ذخیره‌سازی امن نتایج با اعتبارسنجی URL (SSRF protection)
- محدودیت سهمیه (quota) قابل تنظیم از پنل ادمین

### سیستم نوآ (Noa Credit System)

- کیف پول اعتباری داخلی برای کاربران
- دریافت و پرداخت اعتبار برای استفاده از سرویس‌ها
- رسید دیجیتال با امضای cryptographic
- صورت‌حساب با مدل Fixed-Point arithmetic
- مدیریت والت از پنل ادمین (شارژ، مشاهده موجودی)
- سازگاری با درگاه پرداخت

### پنل مدیریت (Admin Panel)

- داشبورد آمار و تحلیل با خروجی CSV
- مشاهده/ویرایش System Prompt و Config اصلی
- Audit Log برای تغییرات مهم
- مشاهده خطاها با فیلتر تاریخ/نوع
- مدیریت کاربران: پروفایل، مسدود/رفع مسدود، حذف
- مدیریت تنظیمات استودیو تصویر و ویدیو
- تنظیم قیمت‌گذاری (مالی نوآ) برای هر سرویس
- مدیریت routing مدل‌های AI

### سایر

- رابط RTL واکنش‌گرا (موبایل و دسکتاپ)
- پشتیبانی از تم‌های `energy` و `calm`
- Bale Monitor: مانیتورینگ دوره‌ای یک منبع Bale
- Health Check API در `/healthz`

---

## ساختار پروژه

```text
project-root/
├── backend/                        # سرور Node.js + Express
│   ├── src/
│   │   ├── server.js               # نقطه شروع، DI، middleware، route‌ها
│   │   ├── adminRoutes.js          # مسیرها و auth پنل ادمین
│   │   ├── modules/
│   │   │   ├── auth/               # احراز هویت OTP + Viana OAuth
│   │   │   ├── ai/                 # چت، streaming، intent، prompt
│   │   │   ├── ai-routing/         # routing داینامیک مدل‌های AI
│   │   │   ├── image-generation/   # تولید و ویرایش تصویر
│   │   │   ├── image-understanding/# بینایی ماشین (Vision)
│   │   │   ├── input-optimizer/    # بهینه‌ساز ورودی کاربر
│   │   │   ├── intent-router/      # تشخیص نوع درخواست
│   │   │   ├── conversation-memory/# خلاصه‌سازی مکالمه
│   │   │   ├── conversation-title/ # عنوان‌گذاری خودکار مکالمه
│   │   │   ├── conversations/      # CRUD مکالمات
│   │   │   ├── video-generation/   # تولید ویدیو + worker
│   │   │   ├── video-prompt-profiles/ # پروفایل‌های prompt ویدیو
│   │   │   ├── noa/                # سیستم اعتبار (کیف پول)
│   │   │   ├── plans/              # پلن‌های اشتراک
│   │   │   ├── settings/           # تنظیمات پیش‌فرض
│   │   │   ├── sms/                # ارسال OTP با IPPanel
│   │   │   ├── health/             # health check
│   │   │   ├── admin/              # analytics، system، logs
│   │   │   ├── bale_monitor/       # مانیتورینگ Bale
│   │   │   └── testimage-generator/
│   │   ├── repositories/           # لایه دسترسی داده (MySQL)
│   │   │   ├── DatabaseClient.js
│   │   │   ├── UserRepository.js
│   │   │   ├── ConversationRepository.js
│   │   │   ├── ChatTurnRepository.js
│   │   │   ├── ChatMessageRepository.js
│   │   │   ├── AnalyticsRepository.js
│   │   │   ├── EventRepository.js
│   │   │   ├── ErrorRepository.js
│   │   │   ├── InputOptimizationRepository.js
│   │   │   ├── SettingsRepository.js
│   │   │   ├── SupervisedOtpRepository.js
│   │   │   └── helpers.js / index.js
│   │   ├── shared/
│   │   │   └── validators/phone.validator.js
│   │   ├── bootstrap/              # راه‌اندازی اولیه سرور
│   │   └── services/               # سرویس‌های legacy
│   ├── migrations/                 # 43 فایل migration MySQL (001-043)
│   ├── scripts/                    # اسکریپت‌های مدیریتی و worker
│   ├── schema.mysql.sql            # طرح کامل پایگاه داده
│   ├── system-prompt.txt           # system prompt اصلی مدل
│   ├── .env.example
│   └── .env.video-generation.example
│
├── frontend/                       # React 18 + TypeScript + Vite
│   ├── src/
│   │   ├── App.tsx                 # کامپوننت اصلی و state مرکزی
│   │   ├── main.tsx                # نقطه ورود React
│   │   ├── Landing.tsx             # صفحه فرود
│   │   ├── AdminPanel.tsx          # پنل مدیریت
│   │   ├── AdminLogin.tsx          # ورود ادمین
│   │   ├── ImageStudio.tsx         # استودیوی تصویر
│   │   ├── ImageViewer.tsx         # نمایش‌دهنده تصویر
│   │   ├── ChatStudioSwitcher.tsx  # سوئیچر چت/استودیو
│   │   ├── auth/
│   │   │   └── danoaSession.ts     # مدیریت نشست کاربر
│   │   ├── components/
│   │   │   ├── Icon.tsx            # آیکون‌های SVG
│   │   │   ├── ProfileForm.tsx     # فرم تکمیل پروفایل
│   │   │   ├── InsufficientBalanceNotice.tsx
│   │   │   ├── DanoaLoadingMark.tsx
│   │   │   ├── AppErrorBoundary.tsx
│   │   │   └── EmptyState.tsx
│   │   ├── design-system/          # سیستم طراحی (DS)
│   │   │   ├── components/         # Button, Card, Dialog, TextField, Toast
│   │   │   ├── tokens/             # رنگ، فاصله، تایپوگرافی
│   │   │   └── styles/
│   │   ├── noa/                    # کیف پول و سیستم نوآ
│   │   │   ├── NoaWalletPanel.tsx
│   │   │   ├── noa.service.ts
│   │   │   └── noa.types.ts
│   │   ├── studio/                 # صفحه انتخاب استودیو
│   │   │   ├── StudioPage.tsx
│   │   │   └── StudioToolCard.tsx
│   │   ├── video-generation/       # استودیوی ویدیو
│   │   │   ├── VideoGenerationPage.tsx
│   │   │   ├── VideoGenerationForm.tsx
│   │   │   ├── VideoGenerationPlayer.tsx
│   │   │   └── video-generation.service.ts
│   │   ├── services/               # سرویس‌های API (fetch wrapper)
│   │   ├── config/                 # تنظیمات فرانت‌اند
│   │   ├── styles/                 # استایل‌های سراسری
│   │   └── types.ts
│   ├── public/
│   ├── vite.config.ts
│   └── tsconfig.json
│
├── deploy/                         # فایل‌های دیپلوی
│   ├── nginx.conf                  # تنظیمات Nginx (reverse proxy)
│   ├── deploy.sh                   # اسکریپت دیپلوی
│   └── env.production.example
│
├── docs/
│   └── video-prompts/              # پروفایل‌های prompt ویدیو
│
├── scripts/
│   └── dev-with-logs.cjs           # اجرای توسعه با ثبت لاگ
│
├── logs/                           # لاگ‌های اجرا
├── data/                           # فایل‌های تولیدشده (تصویر/ویدیو)
├── Dockerfile
├── docker-compose.yml
├── ecosystem.config.cjs            # تنظیمات PM2
├── package.json
└── README.md
```

---

## پیش‌نیازها

| ابزار | نسخه حداقل |
|---|---|
| Node.js | 20 |
| npm | 10 |
| MySQL / MariaDB | 10.6 |

> در محیط Docker نیازی به نصب MySQL جداگانه ندارید.

---

## راه‌اندازی محلی

### ۱) نصب وابستگی‌ها

```bash
npm run install-all
```

### ۲) ساخت پایگاه داده

```bash
mysql -u root -p -e "CREATE DATABASE danoaa_app CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p danoaa_app < backend/schema.mysql.sql
```

### ۳) تنظیم متغیرهای محیطی

```bash
cp backend/.env.example backend/.env
# فایل backend/.env را ویرایش کنید
```

### ۴) اجرا

```bash
npm run dev
```

- فرانت‌اند: `http://localhost:5173`
- بک‌اند: `http://localhost:4000`
- لاگ: `logs/terminal.txt`

---

## متغیرهای محیطی

فایل کامل نمونه: [`backend/.env.example`](backend/.env.example)

### هسته

| متغیر | توضیح |
|---|---|
| `PORT` | پورت سرور (پیش‌فرض: `4000`) |
| `DATABASE_URL` | آدرس اتصال MySQL (`mysql://user:pass@host:3306/db`) |
| `AUTH_JWT_SECRET` | کلید JWT نشست کاربر (حداقل ۳۲ کاراکتر تصادفی) |
| `APP_ALLOWED_ORIGINS` | آدرس‌های مجاز CORS |

### AI و مدل‌ها

| متغیر | توضیح |
|---|---|
| `METIS_API_KEY` | کلید API اصلی (Metis AI — سازگار با OpenAI) |
| `METIS_OPENAI_BASE_URL` | آدرس پایه Metis |
| `OPENAI_MODEL` | مدل پیش‌فرض چت (مثلاً `gpt-4o-mini`) |
| `METIS_INTENT_ROUTER_API_KEY` | کلید جداگانه Intent Router (اختیاری) |
| `METIS_INPUT_OPTIMIZER_API_KEY` | کلید جداگانه Input Optimizer (اختیاری) |
| `METIS_CONVERSATION_MEMORY_API_KEY` | کلید جداگانه Conversation Memory (اختیاری) |
| `METIS_CONVERSATION_TITLE_API_KEY` | کلید جداگانه عنوان‌گذاری (اختیاری) |
| `GEMINI_API_KEY` | کلید Google Gemini (برای تولید تصویر) |
| `GEMINI_IMAGE_MODEL` | مدل تولید تصویر Gemini |
| `BANANAAI_API_KEY` | کلید BananaAI (تصویر/ویدیو) |
| `GAPGPT_TIMEOUT_MS` | timeout درخواست مدل (میلی‌ثانیه) |

### احراز هویت Viana (اختیاری)

| متغیر | توضیح |
|---|---|
| `VIANA_OAUTH_ENABLED` | فعال‌سازی (`true`/`false`) |
| `VIANA_CLIENT_ID` | Client ID |
| `VIANA_CLIENT_SECRET` | Client Secret |
| `VIANA_REDIRECT_URI` | Callback URL بعد از ورود |
| `VIANA_FRONTEND_URL` | آدرس ویانا |

### SMS و OTP

| متغیر | توضیح |
|---|---|
| `IPPANEL_API_KEY` | کلید IPPanel |
| `IPPANEL_PATTERN_CODE` | کد پترن OTP |
| `IPPANEL_SENDER` | شماره فرستنده (مثلاً `3000505`) |
| `OTP_EXPIRE` | عمر OTP به ثانیه (پیش‌فرض: `120`) |
| `LOCAL_DEV_SESSION_ENABLED` | ورود بدون SMS در dev — **هرگز در production فعال نکنید** |

### ادمین

| متغیر | توضیح |
|---|---|
| `ADMIN_JWT_SECRET` | کلید JWT پنل ادمین |
| `ADMIN_PANEL_PATH` | مسیر پنل (پیش‌فرض: `/admin-secure-9x7k`) |
| `ADMIN_API_KEY` | کلید legacy stats API |

### نشست کاربر

| متغیر | توضیح |
|---|---|
| `DANOA_SESSION_IDLE_TIMEOUT_SECONDS` | timeout بی‌فعالیت (پیش‌فرض: `86400`) |
| `DANOA_SESSION_ABSOLUTE_TIMEOUT_SECONDS` | عمر مطلق نشست (پیش‌فرض: `2592000`) |

### ویدیو (اختیاری)

فایل [`backend/.env.video-generation.example`](backend/.env.video-generation.example) را کپی کنید:

```env
VIDEO_GENERATION_ENABLED=1
VIDEO_WORKER_ENABLED=true
VIDEO_STORAGE_ROOT=/var/lib/danoa/video-results
VIDEO_INPUT_STORAGE_ROOT=/var/lib/danoa/video-inputs
```

---

## پایگاه داده

موتور: **MySQL / MariaDB** — Schema کامل در [`backend/schema.mysql.sql`](backend/schema.mysql.sql)

### جداول اصلی

| جدول | توضیح |
|---|---|
| `app_users` | کاربران (ID، نام، سن، موبایل) |
| `app_guardians` | والدین/سرپرستان |
| `app_children` | پروفایل کودک (متصل به guardian) |
| `app_conversations` | مکالمات |
| `app_chat_messages` | پیام‌های چت |
| `app_chat_turns` | chat turns (streaming) |
| `app_auth_otps` | کدهای OTP |
| `app_auth_otp_request_limits` | rate limit OTP |
| `app_image_generations` | تاریخچه تولید تصویر |
| `app_video_generation_jobs` | صف کارهای ویدیو |
| `app_viana_oauth_flows` | flow‌های Viana OAuth |
| `app_viana_oidc_nonces` | nonce‌های OIDC |
| `noa_wallets` | کیف پول‌های نوآ |
| `noa_receipts` | رسیدهای تراکنش |

### Migration‌ها

43 فایل migration در `backend/migrations/` (001 تا 043).  
اسکریپت‌های کمکی:

```bash
cd backend
npm run db:migrate-image-studio
npm run db:migrate-video-generation
npm run db:migrate-noa
```

---

## اسکریپت‌های npm

### ریشه پروژه

```bash
npm run install-all   # نصب وابستگی‌های frontend و backend
npm run dev           # اجرای همزمان فرانت و بک + لاگ در logs/terminal.txt
```

### بک‌اند (`cd backend`)

```bash
# اجرا
npm run dev           # nodemon (hot-reload)
npm run start         # production

# تست‌ها
npm run test:auth               # احراز هویت
npm run test:stream             # streaming، memory، title، intent
npm run test:noa                # سیستم نوآ
npm run test:video-generation   # تمام تست‌های ویدیو
npm run test:video-generation-security  # SSRF + validation

# پایگاه داده
npm run db:migrate-image-studio
npm run db:migrate-video-generation
npm run db:migrate-noa

# ویدیو worker
npm run worker:video-generation
```

### فرانت‌اند (`cd frontend`)

```bash
npm run dev                           # Vite dev server
npm run build                         # TypeScript + Vite build
npm run preview                       # پیش‌نمایش build
npm run test                          # Vitest (one-shot)
npm run test:watch                    # Vitest (watch mode)
npm run test:video-generation         # تست استودیوی ویدیو
npm run test:video-generation-coverage # با coverage
```

---

## معماری بک‌اند

هر ماژول الگوی `routes → controller → service → repository` را دنبال می‌کند.

### ۱. هسته اجرا (`src/server.js`)

- Express + middleware‌ها: `cors`، `helmet`، `compression`، `cookie-parser`، `express-rate-limit`
- Dependency Injection: ساخت تمام Repository‌ها و inject به سرویس‌ها
- Mount تمام Route‌ها
- Serve استاتیک فرانت‌اند در production

### ۲. لایه Repository (`src/repositories/`)

| فایل | مسئولیت |
|---|---|
| `DatabaseClient.js` | connection pool MySQL، query runner |
| `UserRepository.js` | CRUD کاربران |
| `ConversationRepository.js` | CRUD مکالمات |
| `ChatTurnRepository.js` | chat turns برای streaming |
| `ChatMessageRepository.js` | ذخیره پیام‌های چت |
| `AnalyticsRepository.js` | داده خام گزارش |
| `EventRepository.js` | ثبت رویداد |
| `ErrorRepository.js` | ثبت خطا |
| `InputOptimizationRepository.js` | نتایج Input Optimizer |
| `SettingsRepository.js` | تنظیمات runtime |
| `SupervisedOtpRepository.js` | OTP با نظارت |

### ۳. ماژول احراز هویت (`modules/auth/`)

- **OTP Flow**: ارسال کد → تأیید → ورود مستقیم (قدیمی) یا `signupToken` (جدید) → تکمیل پروفایل → JWT
- **Viana OAuth**: PKCE + OIDC، دریافت student profile
- مدیریت session با JWT در httpOnly cookie
- `principal.js`: استخراج هویت از request

### ۴. ماژول AI (`modules/ai/`)

- `POST /api/chat` با streaming SSE
- نرمال‌سازی history، ساخت payload، فراخوانی مدل
- تشخیص و حذف greeting اضافی در پاسخ‌های غیرابتدایی
- `intent.service.js`: دسته‌بندی پیام (text/image/video/vision/edit)
- `prompt.service.js`: بارگذاری system prompt با cache

### ۵. ماژول Intent Router (`modules/intent-router/`)

تشخیص خودکار نوع درخواست (چت / تصویر / ویرایش تصویر / تحلیل تصویر / ویدیو) پیش از routing به سرویس.

### ۶. ماژول Input Optimizer (`modules/input-optimizer/`)

بهینه‌سازی و فرمت‌بندی ورودی کاربر با LLM — قابل غیرفعال‌سازی با `INPUT_OPTIMIZER_ENABLED=false`.

### ۷. ماژول Conversation Memory (`modules/conversation-memory/`)

خلاصه‌سازی خودکار تاریخچه مکالمه برای حفظ context در token window مدل.

### ۸. ماژول Conversation Title (`modules/conversation-title/`)

تولید خودکار عنوان مکالمه از اولین پیام‌ها — قابل غیرفعال‌سازی با `CONVERSATION_TITLE_ENABLED=false`.

### ۹. ماژول Image Generation (`modules/image-generation/`)

- تولید تصویر با Gemini Image و BananaAI (Flux)
- ویرایش تصویر (Image Edit Pipeline)
- بهینه‌ساز prompt تصویر (`image-prompt-refiner.service.js`)
- تنظیمات runtime مدیریت‌پذیر از DB (`image-runtime-settings.js`)
- محدودیت ساعتی و auth middleware

### ۱۰. ماژول Image Understanding (`modules/image-understanding/`)

تحلیل و توصیف تصویر (Vision) با streaming — تنظیمات از DB.

### ۱۱. ماژول Video Generation (`modules/video-generation/`)

- Worker Pattern: پردازش async job‌های ویدیو با polling از provider
- ذخیره‌سازی امن نتایج (URL whitelist برای جلوگیری از SSRF)
- routing پویا بین BananaAI و Metis/Kling از پنل ادمین
- مدیریت quota برای هر کاربر

### ۱۲. ماژول SMS (`modules/sms/`)

ارسال OTP Pattern از طریق IPPanel با مدیریت timeout و خطا.

### ۱۳. ماژول Noa (`modules/noa/`)

- کیف پول داخلی با Fixed-Point arithmetic (بدون خطای floating point)
- رسیدهای cryptographic با امضای HMAC
- Reconciliation خودکار
- API ادمین: شارژ wallet، گزارش تراکنش‌ها

### ۱۴. ماژول AI Routing (`modules/ai-routing/`)

مدیریت داینامیک provider routing برای هر قابلیت (چت/تصویر/ویدیو) از پنل ادمین.

### ۱۵. ماژول Admin (`adminRoutes.js` + `modules/admin/`)

- JWT cookie مجزا برای ادمین
- `analytics`: آمار داشبورد، CSV
- `system`: System Prompt، Config
- `logs`: فیلتر خطاها، audit log صفحه‌بندی‌شده

### ۱۶. ماژول Bale Monitor (`modules/bale_monitor/`)

Scheduler دوره‌ای برای پایش یک منبع Bale با ذخیره snapshot و state.

---

## معماری فرانت‌اند

SPA با React 18 + TypeScript، build با Vite.

### مسیریابی

| مسیر | کامپوننت | توضیح |
|---|---|---|
| `/` | `Landing.tsx` | صفحه فرود |
| `/chat` | `App.tsx` | چت اصلی |
| `/studio` | `StudioPage.tsx` | انتخاب استودیو |
| `/studio/image` | `ImageStudio.tsx` | استودیوی تصویر |
| `/studio/video` | `VideoGenerationPage.tsx` | استودیوی ویدیو |
| `$ADMIN_PANEL_PATH` | `AdminPanel.tsx` | پنل مدیریت |

### مدیریت State

- State مرکزی در `App.tsx` (مکالمات، پروفایل، تم)
- نشست کاربر در `auth/danoaSession.ts` (JWT از cookie)
- API calls در `services/`
- کیف پول با hook `useNoaWallet`

---

## Design System

مسیر: `frontend/src/design-system/`

### Primitives

| کامپوننت | توضیح |
|---|---|
| `Button` | دکمه با variant‌های مختلف |
| `TextField` | فیلد متنی |
| `TextAreaField` | فیلد متن چندخطی |
| `Card` | کارت محتوا |
| `FieldGroup` | گروه‌بندی فیلدها |
| `InlineMessage` | پیام‌های inline (خطا/موفقیت/هشدار) |
| `Dialog` | دیالوگ/مودال |
| `Toast` | اعلان‌های موقت |

### وضعیت Adoption

- `AdminLogin` و بخش‌هایی از `AdminPanel` و `App` به DS مهاجرت شده‌اند.
- کارهای باقی‌مانده: جایگزینی کنترل‌های raw در `App.tsx` و `AdminPanel.tsx`.

### Guardrails

- برای UI جدید، ابتدا از primitive‌های موجود DS استفاده کنید.
- migration‌ها باید **behavior-preserving** باشند.
- CSS باید scoped باشد.
- قبل از هر PR فرانت: `cd frontend && npm run build` باید pass شود.

---

## دیپلوی

### Docker Compose (توصیه‌شده)

```bash
cp .env.example .env   # تنظیم مقادیر production
docker compose up -d --build
```

**سرویس‌ها:**
- `mysql`: MariaDB 10.11 با healthcheck
- `app`: Node.js 20 Alpine — شامل فرانت‌اند build‌شده، expose پورت `3000`

**Volume‌ها:**
- `mysql-data`: داده DB
- `app-uploads`: فایل‌های آپلودشده
- `video-inputs` / `video-results`: ویدیو

```bash
curl http://localhost:3000/healthz   # بررسی سلامت
```

### PM2 (بدون Docker)

```bash
cd frontend && npm run build   # build فرانت‌اند

pm2 start ecosystem.config.cjs
# پروسه‌ها:
# danoa-api          - سرور اصلی (port 3000)
# danoa-video-worker - video worker جداگانه
```

### Nginx

نمونه کانفیگ: [`deploy/nginx.conf`](deploy/nginx.conf)

---

## تست‌ها

### بک‌اند (Node built-in test runner)

```bash
cd backend
npm run test:auth                        # احراز هویت
npm run test:stream                      # streaming، memory، title
npm run test:noa                         # سیستم نوآ
npm run test:video-generation            # تمام تست‌های ویدیو
npm run test:video-generation-security   # SSRF + validation
```

### فرانت‌اند (Vitest)

```bash
cd frontend
npm run test                             # اجرای یک‌بار
npm run test:watch                       # watch mode
npm run test:video-generation            # استودیوی ویدیو
npm run test:video-generation-coverage   # با coverage
```

---

## نکات امنیتی

- **فرانت‌اند هیچ API Key نگه نمی‌دارد** — تمام درخواست‌ها از بک‌اند می‌گذرند.
- `AUTH_JWT_SECRET` باید حداقل ۳۲ کاراکتر تصادفی باشد.
- `LOCAL_DEV_SESSION_ENABLED` را **هرگز در production** فعال نکنید.
- `ADMIN_PANEL_PATH` را به مسیری غیرقابل حدس تغییر دهید.
- OTP بعد از تأیید موفق یا انقضا به‌صورت خودکار پاک می‌شود.
- Video storage با URL whitelist (SSRF protection) کار می‌کند.
- تمام endpoint‌های admin با `requireAdminAuth` محافظت می‌شوند.
- Helmet، CORS محدود و rate limit روی همه روت‌ها اعمال شده.

---

## چک‌لیست کیفیت قبل از Merge

### ساخت فرانت‌اند

```bash
cd frontend && npm run build
```

### بررسی دستی

- [ ] فلو auth: شماره موبایل → کد تأیید → تکمیل پروفایل (کاربر جدید) یا ورود مستقیم (قدیمی)
- [ ] کاربر بدون ورود نتواند به چت، استودیوی تصویر یا ویدیو دسترسی بگیرد
- [ ] ورودی صوتی (`fa-IR`) در مرورگرهای مجاز کار کند
- [ ] تم `energy` و `calm` به‌درستی اعمال شوند
- [ ] صفحه‌آرایی در موبایل و دسکتاپ بدون شکستگی CSS
- [ ] ناوبری کیبورد (Tab / Enter / Space) روی کنترل‌های DS
- [ ] پنل ادمین: دکمه‌های پروفایل / مسدود / حذف فعال باشند
- [ ] قیمت‌ها از «مالی نوآ» پنل ادمین خوانده و ذخیره شوند
- [ ] Quick chips چت پیام صحیح ارسال کنند
- [ ] Health check در `/healthz` پاسخ `200` برگرداند

---

## مستندات بیشتر

- [`backend/FRONTEND_INTEGRATION_EXAMPLES.md`](backend/FRONTEND_INTEGRATION_EXAMPLES.md) — نمونه‌های integration API
- [`backend/SMS_ARCHITECTURE.md`](backend/SMS_ARCHITECTURE.md) — معماری سیستم SMS
- [`backend/SMS_INTEGRATION_COMPLETE.md`](backend/SMS_INTEGRATION_COMPLETE.md) — راهنمای کامل OTP
- [`frontend/DESIGN_SYSTEM.md`](frontend/DESIGN_SYSTEM.md) — مستندات Design System
- [`README_SMS_INTEGRATION.md`](README_SMS_INTEGRATION.md) — یادداشت‌های پیامک