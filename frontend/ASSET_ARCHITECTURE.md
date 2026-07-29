# معماری فایل‌های ثابت فرانت‌اند

این پروژه از قرارداد استاندارد Vite برای assetها استفاده می‌کند:

- `src/assets/`: فایل‌هایی که فقط داخل کامپوننت‌ها یا CSS مصرف می‌شوند. Vite آن‌ها را import، hash و optimize می‌کند.
- `public/`: فایل‌هایی که باید URL ثابت داشته باشند یا خارج از گراف ماژول React مصرف شوند؛ مثل favicon، manifest، robots و تصویر اشتراک‌گذاری.
- `src/config/publicAssets.ts`: تنها محل ساخت URL فایل‌های `public` در کد React. این helper مقدار `BASE_URL` را رعایت می‌کند.

## ساختار

```text
public/
├── brand/
│   └── danoa-avatar.png
├── fonts/
│   └── iransens/
│       ├── IRANSansWeb_Regular.woff2
│       └── ...
├── icons/
│   └── danoa-mark.svg
├── robots.txt
└── site.webmanifest
```

## قواعد نگهداری

1. فایل component-specific را مستقیماً از `src/assets` import کنید.
2. فایل public را با مسیر پراکنده و hard-coded در کامپوننت‌ها مصرف نکنید؛ آن را به `PUBLIC_ASSETS` اضافه کنید.
3. نام فایل‌های public باید توصیفی، lowercase و kebab-case باشد.
4. secret، فایل runtime، خروجی build، screenshot تست و source map خصوصی نباید وارد `public` شوند؛ همه محتوای این پوشه مستقیماً قابل دانلود است.
5. پس از تغییر assetها، `npm run check:assets` و سپس `npm run build` را اجرا کنید.
6. فونت سراسری در `src/styles/fonts.css` تعریف و از طریق توکن‌های `--font-family-base` و `--font-family-heading` مصرف می‌شود.
