# Services وضعیت و مسیر رسمی (Stage 4)

این پوشه شامل چند فایل قدیمی/آزمایشی است. برای جلوگیری از ابهام:

## مسیر رسمی فعلی (Canonical)

- سرویس OTP/SMS عملیاتی باید از ماژول زیر مصرف شود:
  - `backend/src/modules/sms/sms.service.js`
- اتصال route رسمی:
  - `backend/src/modules/sms/sms.routes.js`
  - mount در `backend/src/server.js`

## فایل‌های Legacy در این پوشه

- `smsService.js`
- `sms.service.js`
- `sms.service.ts`
- `otp.service.ts`
- `testSMS.js`

این فایل‌ها در مسیر runtime اصلی backend مرجع canonical نیستند و باید به‌صورت تدریجی deprecate/حذف شوند.

## Rule برای PRهای بعدی

1. برای feature جدید SMS/OTP فقط `modules/sms` را تغییر بدهید.
2. اگر نیاز به cleanup است، در PR جداگانه با migration note انجام شود.
3. تا قبل از حذف کامل، هیچ import جدیدی به فایل‌های legacy اضافه نشود.
