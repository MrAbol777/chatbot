# امنیت، حریم خصوصی و ایمنی محصول

> وضعیت: ⚠️ نیازمند بازبینی دوره‌ای — بازبینی: ۲۰۲۶-۰۸-۱۵

دانوآ با کاربر کودک و نوجوان کار می‌کند؛ امنیت فقط به authentication محدود نیست و شامل حریم خصوصی، کنترل provider، moderation، billing و ایمنی پاسخ نیز می‌شود.

## احراز هویت

- OTP باید rate limit، expiry و محدودیت تلاش ناموفق داشته باشد.
- پس از verify موفق، OTP مصرف و invalid می‌شود.
- signup token کوتاه‌عمر است و فقط برای تکمیل profile همان شماره معتبر است.
- token کاربر و admin secret مستقل دارند.
- session cookie باید `httpOnly`، `sameSite` و در production `secure` باشد.
- Viana flow از state، browser binding، PKCE و OIDC nonce استفاده می‌کند.

## مجوز و مالکیت

- هر endpoint user-facing باید principal را از session/Bearer resolve کند.
- قبل از خواندن یا حذف conversation، image، video یا receipt، مالکیت بررسی شود.
- مسیر admin فقط با admin auth و در عملیات حساس با role guard قابل دسترسی است.
- `ADMIN_API_KEY` برای مسیرهای legacy نباید جایگزین session مناسب برای پنل شود.

## CSRF و origin

- originهای مجاز در `APP_ALLOWED_ORIGINS` دقیق و بدون path تعریف شوند.
- درخواست‌های state-changing با cookie باید از CSRF protection عبور کنند.
- callbackهای OAuth فقط به مسیر local مورد تایید redirect شوند.

## secret و provider

- API key فقط در backend و secret manager/env امن باشد.
- provider URL، token و خطای خام provider در frontend برگردانده نشود.
- logها باید request id و metadata غیرحساس داشته باشند؛ body کامل پیام یا token را بی‌دلیل ثبت نکنند.
- کلیدهای افشاشده باید rotate شوند و در release جدید قرار نگیرند.

## فایل و SSRF

- نوع و حجم فایل upload محدود است.
- media ویدیو از host/path allowlist دانلود می‌شود.
- redirect خارجی محدود و سقف bytes enforce می‌شود.
- input provider با URL امضاشده و TTL کوتاه ارائه می‌شود.
- مسیر فایل از ورودی کاربر ساخته نشود و filename برای path traversal استفاده نشود.

## داده کودک و حریم خصوصی

- حداقل داده لازم برای profile نگهداری شود.
- guardian، child و consent باید در مدل داده و policy محصول روشن باشند.
- export، حذف و retention داده باید با تصمیم مالک محصول و الزامات قانونی هماهنگ باشد.
- حافظه گفتگو و فایل‌های آپلودشده دسترسی خصوصی داشته باشند.
- داده‌های آموزشی/حساس کودک بدون policy صریح به provider خارجی ارسال نشود.

## ایمنی پاسخ AI

- intentهای خطرناک یا نامناسب باید با safe alternative پاسخ بگیرند.
- سن پروفایل و context کاربر در prompt و policy لحاظ شود.
- پاسخ provider بدون validation و کنترل محتوایی مستقیماً به کاربر نمایش داده نشود.
- رخدادهای moderation و escalation برای بررسی admin قابل مشاهده باشند.

## billing و جلوگیری از سوءاستفاده

- مصرف قبل از عملیات reserve و فقط بعد از خروجی معتبر capture شود.
- در failure قبل از تولید خروجی release انجام شود.
- retry کلاینت با idempotency key انجام شود.
- reservation، ledger و manual adjustment باید audit داشته باشند.
- quotaها برای chat، image و video در مسیر server enforce شوند؛ UI فقط نمایش‌دهنده است.

## چک‌لیست release امنیتی

- [ ] secret جدید تصادفی و خارج از Git است.
- [ ] production با HTTPS و cookie secure اجرا می‌شود.
- [ ] `LOCAL_DEV_SESSION_ENABLED=false` است.
- [ ] CORS/origin محدود است.
- [ ] admin path و credentialهای جداگانه تنظیم شده‌اند.
- [ ] upload، SSRF، redirect و حجم فایل تست شده‌اند.
- [ ] log و error response فاقد secret هستند.
- [ ] backup و retention تایید شده است.
- [ ] smoke test authorization برای user A/B و admin اجرا شده است.

