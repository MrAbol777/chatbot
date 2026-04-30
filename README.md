# همراز (Hemraz)

یک چت بات فارسی امن و صمیمی برای سنین 8 تا 18 سال، ساخته شده با React + TypeScript + Vite در فرانت اند و Node.js + Express در بک اند.

## امکانات اصلی

- ثبت نام کاربر با نام، سن (8 تا 18) و جنسیت اجباری
- ذخیره پروفایل و تاریخچه گفتگوها در `localStorage`
- مدیریت کامل گفتگوها (گفتگوی جدید، سنجاق، تغییر نام، حذف)
- ورودی صوتی فارسی با Web Speech API (`fa-IR`)
- ارسال پیام به بک اند و پراکسی به GapGPT API
- رابط کاربری RTL با طراحی شاد، مدرن و واکنش گرا

## ساختار پروژه

```
project-root/
├── frontend/
├── backend/
├── package.json
├── README.md
└── .gitignore
```

## پیش نیازها

- Node.js نسخه 18 یا بالاتر
- npm

## راه اندازی

1. نصب وابستگی ها از ریشه پروژه:

```bash
npm run install-all
```

2. ساخت فایل محیطی بک اند:

```bash
cp backend/.env.example backend/.env
```

3. مقداردهی `backend/.env`:

```env
GAPGPT_API_KEY=your_real_key
GAPGPT_BASE_URL=https://api.gapgpt.app/v1
GAPGPT_MODEL=gpt-4o
PORT=3001
```

4. اجرای هم زمان فرانت و بک اند:

```bash
npm run dev
```

- فرانت اند: `http://localhost:5173`
- بک اند: `http://localhost:3001`

## اسکریپت ها

### ریشه پروژه

- `npm run install-all`: نصب وابستگی های `frontend` و `backend`
- `npm run dev`: اجرای هم زمان هر دو سرویس

### frontend

- `npm run dev`
- `npm run build`
- `npm run preview`

### backend

- `npm run dev`
- `npm run start`

## نکات

- فرانت اند هیچ API Key نگه نمی دارد و فقط به `/api/chat` درخواست می فرستد.
- بک اند سیستم پرامپت پویا می سازد و پاسخ آماده یا از پیش نوشته را هاردکد نمی کند.
- برای استفاده از ورودی صوتی، مرورگر باید دسترسی میکروفن داشته باشد.
