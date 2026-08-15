# وضعیت فعلی قابلیت‌های محصول

> وضعیت: ✅ snapshot اجرایی — بازبینی: ۲۰۲۶-۰۸-۱۵

این سند تفاوت بین قابلیت‌های موجود در کد و تصمیم‌های آینده را شفاف می‌کند. «موجود» به معنی وجود مسیر اجرایی در repository است؛ فعال بودن در production ممکن است به env، migration، provider یا نقش admin وابسته باشد.

## ماتریس قابلیت‌ها

| قابلیت | وضعیت | توضیح |
|---|---|---|
| لندینگ RTL و responsive | ✅ | در frontend پیاده‌سازی شده |
| ورود با شماره موبایل و OTP | ✅ | routeهای canonical در `modules/auth` |
| تشخیص login/signup | ✅ | بعد از phone status و verify |
| profile نام و سن | ✅ | برای کاربر جدید اجباری است |
| Sign in with Viana | ⚠️ | نیازمند فعال‌سازی و credential/provider |
| چت فارسی | ✅ | `/api/chat` با prompt و history |
| chat streaming | ✅ | NDJSON و turn/attempt persistence |
| intent routing | ✅ | chat، image، vision و video |
| حافظه گفتگو | ✅ | DB metadata + storage فایل |
| عنوان خودکار گفتگو | ✅ | قابل فعال/غیرفعال با config |
| upload و تحلیل تصویر | ✅ | `/api/vision` و pipeline vision-chat |
| تولید تصویر | ✅ | task async، status، gallery و serve |
| ویرایش تصویر | ✅ | با تصویر قبلی/ورودی و idempotency |
| تولید ویدیو | ⚠️ | به migration، routing، provider، worker و flag وابسته است |
| worker ویدیو | ⚠️ | embedded یا disabled، وابسته به env |
| کیف پول نوآ | ✅ | wallet، ledger، reservation و receipt |
| پرداخت آنلاین | ⚠️ | تنظیمات provider پرداخت در env موجود است؛ فعال‌سازی باید جداگانه تایید شود |
| پنل مدیریت | ✅ | auth، dashboard، کاربران، تنظیمات، logs و moderation |
| AI routing admin | ✅ | provider/model/route/health/audit |
| supervised OTP | ✅ | با role مناسب admin |
| monitor Bale | ⚠️ | با `BALE_MONITOR_ENABLED` و تنظیمات provider |
| Design System | ⚠️ | بنیاد پایدار، adoption کامل نشده است |

## وابستگی‌های انتشار

### برای chat

- دیتابیس آماده
- `AUTH_JWT_SECRET`
- provider مدل و `METIS_*`
- تنظیمات prompt و billing نوآ

### برای image

- migrationهای image studio
- provider/model image
- storage قابل نوشتن
- quota و pricing نوآ

### برای video

- migrationهای 026 تا migrationهای routing/prompt profile
- BananaAI یا provider فعال و allowlist نتیجه
- input gateway و signing secret
- worker و storage volume
- quota روزانه و billing
- readiness check قبل از live test

## تصمیم‌های باز محصولی

موارد زیر نباید با حدس در کد نهایی شوند:

- policy قطعی سن، guardian و consent.
- سیاست moderation بحران و escalation انسانی.
- retention نهایی conversation، image و video.
- قیمت نهایی عملیات و قوانین refund.
- KPI و SLA انتشار عمومی.
- provider/fallback نهایی هر capability.

برای تصمیم‌های باز، PRD مرجع [docs/prd/README.md](./prd/README.md) است. تا زمان تصمیم، interface و config قابل تغییر نگه داشته شود.

## شاخص‌های پیشنهادی پایش

- نرخ تکمیل OTP و نرخ خطای verify.
- p50/p95 زمان پاسخ chat و vision.
- نرخ موفقیت و زمان تولید image/video.
- تعداد jobهای stuck و reservationهای unresolved.
- مصرف نوآ به تفکیک action.
- نرخ خطای provider و fallback.
- خطاهای authorization و moderation.

