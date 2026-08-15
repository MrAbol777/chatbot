# راهنمای Frontend و Design System

> وضعیت: ⚠️ مهاجرت مرحله‌ای — بازبینی: ۲۰۲۶-۰۸-۱۵

## ساختار frontend

| مسیر | مسئولیت |
|---|---|
| `src/App.tsx` | shell و تجربه اصلی chat/auth |
| `src/Landing.tsx` | لندینگ و ورود به محصول |
| `src/ImageStudio.tsx` و `src/services/imageGeneration.ts` | استودیو تصویر |
| `src/video-generation/` | صفحه، service، فرم، gallery و player ویدیو |
| `src/noa/` | wallet کاربر و serviceهای نوآ |
| `src/admin/` | تب‌ها و مدل‌های پنل مدیریت |
| `src/auth/` | session و احراز هویت |
| `src/design-system/` | token، primitive و preview |
| `src/components/` | componentهای مشترک خارج از DS |

## Design System فعلی

Primitiveهای موجود:

- `Button`
- `TextField`
- `TextAreaField`
- `Card`
- `FieldGroup`
- `InlineMessage`
- `Dialog`
- `Toast`

tokenها در `src/design-system/tokens/tokens.css` قرار دارند: رنگ، typography، spacing، radius، shadow، z-index و motion.

## قواعد UI

- root با RTL اجرا می‌شود؛ spacing جدید ترجیحاً logical باشد.
- کنترل interactive جدید ابتدا باید primitive مناسب DS را بررسی کند.
- هر `iconOnly` button باید `aria-label` صریح داشته باشد.
- رنگ و فاصله جدید را hard-code نکنید؛ از semantic token استفاده کنید.
- CSS feature-specific باید scoped باشد و روی DOM legacy leak نکند.
- migration به DS فقط presentation را تغییر دهد و business logic را دست‌نخورده بگذارد.

## وضعیت مهاجرت

بخش‌های auth، landing actions، profile dialog، admin login و تعدادی از actionها به DS منتقل شده‌اند. chat composer و برخی کنترل‌های admin هنوز legacy هستند؛ به‌دلیل وابستگی CSS و رفتار animation، migration آن‌ها باید مرحله‌ای باشد.

## الگوی افزودن component

1. API و نیاز accessibility را مشخص کنید.
2. component را در `src/design-system/components/` بسازید.
3. style را با token در `styles/components.css` اضافه کنید.
4. export را در `components/index.ts` قرار دهید.
5. preview مسیر `/design-system-preview` را به‌روزرسانی کنید.
6. هر دو theme و keyboard behavior را تست کنید.
7. `frontend/DESIGN_SYSTEM.md` را به‌روزرسانی کنید.

## انتشار frontend

```bash
npm run build --prefix frontend
npm run preview --prefix frontend
```

در production build frontend از طریق backend static serve می‌شود؛ اگر deployment جداگانه انجام شد، proxy مسیرهای `/api` و fallback مسیرهای SPA باید حفظ شوند.

