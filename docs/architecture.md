# معماری پروژه (Baseline v1)

این سند baseline فعلی معماری را مشخص می‌کند تا refactorها مرحله‌ای، کم‌ریسک و قابل review بمانند.

## اهداف

- حفظ رفتار فعلی سیستم (Behavior-Preserving)
- کوچک‌سازی ریسک تغییرات با PRهای مستقل
- شفاف‌سازی مرز ماژول‌ها و وابستگی‌ها

## نمای کلی

- Frontend: `frontend/` (React + Vite + TypeScript)
- Backend: `backend/` (Node.js + Express)
- Backend Entry: `backend/src/server.js`
- Data Access: `backend/src/repositories`
- Business Modules: `backend/src/modules/*`

## Backend layering

### 1) Composition/Bootstrap layer

- محل: `backend/src/server.js` و `backend/src/bootstrap/*`
- مسئولیت:
  - بارگذاری env/config
  - ساخت dependencyها (service/repository/client)
  - mount کردن route/moduleها
- ممنوع:
  - قرار دادن business logic دامنه‌ای داخل bootstrap

### 2) Modules layer

- محل: `backend/src/modules/*`
- مسئولیت:
  - use-case های دامنه
  - validation و orchestration
- ماژول‌ها باید به repository/service abstraction تکیه کنند، نه جزئیات infra.

### 3) Repository layer

- محل: `backend/src/repositories/*`
- مسئولیت:
  - دسترسی مستقیم به DB
  - ایزوله کردن SQL/Query concerns از moduleها

## Frontend layering

- Design System: `frontend/src/design-system/*`
- Feature/UI Screens: `frontend/src/*.tsx`

قاعده:
- DS باید library-agnostic بماند.
- Featureها تا حد ممکن از primitives DS استفاده کنند.
- migration به DS مرحله‌ای انجام شود، بدون تغییر business behavior.

## Stage 5 outcome (Frontend guardrails + DS adoption hardening)

### Guardrails

1. تمام کنترل‌های interactive جدید در featureها باید ابتدا با DS primitives بررسی شوند.
2. در صورت نبود primitive مناسب، اول RFC کوتاه ثبت شود (نیاز، API, A11y) و سپس در PR جداگانه اضافه شود.
3. برای migration سطح UI:
   - تغییر فقط در لایه presentation
   - عدم تغییر handler/API/state مگر با تایید صریح
4. CSS جدید برای DS باید در `frontend/src/design-system/styles/*` بماند؛
   CSS feature-specific (مثل `App/AdminPanel`) فقط scoped باشد.
5. هر PR فرانت باید `npm run build` را پاس کند و حداقل یک manual flow checklist داشته باشد.

### DS Adoption Checklist (اجرایی)

- Surface انتخابی کوچک و قابل rollback است.
- Raw controls (`button/input/textarea/select`) در همان surface شمارش و ثبت شده‌اند.
- جایگزینی فقط با primitives موجود DS انجام شده است.
- پیام‌های کمک/خطا تا حد ممکن با `InlineMessage` و props استاندارد (`errorText/helperText`) همگرا شده‌اند.
- keyboard/focus/aria بعد از migration دستی بررسی شده است.
- CSS فقط scoped به همان surface تغییر کرده است.

## Rules for next PRs

1. هر PR فقط یک هدف معماری مشخص داشته باشد.
2. تغییرات behavior/API فقط با تایید صریح.
3. هر refactor باید با build-safe بودن همراه باشد.
4. module boundary شکسته نشود (import مستقیم cross-layer بدون دلیل ممنوع).

## Roadmap کوتاه (۵ مرحله)

1. Baseline docs + guardrails
2. Server composition cleanup (safe extraction)
3. Admin boundary hardening
4. Legacy service consolidation
5. Frontend architecture guardrails + DS adoption hardening

## Stage 4 outcome (Legacy service consolidation)

- مسیر canonical برای OTP/SMS:
  - `backend/src/modules/sms/sms.service.js`
- فایل‌های legacy در `backend/src/services` باید فقط برای migration history نگه‌داری شوند و مقصد توسعه جدید نیستند.
