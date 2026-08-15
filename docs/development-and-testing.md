# راهنمای توسعه و تست

> وضعیت: ✅ مرجع توسعه — بازبینی: ۲۰۲۶-۰۸-۱۵

## قرارداد کار روی repository

- تغییرات نامرتبط موجود در worktree را بازنویسی نکنید.
- secret و فایل `.env` واقعی را commit نکنید.
- migrationهای اجراشده را edit نکنید؛ migration جدید اضافه کنید.
- API و behavior موجود را بدون تصمیم صریح تغییر ندهید.
- برای هر تغییر UI، RTL، keyboard و هر دو theme را بررسی کنید.

## build و lint پایه

پروژه lint script مرکزی ندارد؛ حداقل validation فعلی:

```bash
npm run build --prefix frontend
npm run check:assets --prefix frontend
```

`prebuild` بررسی assetهای public را اجرا می‌کند و سپس TypeScript/Vite build انجام می‌شود.

## تست frontend

```bash
npm test --prefix frontend
npm run test:video-generation --prefix frontend
npm run test:video-generation-coverage --prefix frontend
```

تست‌ها با Vitest، Testing Library و jsdom اجرا می‌شوند. تست‌های مهم شامل auth/admin، landing، wallet، image و video generation هستند.

## تست backend

```bash
npm run test:auth --prefix backend
npm run test:stream --prefix backend
npm run test:noa --prefix backend
npm run test:title --prefix backend
npm run test:video-generation --prefix backend
npm run test:video-generation-security --prefix backend
npm run test:video-generation-integration --prefix backend
```

بخشی از تست‌ها با `test-network-guard.js` از درخواست ناخواسته به اینترنت جلوگیری می‌کنند. تست‌های DB integration به MySQL/MariaDB و env مناسب نیاز دارند.

## checklist قبل از merge

### Backend

- [ ] مسیر جدید authentication و authorization درست دارد.
- [ ] ورودی با schema/validator بررسی شده است.
- [ ] timeout، retry، idempotency و خطای provider مشخص است.
- [ ] billing در مسیر درست reserve/capture/release شده است.
- [ ] داده حساس وارد response یا log نشده است.
- [ ] migration idempotent و backward-compatible است.
- [ ] تست واحد و در صورت نیاز integration اضافه شده است.

### Frontend

- [ ] build و تست‌های مربوط پاس هستند.
- [ ] حالت loading، empty، error و retry بررسی شده است.
- [ ] keyboard/focus/aria بررسی شده است.
- [ ] RTL و themeهای `energy` و `calm` بررسی شده‌اند.
- [ ] رفتار موبایل و دسکتاپ بررسی شده است.
- [ ] retry درخواست‌های مصرفی از همان idempotency key استفاده می‌کند.

## تست دستی smoke

1. landing → login/signup.
2. OTP اشتباه، OTP منقضی و retry-after.
3. کاربر جدید → نام و سن → session.
4. کاربر قدیمی → ورود مستقیم بدون profile form.
5. چت معمولی، چت stream و cancel.
6. attach تصویر → upload → vision.
7. generate/edit تصویر و مشاهده history.
8. ایجاد/rename/pin/delete conversation.
9. wallet، ثبت receipt و نمایش transaction.
10. ورود ادمین، dashboard، users، moderation و audit.
11. video options، submit با idempotency، polling، play/download.

## طراحی تست برای providerها

- unit test باید adapter، parser، validation و failure mode را بدون network پوشش دهد.
- live test فقط با flag صریح، quota محدود و secret محیط تست اجرا شود.
- نتیجه provider در storage با allowlist و سقف حجم بررسی شود.
- برای عملیات غیرقابل بازگشت از fixture و fake provider استفاده شود.

