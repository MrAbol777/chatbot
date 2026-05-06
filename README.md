دانوآ (چت‌بات فارسی کودک و نوجوان)

یک چت‌بات امن و دوستانه برای سنین ۸ تا ۱۸ سال با `React + TypeScript + Vite` در فرانت‌اند و `Node.js + Express` در بک‌اند.

## امکانات اصلی

- ورود/ثبت‌نام با شماره موبایل و کد تأیید
- ذخیره پروفایل، مکالمه‌ها و تنظیمات در `localStorage`
- مدیریت مکالمه‌ها (گفتگوی جدید، سنجاق، تغییر نام، حذف)
- ورودی صوتی فارسی با Web Speech API (`fa-IR`)
- پشتیبانی از انتخاب تم (`energy` و `calm`)
- امکان انتخاب تصویر از UI چت (پیش‌نمایش و حذف قبل از ارسال)
- رابط RTL واکنش‌گرا با طراحی مناسب کودک/نوجوان

## تغییرات جدید

- مهاجرت سرویس مدل از GapGPT به Gemini (از طریق `GEMINI_BASE_URL`)
- اضافه شدن احراز هویت پیامکی در بک‌اند:
  - `POST /api/send-verification-code`
  - `POST /api/verify-code`
  - `POST /api/register-profile`
- اضافه شدن `GET /api/admin/stats` با `ADMIN_API_KEY`
- اضافه شدن اسکریپت توسعه با لاگ فایل (`logs/terminal.txt`)

## ساختار پروژه

```text
project-root/
├── frontend/
├── backend/
├── logs/
├── scripts/
├── package.json
└── README.md
```

## پیش‌نیازها

- `Node.js` نسخه ۱۸ یا بالاتر
- `npm`

## راه‌اندازی

1) نصب وابستگی‌ها از ریشه پروژه:

```bash
npm run install-all
```

2) ساخت فایل محیطی بک‌اند:

```bash
cp backend/.env.example backend/.env
```

3) تنظیم `backend/.env`:

```env
GEMINI_API_KEY=your_metis_key
GEMINI_BASE_URL=https://api.metisai.ir
GEMINI_MODEL=gemini-2.0-flash
GAPGPT_TIMEOUT_MS=30000
ADMIN_API_KEY=your-secret-key
PORT=3001
```

4) اجرای همزمان فرانت و بک‌اند:

```bash
npm run dev
```

- فرانت‌اند: `http://localhost:5173`
- بک‌اند: `http://localhost:3001`

## اسکریپت‌ها

### ریشه پروژه

- `npm run install-all`: نصب وابستگی‌های `frontend` و `backend`
- `npm run dev`: اجرای همزمان دو سرویس + ثبت لاگ در `logs/terminal.txt`

### frontend

- `npm run dev`
- `npm run build`
- `npm run preview`

### backend

- `npm run dev`
- `npm run start`

## نکات

- فرانت‌اند هیچ API Key نگه نمی‌دارد و فقط به API بک‌اند درخواست می‌فرستد.
- بک‌اند برای هر پیام، پرامپت پویا بر اساس پروفایل و تاریخچه می‌سازد.
- برای ورودی صوتی، مرورگر باید دسترسی میکروفون داشته باشد.
