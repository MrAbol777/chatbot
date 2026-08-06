# دانوآ — چت‌بات فارسی کودک و نوجوان

دانوآ یک چت‌بات فارسی، راست‌به‌چپ (RTL) و ایمن برای گروه سنی ۸ تا ۱۸ سال است. پروژه شامل یک فرانت‌اند React (TypeScript + Vite) و یک API مبتنی بر Express.js (CommonJS) می‌باشد.

> این مخزن فقط شامل کد منبع و نمونه‌تنظیمات است. کلیدهای مخفی، فایل‌های `.env`، دادهٔ کاربران، مکالمه‌ها، رسانه‌های تولیدشده، گزارش‌ها و cacheها هرگز commit نشوند.

---

## قابلیت‌ها

### چت و مکالمه
- گفت‌وگوی فارسی با streaming (NDJSON) و پشتیبانی از قطع و وصل
- حافظهٔ بلندمدت مکالمه با ذخیره‌سازی سندی و بازسازی خودکار
- عنوان‌گذاری خودکار مکالمه‌ها با مدل هوش مصنوعی
- بهینه‌سازی خودکار ورودی کاربر (input optimizer)
- مسیریابی هوشمند intent (intent router) برای تشخیص نوع درخواست
- مکالمه‌های چندگانه: ایجاد، بارگذاری، همگام‌سازی، تغییر عنوان و سنجاق‌کردن
- پیوست تصویر در چت و تحلیل تصویر (image understanding)

### احراز هویت
- ورود و ثبت‌نام با شمارهٔ موبایل و کد یک‌بارمصرف (OTP) از طریق IPPanel
- ورود با Viana (OAuth 2.0 / OpenID Connect) مخصوص دانش‌آموزان
- تشخیص کاربر جدید/قدیمی و انتقال گفت‌وگوی مهمان پس از ثبت‌نام
- محدودسازی نرخ درخواست OTP، انقضا و مصرف یک‌بارهٔ کد
- نشست‌های امن با JWT در HttpOnly Cookie و محافظت CSRF

### تصویر
- تولید تصویر هوش مصنوعی با Metis و Gemini
- ویرایش تصویر (image-to-image)
- گالری و نمایش تصاویر تولیدشده با Studio اختصاصی
- پالایش خودکار prompt تصویر
- محدودیت نوع و تعداد فایل، محدودیت نرخ ساعتی

### ویدئو
- تولید ویدئو (text-to-video و image-to-video) با Metis و BananaAI
- صف پردازش با worker مستقل، سهمیهٔ پلن و health check اختصاصی
- مسیریابی هوشمند مدل ویدئو (AI video routing)
- پروفایل‌های prompt ویدئو برای سبک‌های مختلف
- ذخیره‌سازی خصوصی نتایج، کنترل دسترسی با signed URL
- آپلود و مدیریت media ورودی (تصویر برای image-to-video)

### سیستم اعتباری نوآ (Noa)
- کیف پول کاربری با موجودی ریالی
- ثبت تراکنش‌ها، رسید پرداخت و اعلان‌ها
- تسویه‌حساب و مدیریت مالی در پنل ادمین

### پنل مدیریت
- مدیریت کاربران (مشاهده، مسدودسازی، حذف)
- آمار و نمودارهای تحلیلی (Recharts)
- مدیریت تنظیمات مدل‌های هوش مصنوعی (چت، تصویر، بینایی، intent router)
- مدیریت مسیریابی AI (فعال/غیرفعال‌سازی providerها)
- پنل مدیریت ویدئو (مشاهده، جستجو، جزئیات)
- پنل مدیریت پروفایل‌های prompt ویدئو
- مدیریت مالی نوآ (تنظیم کیف پول، تراکنش‌ها)
- لاگ‌های audit و مدیریت سیستم

### سایر
- ورودی صوتی فارسی با Web Speech API در فرانت‌اند
- اجرا با Docker Compose و MariaDB 10.11
- PM2 process manager برای production
- health checkهای استاندارد (`/healthz` و `/api/health`)
- پایش و webhook سرویس Bale (در صورت تنظیم)

---

## ساختار پروژه

```text
frontend/                     React 18 + TypeScript + Vite 5
  src/
    design-system/             کامپوننت‌های پایه UI (Button, Card, Dialog, Toast, ...)
    studio/                    هاب استودیو (تصویر و ویدئو)
    video-generation/          رابط تولید، پخش، گالری و تاریخچهٔ ویدئو
    admin/                     پنل‌های ادمین (ai-routing, video, profiles, noa)
    noa/                       کیف پول و مدیریت اعتبار نوآ
    components/                کامپوننت‌های اشتراکی (ErrorBoundary, Icon, ...)
    auth/                      مدیریت نشست و Viana OAuth
    services/                  کلاینت API تصویر
    config/                    تنظیمات public assets
    styles/                    فونت (Vazirmatn, Sahel)، تم رنگی، ریسپانسیو
    test/                      setup تست و fixtureها

backend/                      Express.js (CommonJS)
  src/
    server.js                  composition root: ساخت وابستگی‌ها و mount routeها
    adminRoutes.js            router مرکزی ادمین
    modules/                   ۲۰ ماژول دامنه:
      admin/                   سرویس‌های ادمین (analytics, logs, settings, system)
      ai/                      چت و streaming
      ai-routing/              مسیریابی هوشمند providerها
      auth/                    احراز هویت OTP، Viana OAuth و نشست
      bale_monitor/            پایش ربات Bale
      conversation-memory/     حافظهٔ بلندمدت مکالمه
      conversation-title/      عنوان‌گذاری خودکار
      conversations/           CRUD مکالمه‌ها
      health/                  health checkها
      image-generation/        تولید و ویرایش تصویر
      image-understanding/     تحلیل و فهم تصویر
      input-optimizer/         بهینه‌سازی ورودی کاربر
      intent-router/           مسیریابی intent
      noa/                     سیستم اعتباری نوآ
      settings/                تنظیمات پیش‌فرض
      sms/                     پیامک IPPanel
      testimage-generator/     تولید تصویر تست
      video-generation/        تولید ویدئو (providers, storage, worker, input-media)
      video-prompt-profiles/   پروفایل‌های prompt ویدئو
    repositories/               دسترسی متمرکز به پایگاه‌داده (۱۶ فایل)
    routes/                     routeیارهای کمکی
    services/                   سرویس‌های اشتراکی
    shared/                     ابزارهای اشتراکی
  migrations/                  ۴۳ فایل migration SQL
  scripts/                     worker، migration، ابزارهای مدیریتی و تست
  system-prompt.txt            system prompt هوش مصنوعی

deploy/                       پیکربندی Nginx، اسکریپت deployment، env نمونهٔ production
docs/                         مستندات معماری، runbookها و راهنماها
scripts/                      اسکریپت‌های ریشهٔ پروژه
uptime/                       پایشگر uptime ربات Bale (Python)
VM/                           فونت‌های TTF/WOFF2
data/                         داده‌های runtime (تصاویر، حافظهٔ مکالمه)
logs/                         لاگ‌های برنامه
```

---

## پیش‌نیازها

- **Node.js** 20 LTS یا جدیدتر (در Docker از node:20-alpine استفاده می‌شود)
- **npm** 10 یا جدیدتر
- **MySQL 8** / **MariaDB 10.11** (محلی یا از طریق Docker)
- کلید API سرویس‌های موردنیاز: Metis, Gemini, IPPanel, BananaAI, Viana و Zarinpal (اختیاری)

---

## راه‌اندازی سریع محلی

### ۱. نصب وابستگی‌ها

```bash
npm run install-all
```

### ۲. تنظیم متغیرهای محیطی

```bash
# Linux / macOS
cp backend/.env.example backend/.env
```

```powershell
# Windows PowerShell
Copy-Item backend/.env.example backend/.env
```

مقادیر لازم را در `backend/.env` وارد کنید. **این فایل را هرگز commit نکنید.**

### ۳. راه‌اندازی پایگاه‌داده و migrationها

پایگاه داده را ایجاد کرده و migrationهای موردنیاز را اجرا کنید:

```bash
cd backend
npm run db:migrate-image-studio
npm run db:migrate-video-generation
npm run db:migrate-noa
npm run db:migrate-viana
```

### ۴. اجرای سرویس‌ها

```bash
# از ریشهٔ پروژه
npm run dev
```

- **فرانت‌اند**: `http://localhost:5173` (Vite dev server با proxy API به `localhost:4000`)
- **API بک‌اند**: `http://localhost:4000` (پورت پیش‌فرض در `.env.example`)

---

## متغیرهای محیطی

مرجع کامل در [`backend/.env.example`](backend/.env.example) قرار دارد. برای production از [`deploy/env.production.example`](deploy/env.production.example) استفاده کنید.

| گروه | متغیرهای کلیدی |
| --- | --- |
| **پایگاه‌داده و سرور** | `PORT`، `DATABASE_URL` |
| **مدل گفت‌وگو** | `METIS_API_KEY`، `METIS_OPENAI_BASE_URL`، `OPENAI_MODEL`، `GEMINI_API_KEY` |
| **احراز هویت** | `AUTH_JWT_SECRET`، `VIANA_OAUTH_ENABLED`، `VIANA_CLIENT_ID`، `VIANA_CLIENT_SECRET` |
| **ادمین** | `ADMIN_API_KEY`، `ADMIN_JWT_SECRET`، `ADMIN_PANEL_PATH` |
| **پیامک** | `IPPANEL_API_KEY`، `IPPANEL_PATTERN_CODE`، `IPPANEL_SENDER`، `OTP_EXPIRE` |
| **تصویر** | `GEMINI_IMAGE_MODEL` (مدل‌های تصویر از طریق پنل ادمین مدیریت می‌شوند) |
| **تحلیل تصویر** | `GEMINI_API_KEY` (تنظیمات vision از طریق پنل ادمین) |
| **ویدئو** | `VIDEO_GENERATION_ENABLED`، `VIDEO_WORKER_ENABLED`، `VIDEO_STORAGE_ROOT`، `BANANAAI_API_KEY`، `VIDEO_RESULT_*` |
| **بهینه‌ساز و عنوان** | `INPUT_OPTIMIZER_ENABLED`، `CONVERSATION_TITLE_ENABLED`، کلیدهای Metis جداگانه |
| **نوآ و پرداخت** | `ZARINPAL_MERCHANT_ID` (در production) |
| **نشست** | `DANOA_SESSION_TTL_SECONDS`، `DANOA_SESSION_ABSOLUTE_TIMEOUT_SECONDS` |
| **توسعهٔ محلی** | `LOCAL_DEV_SESSION_ENABLED` (فقط localhost) |

برای توسعهٔ بدون ارسال پیامک واقعی، مقدار `LOCAL_DEV_SESSION_ENABLED=true` را فقط در محیط محلی تنظیم کنید. **هرگز در production فعال نکنید.**

---

## اجرا با Docker

یک فایل `.env` در کنار `docker-compose.yml` بسازید (از روی `deploy/env.production.example`) و سپس:

```bash
docker compose up --build
```

سرویس‌ها:
- **MariaDB 10.11** روی volume `mysql-data`
- **برنامه** روی `http://127.0.0.1:3000` (Nginx روی production پروکسی می‌کند)
- volumeهای پایدار برای آپلود تصاویر، حافظهٔ مکالمه، ورودی و خروجی ویدئو

برای استقرار کامل production شامل Nginx، SSL، اجرای migrationها و فعال‌سازی مسیرهای ویدئو، اسکریپت [`deploy/deploy.sh`](deploy/deploy.sh) را مطالعه و اجرا کنید.

---

## اسکریپت‌ها

### ریشهٔ پروژه

| دستور | کاربرد |
| --- | --- |
| `npm run install-all` | نصب وابستگی‌های frontend و backend |
| `npm run dev` | اجرای هم‌زمان frontend و backend با ذخیرهٔ لاگ در `logs/terminal.txt` |

### فرانت‌اند

| دستور | کاربرد |
| --- | --- |
| `npm run dev` | Vite dev server (پورت 5173) |
| `npm run build` | TypeScript compile + Vite build |
| `npm run preview` | پیش‌نمایش build |
| `npm test` | اجرای تمام تست‌ها با Vitest |
| `npm run test:video-generation` | تست‌های ماژول ویدئو |
| `npm run test:video-generation-coverage` | تست ویدئو با coverage |

### بک‌اند

| دستور | کاربرد |
| --- | --- |
| `npm run dev` | nodemon با hot reload |
| `npm start` | اجرای production |
| `npm run test:auth` | تست‌های احراز هویت |
| `npm run test:stream` | تست‌های streaming (چت، vision، عنوان، intent) |
| `npm run test:noa` | تست‌های سیستم اعتباری نوآ |
| `npm run test:title` | تست‌های عنوان‌گذاری مکالمه |
| `npm run db:migrate-image-studio` | migration تصویر |
| `npm run db:migrate-video-generation` | migration ویدئو |
| `npm run db:migrate-noa` | migration نوآ |
| `npm run db:migrate-viana` | migration Viana OAuth |
| `npm run video-worker` | اجرای worker تولید ویدئو |
| `npm run video-input-gateway` | اجرای gateway ورودی ویدئو |
| `npm run check:video-generation-readiness` | بررسی آمادگی تولید ویدئو |
| `npm run test:video-generation` | مجموعه کامل تست ویدئو |
| `npm run test:video-generation-integration` | تست یکپارچگی ویدئو |
| `npm run test:video-generation-security` | تست‌های امنیتی ویدئو (SSRF، hardening) |
| `npm run admin:enable-video-model` | فعال‌سازی مدل ویدئو |
| `npm run admin:activate-bananaai-video` | فعال‌سازی مسیر BananaAI |

تمامی اسکریپت‌های بک‌اند در [`backend/package.json`](backend/package.json) فهرست شده‌اند.

---

## APIهای کلیدی

### احراز هویت
| متد | مسیر | توضیح |
| --- | --- | --- |
| `POST` | `/api/send-verification-code` | ارسال کد تأیید |
| `POST` | `/api/auth/phone-status` | بررسی وضعیت شماره |
| `POST` | `/api/verify-code` | تأیید کد |
| `POST` | `/api/register-profile` | تکمیل پروفایل |
| `GET` | `/api/auth/session` | دریافت نشست جاری |
| `POST` | `/api/auth/logout` | خروج |
| `GET` | `/api/auth/viana/config` | تنظیمات Viana OAuth |
| `GET` | `/api/auth/viana/start` | شروع فرآیند Viana |
| `GET` | `/api/auth/viana/callback` | callback Viana |

### چت و مکالمه
| متد | مسیر | توضیح |
| --- | --- | --- |
| `POST` | `/api/chat` | ارسال پیام (streaming NDJSON) |
| `POST` | `/api/conversations` | ایجاد مکالمه |
| `POST` | `/api/conversations/load` | بارگذاری مکالمه‌ها |
| `POST` | `/api/conversations/sync` | همگام‌سازی |
| `PATCH` | `/api/conversations/:id/title` | ویرایش عنوان |

### تصویر
| متد | مسیر | توضیح |
| --- | --- | --- |
| `POST` | `/api/images/generate` | تولید تصویر |
| `GET` | `/api/images/status/:taskId` | وضعیت تولید |
| `GET` | `/api/images/result/:taskId` | نتیجهٔ تولید |
| `GET` | `/api/images/serve/:taskId` | دریافت فایل تصویر |
| `POST` | `/api/vision/analyze` | تحلیل تصویر |
| `POST` | `/api/uploads/images` | آپلود تصویر |

### ویدئو
| متد | مسیر | توضیح |
| --- | --- | --- |
| `POST` | `/api/video-generations` | ثبت درخواست تولید |
| `GET` | `/api/video-generations` | لیست تولیدات کاربر |
| `GET` | `/api/video-generations/options` | گزینه‌های مدل‌های ویدئو |
| `GET` | `/api/video-generations/:id` | جزئیات یک تولید |
| `GET` | `/api/video-generations/:id/content` | دریافت فایل ویدئو |
| `POST` | `/api/video-generations/input-media` | آپلود media ورودی |
| `GET` | `/api/video-generations/prompt-profiles` | پروفایل‌های prompt |

### نوآ (اعتبار)
| متد | مسیر | توضیح |
| --- | --- | --- |
| `GET` | `/api/noa/config` | تنظیمات عمومی (نرخ‌ها) |
| `GET` | `/api/noa/wallet` | کیف پول کاربر |
| `GET` | `/api/noa/balance` | موجودی |
| `GET` | `/api/noa/transactions` | تراکنش‌ها |
| `POST` | `/api/noa/receipts` | ثبت رسید پرداخت |
| `GET` | `/api/noa/notifications/pending` | اعلان‌های در انتظار |

### سلامت
| متد | مسیر | توضیح |
| --- | --- | --- |
| `GET` | `/healthz` | liveness probe |
| `GET` | `/health` | health check |
| `GET` | `/api/health` | وضعیت تفصیلی |
| `GET` | `/api/health/video-generation` | سلامت سرویس ویدئو |

### ادمین
تمامی مسیرهای ادمین زیر `/api/admin/*` با احراز هویت JWT محافظت می‌شوند. مسیر دقیق پنل با `ADMIN_PANEL_PATH` تنظیم می‌شود. حوزه‌های اصلی:

- **کاربران**: `/api/admin/users`
- **تصاویر**: `/api/admin/image-settings`, `/api/admin/image-generations`
- **تحلیل تصویر**: `/api/admin/vision-settings`
- **مسیریابی AI**: `/api/admin/ai-routing/providers`
- **حافظهٔ مکالمه**: `/api/admin/conversations/:id/memory`
- **ویدئو**: `/api/admin/video-generations`
- **پروفایل‌های prompt**: `/api/admin/video-prompt-profiles`
- **نوآ**: `/api/admin/noa/*`
- **آمار و لاگ**: `/api/admin/analytics/*`, `/api/admin/logs/*`
- **تنظیمات سیستم**: `/api/admin/settings/*`, `/api/admin/system/*`

---

## تست‌ها

### فرانت‌اند (Vitest + jsdom)
```bash
cd frontend
npm test                          # تمام تست‌ها
npm run test:video-generation     # فقط تست‌های ویدئو
npm run test:watch                # watch mode
```

### بک‌اند (Node.js native test runner)
```bash
cd backend
npm run test:stream                                           # تست‌های streaming
npm run test:auth                                              # تست‌های احراز هویت
npm run test:noa                                               # تست‌های نوآ
npm run test:video-generation                                  # مجموعه کامل تست ویدئو
npm run test:video-generation-security                         # تست‌های امنیتی
npm run test:video-generation-integration                      # تست یکپارچگی
```

---

## Production

### PM2
برای مدیریت فرآیندها در production از PM2 با پیکربندی [`ecosystem.config.cjs`](ecosystem.config.cjs) استفاده می‌شود که شامل دو app است:
- `danoa-api` — سرور Express (fork mode، پورت 3000)
- `danoa-video-worker` — worker تولید ویدئو (fork mode)

### Docker
برای استقرار containerized از [`deploy/deploy.sh`](deploy/deploy.sh) استفاده کنید که مراحل build، راه‌اندازی MariaDB، اجرای migrationها، فعال‌سازی مسیرهای ویدئو و health check را خودکار می‌کند.

### Nginx
پیکربندی production Nginx با SSL در [`deploy/nginx.conf`](deploy/nginx.conf) آماده است. برای راه‌اندازی اولیهٔ Let's Encrypt از [`deploy/nginx.bootstrap.conf`](deploy/nginx.bootstrap.conf) استفاده کنید.

---

## نکات امنیتی و عملیاتی

- `.env`، backupهای تنظیمات، tokenها، دادهٔ کاربران، رسانه‌های آپلودی/تولیدی، coverage و لاگ‌ها را commit نکنید.
- در صورت افشای هر کلید (حتی در commit محلی)، فوراً آن را rotate کنید.
- در production، secretها را در متغیرهای محیطی سیستم یا secret manager نگه دارید، نه فایل `.env` داخل image.
- `ADMIN_JWT_SECRET` و `ADMIN_API_KEY` باید تصادفی، بلند و یکتا باشند.
- `LOCAL_DEV_SESSION_ENABLED` و debug logging را در production غیرفعال کنید.
- ذخیره‌سازی ویدئو باید خارج از public web root، با allowlist دقیق host و path انجام شود.
- پیش از فعال‌سازی تولید ویدئو، migration، مسیر storage، سهمیه و health check را طبق [runbook ویدئو](docs/video-generation-deployment.md) بررسی کنید.
- CORS فقط به `APP_ALLOWED_ORIGINS` تنظیم‌شده محدود است.

---

## مستندات تکمیلی

| مستند | توضیح |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | معماری کلی سیستم |
| [`docs/viana-signin.md`](docs/viana-signin.md) | راهنمای یکپارچگی Viana OAuth |
| [`docs/video-generation-deployment.md`](docs/video-generation-deployment.md) | runbook استقرار تولید ویدئو |
| [`docs/video-worker-operations.md`](docs/video-worker-operations.md) | راهنمای عملیات worker ویدئو |
| [`docs/video-result-storage.md`](docs/video-result-storage.md) | ذخیره‌سازی و تحویل نتایج ویدئو |
| [`docs/metis-video-integration.md`](docs/metis-video-integration.md) | یکپارچگی با Metis ویدئو |
| [`docs/danoa-vps-video-deployment.md`](docs/danoa-vps-video-deployment.md) | راهنمای استقرار روی VPS |
| [`docs/noa-credit-system-design.md`](docs/noa-credit-system-design.md) | طراحی سیستم اعتباری نوآ |
| [`docs/ai-routing/`](docs/ai-routing/) | معماری و راهنمای مسیریابی AI |
| [`docs/video-prompts/`](docs/video-prompts/) | قالب‌های prompt ویدئو |
| [`docs/video-prompt-profiles/`](docs/video-prompt-profiles/) | معماری پروفایل‌های prompt |

---

## بررسی پیش از انتشار

```bash
cd frontend && npm run build && npm test
cd ../backend && npm run test:stream && npm run test:video-generation
```

همچنین `git status` را بررسی کنید تا فایل env، دادهٔ کاربری، خروجی تولیدی یا لاگ runtime وارد commit نشده باشد.

---

## مجوز

مجوز پروژه در حال حاضر در این مخزن اعلام نشده است. پیش از استفاده یا انتشار، با مالک مخزن هماهنگ کنید.
