# گزارش تأیید آفلاین Video Prompt Profiles

تاریخ: 2026-07-23

## خروجی

- دو Profile `cinematic` و `animation` از فایل‌های canonical seed شدند.
- Migration 035 additive/idempotent است و Route/Provider تولید را تغییر نمی‌دهد.
- Versioning immutable، optimistic lock، checksum و Audit پیاده‌سازی شد.
- Prompt Compiler نسخه ۲ کاملاً محلی و deterministic است، متن کامل TXT نسخه‌شده را واقعاً در Prompt نهایی قرار می‌دهد و قواعد canonical را non-removable نگه می‌دارد.
- Submit، Prompt Snapshot را در Transaction موجود Job/Quota/Route/Attempt ثبت می‌کند.
- Worker فقط `compiled_prompt` ذخیره‌شده را مصرف می‌کند و در نبود آن I2V را پیش از Provider رد می‌کند.
- Public API و UI، Provider/Model/System/Compiled Prompt را پنهان می‌کنند.
- Studio دارای انتخاب دو سبک، تصویر اجباری، Form، Review و Submit است.
- Admin دارای metadata، Version، checksum، job count، Preview و Audit است.

## Gateها

- Backend: 238/238 passed
- Frontend: 73/73 passed
- Build: passed
- Database migration/readiness invariants: passed (`promptProfilesReady=true`, `grokImageToVideoPinned=true`, `externalRequests=0`)
- Full operational readiness: blocked by local legacy Metis result allowlist and the not-yet-configured BananaAI key/result allowlist/input gateway.
- Secret scan: passed (95 changed files, 0 suspicious files)
- Diff check: passed

## وضعیت عملیاتی

مدل خصوصی `grok-imagine-video` تنها مدل فعال محلی I2V است و مقصد Route نیز به آن Pin شده است. BananaAI Provider و خود Route تا زمان تنظیم API Key، Gateway معتبر و allowlist میزبان خروجی همچنان Admin-gated و غیرفعال می‌مانند. Host خروجی BananaAI و Gateway production همچنان `BLOCKED_NEEDS_LIVE_VALIDATION`/`BLOCKED` هستند؛ برای رفع آن‌ها هیچ درخواست واقعی انجام نشد.

BananaAI external requests: 0

Metis video external requests: 0

Other provider external requests: 0

Live test executions: 0

Deployments: 0

VPS connections: 0
