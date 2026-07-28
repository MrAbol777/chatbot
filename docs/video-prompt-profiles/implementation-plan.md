# برنامه اجرایی Video Prompt Profiles

قانون اجرا: همه توسعه و آزمون‌ها آفلاین‌اند؛ Worker واقعی، Provider API، Deploy و VPS در این مأموریت اجرا نمی‌شوند.

| ID | کار | وابستگی | ریسک اصلی | آزمون/Gate | وضعیت |
|---|---|---|---|---|---|
| VPP-01 | تثبیت فایل‌های مرجع cinematic/animation و قرارداد Compiler | — | تغییر ناخواسته متن مرجع | checksum و no-guess tests | DONE |
| VPP-02 | Migration 035 برای Profile، Version، Audit و Job Snapshot | VPP-01 | ناسازگاری با DB موجود | migration idempotency tests | DONE |
| VPP-03 | Repository و سرویس Versioning با optimistic lock | VPP-02 | overwrite نسخه قدیمی | repository transaction tests | DONE |
| VPP-04 | `VideoPromptCompiler` محلی و deterministic | VPP-01 | حذف قواعد پایه یا prompt injection | compiler unit tests | DONE |
| VPP-05 | Public/Admin API و preview آفلاین | VPP-03,VPP-04 | افشای system/compiled prompt | auth/redaction tests | DONE |
| VPP-06 | اتصال Submit اتمیک به Profile و Prompt Snapshot | VPP-03,VPP-04 | Job بدون snapshot یا دوباره‌compile | service/DB tests | DONE |
| VPP-07 | مصرف فقط `compiled_prompt` توسط Worker/Adapter | VPP-06 | ارسال prompt خام | worker/provider mock tests | DONE |
| VPP-08 | Studio I2V: انتخاب سبک، تصویر اجباری و تنظیمات مشترک Route | VPP-05 | نمایش Provider/Model یا گزینه نامعتبر | RTL/a11y/interaction tests | DONE |
| VPP-09 | Admin UI مدیریت Profile/Version/Preview/Audit | VPP-05 | ویرایش نسخه قبلی | admin interaction tests | DONE |
| VPP-10 | Regression، Build، Readiness و Secret Scan | همه | خرابی Routing/Nano Banana | backend/frontend/build/readiness/scan | DONE |

## تصمیم‌های معماری

- Profile و Version در ماژول `video-prompt-profiles` قرار می‌گیرند؛ Routing Core از محتوای Prompt بی‌خبر می‌ماند.
- متن کامل مرجع immutable در Version ذخیره می‌شود و هر تغییر، Version جدید می‌سازد.
- Compiler فقط از داده Version و تنظیمات Job استفاده می‌کند، هیچ Client شبکه یا Secret دریافت نمی‌کند.
- API عمومی فقط metadata عمومی Profile را برمی‌گرداند؛ جزئیات Prompt فقط پشت Admin authorization قابل مشاهده است.
- Jobهای قدیمی فقط Snapshot خود را مصرف می‌کنند؛ Worker Profile جاری را resolve یا compile نمی‌کند.

## نتیجه Gateها

- Backend: 238/238
- Frontend: 73/73
- Frontend Build: موفق
- Database readiness: موفق؛ دو Profile آماده‌اند، Grok تنها مدل فعال خصوصی I2V است و Route غیرفعال به آن Pin شده است.
- Operational readiness: تا اصلاح allowlist قدیمی Metis و تنظیم BananaAI key/result allowlist/input gateway مسدود است؛ `externalRequests=0`.
- Secret scan: 95 فایل تغییرکرده بررسی شد، مورد مشکوک صفر
- `git diff --check`: موفق (صرفاً هشدار line-ending محیط Windows)
