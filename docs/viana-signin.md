# Sign in with Viana در Danoa

این integration یک روش ورود **اضافی** است. ثبت‌نام و ورود مستقل Danoa با شماره
موبایل، OTP و Bearer JWT همچنان فعال و مستقل باقی می‌ماند. حساب Viana به حساب
OTP بر اساس نام، سن، تاریخ تولد یا سایر اطلاعات شخصی merge نمی‌شود.

## مسیرها

- `GET /api/auth/viana/config`: فقط وضعیت feature و نام provider برای UI
- `GET /api/auth/viana/start`: ساخت state و S256 PKCE و redirect به Viana
- `GET /api/auth/viana/callback`: مصرف state، exchange یک‌باره code، UserInfo و
  ساخت session محلی Danoa
- `GET /api/auth/session`: بازیابی principal مشترک OTP/Viana و CSRF token نشست
- `POST /api/auth/logout`: خروج محلی Danoa؛ نه revocation‌ JWT و نه global logout
  از Viana

callbackهایی که باید عیناً در Viana ثبت شوند:

- development: `http://localhost:5173/api/auth/viana/callback`
- production: `https://danoa.ir/api/auth/viana/callback`

در development، Vite درخواست‌های `/api` را به backend روی
`http://localhost:4000` proxy می‌کند. کلاینت development با callback محلی به
endpointهای عمومی Viana متصل می‌شود؛ بنابراین Danoa برای ورود به Viana روی
پورت‌های محلی `3000/3001` وابسته نیست.

endpointهای production تأییدشده:

- Authorization: `https://vianaland.ir/oauth/continue`
- Token: `https://vianaland.ir/api/v1/oauth/token`
- UserInfo: `https://vianaland.ir/api/v1/oauth/userinfo`
- Scope: `profile`

## پیکربندی

مقادیر زیر فقط در env سمت سرور قرار می‌گیرند:

```env
VIANA_OAUTH_ENABLED=false
VIANA_ENVIRONMENT=development
VIANA_FRONTEND_URL=https://vianaland.ir
VIANA_API_URL=https://vianaland.ir/api/v1
VIANA_CLIENT_ID=
VIANA_CLIENT_SECRET=
VIANA_REDIRECT_URI=http://localhost:5173/api/auth/viana/callback
VIANA_POST_LOGIN_PATH=/
VIANA_HTTP_TIMEOUT_MS=10000
APP_ALLOWED_ORIGINS=http://localhost:5173
DANOA_SESSION_IDLE_TIMEOUT_SECONDS=86400
DANOA_SESSION_ABSOLUTE_TIMEOUT_SECONDS=2592000
```

production بعد از صدور credential جدید:

```env
VIANA_OAUTH_ENABLED=true
VIANA_ENVIRONMENT=production
VIANA_FRONTEND_URL=https://vianaland.ir
VIANA_API_URL=https://vianaland.ir/api/v1
VIANA_CLIENT_ID=
VIANA_CLIENT_SECRET=
VIANA_REDIRECT_URI=https://danoa.ir/api/auth/viana/callback
VIANA_POST_LOGIN_PATH=/
VIANA_HTTP_TIMEOUT_MS=10000
APP_ALLOWED_ORIGINS=https://danoa.ir
DANOA_SESSION_IDLE_TIMEOUT_SECONDS=86400
DANOA_SESSION_ABSOLUTE_TIMEOUT_SECONDS=2592000
```

endpointهای OAuth از دو base URL مشتق می‌شوند و نباید جداگانه یا داخل source
تعریف شوند. اگر feature فعال باشد و یکی از مقادیر لازم خالی باشد، startup
عمداً fail می‌شود. secret واقعی فقط باید در `backend/.env` محلی یا
`/opt/chatbot/.env` سرور قرار بگیرد؛ هر دو خارج از Git هستند.

## storage و migration

فایل `backend/migrations/042_viana_oauth_sessions.sql` سه جدول افزایشی زیر را
می‌سازد:

- `app_viana_oauth_flows`: hashهای state و browser binding، verifier و انقضا
- `app_viana_identities`: snapshot شش فیلد UserInfo با unique key روی
  `(provider, client_id, subject)`
- `app_auth_sessions`: hash شناسه نشست، hash CSRF، idle activity و absolute
  expiry

bootstrap دیتابیس نیز همین schema را با `CREATE TABLE IF NOT EXISTS` تضمین
می‌کند. در deployment چندنمونه‌ای، همین دیتابیس storage مشترک flow و session
است.

## رفتار امنیتی

- code exchange هیچ retry ندارد؛ UserInfo که GET و safe است حداکثر یک retry
  کوتاه برای خطاهای retryable دارد.
- callback پیش از خواندن `error` یا `code`، state و browser binding را
  transactionally مصرف می‌کند.
- access token فقط تا پایان UserInfo در حافظه همان callback وجود دارد و
  persist، log یا return نمی‌شود.
- session cookie در production دارای `HttpOnly`, `Secure`, `SameSite=Lax`,
  `Path=/api`، idle timeout برابر ۲۴ ساعت و absolute timeout برابر ۳۰ روز است.
- CSRF token برای تمام عمر نشست ثابت است. mutationهای cookie-authenticated به
  Origin دقیق allowlist و `X-CSRF-Token` نیاز دارند. Bearer-only از CSRF معاف
  است.
- Bearer و cookie مستقل validate می‌شوند. credential نامعتبر کنار credential
  معتبر رد می‌شود؛ دو principal متفاوت با `AUTHENTICATION_AMBIGUITY` رد
  می‌شوند.
- frontend Bearer قدیمی را فقط پس از مشاهده نشست موفق Viana در
  `/api/auth/session` پاک می‌کند. شروع flow، لغو consent یا شکست callback نشست
  OTP را پاک نمی‌کند.
- Nginx برای callback access log را خاموش می‌کند و backend فقط path بدون query
  را log می‌کند.

## اجرا و بررسی محلی

پس از قرار دادن credential توسعه در `backend/.env` نادیده‌گرفته‌شده و فعال
کردن feature:

```powershell
cd backend
npm run dev
```

```powershell
cd frontend
npm run dev
```

callback توسعه باید عیناً برای همان client ثبت شده باشد. با تنظیم فعلی،
`/api/auth/viana/start` کاربر را به `https://vianaland.ir/oauth/continue`
می‌فرستد و callback همچنان به Danoa محلی روی `localhost:5173` برمی‌گردد.

آزمون‌های repository-local:

```powershell
cd backend
npm run test:auth
```

```powershell
cd frontend
npm test
npm run build
```

## rollout و rollback

دامنه‌های عمومی production مشخص شده‌اند. blocker باقی‌مانده ساخت یک client
مجزای production در پنل Viana است:

- Name: `Danoa Production`
- Domain: `https://danoa.ir`
- Redirect URI: `https://danoa.ir/api/auth/viana/callback`

کلاینت development که callback آن `localhost` است نباید تغییر داده یا در
production استفاده شود. پس از ساخت کلاینت جدید، Client ID و Client Secret آن
فقط در `/opt/chatbot/.env` قرار می‌گیرند و برنامه restart می‌شود. تا پیش از
رسیدن credential جدید، env فعال بالا نباید روی سرور نصب شود؛ سرور فعلی باید
feature را خاموش نگه دارد.

rollout پس از migration و smoke test انجام می‌شود. URL خروجی `/start` باید با
`https://vianaland.ir/oauth/continue?response_type=code` شروع شود و
`redirect_uri=https%3A%2F%2Fdanoa.ir%2Fapi%2Fauth%2Fviana%2Fcallback` داشته
باشد. rollback فقط خاموش کردن `VIANA_OAUTH_ENABLED` است؛ جدول‌های افزایشی برای
جلوگیری از حذف داده باقی می‌مانند و OTP بدون تغییر به کار ادامه می‌دهد.
