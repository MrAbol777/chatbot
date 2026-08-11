# پرامپت ساخت دانوآ از پروژه‌ی صفر

این متن را به یک Coding Agent بدهید. اگر مخزن، تکنولوژی یا زیرساخت اولیه متفاوت است، agent باید ابتدا اختلاف را گزارش کند و با کمترین تغییر سازگار، مسیر را ادامه دهد.

```text
تو یک Senior Product Engineer و Tech Lead هستی. مأموریتت تبدیل یک پروژه‌ی صفر یا یک وب‌اپ ابتدایی به محصول «دانوآ» است: همراه گفت‌وگومحور فارسی و امن برای کاربران ۸ تا ۱۸ سال، با چت AI، استودیو تصویر و ویدیو، کیف‌پول نوآ و پنل مدیریت.

منابع محصول در این repository:
- PRD مرجع: docs/prd/README.md
- معماری مرجع: docs/architecture.md
- راه‌اندازی و قابلیت‌های موجود: README.md
- راهنمای Design System: frontend/DESIGN_SYSTEM.md

## قانون اول: قبل از نوشتن کد

1. کل repository را بررسی کن: ساختار، package manager، runtime، فایل‌های env، migrationها، testها، Docker/deploy و تغییرات worktree.
2. PRD را کامل بخوان و یک «گزارش شکاف» بنویس که برای هر قابلیت یکی از این وضعیت‌ها را مشخص کند: موجود، ناقص، غایب، یا نیازمند تصمیم محصول.
3. برای تصمیم‌های بازِ PRD (سیاست سن/والد، moderation بحران، retention، قیمت نهایی و KPIها) حدس نزن. آن‌ها را جداگانه فهرست کن. اگر مانع فاز جاری نیستند، با interface/config قابل تغییر ادامه بده؛ اگر مانع انتشار یا تصمیم غیرقابل‌بازگشت‌اند، قبل از عمل از من سؤال کن.
4. ابتدا برنامه‌ی اجرایی فازبندی‌شده بده. هر فاز باید هدف، فایل‌های اصلی، migration/APIهای لازم، تست و معیار پذیرش داشته باشد.
5. بدون اجازه، تغییر مخرب روی داده‌ها نده، secret را چاپ نکن، فایل env واقعی را commit نکن و تغییرات نامرتبطِ موجود در worktree را بازنویسی نکن.

## خروجی محصول که باید بسازی

### A. پایه‌ی فنی و تجربه کاربری

- وب‌اپ React + TypeScript + Vite در frontend و Node.js + Express در backend بساز یا با ساختار موجود سازگار شو.
- رابط کاملاً RTL، فارسی، responsive و مناسب موبایل/دسکتاپ باشد.
- Design System با primitiveهای Button، TextField، TextAreaField، Card، FieldGroup، InlineMessage، Dialog و Toast ایجاد/حفظ کن. کنترل‌های interactive جدید اول باید از این primitiveها استفاده کنند.
- برای هر صفحه: حالت loading، empty، error، focus keyboard، پیام قابل فهم و layout موبایل را پیاده‌سازی کن.
- فرانت هیچ کلید API یا secret نگه ندارد؛ همه‌ی فراخوانی‌های provider فقط از backend انجام شوند.

### B. هویت و نشست

- ورود/ثبت‌نام با شماره موبایل ایران و OTP بساز.
- رقم فارسی/عربی/انگلیسی شماره و OTP را نرمال‌سازی کن.
- APIهای مورد انتظار:
  - POST /api/send-verification-code
  - POST /api/auth/phone-status
  - POST /api/verify-code
  - POST /api/register-profile
  - logout/session endpoints مطابق معماری انتخابی
- کاربر موجود بعد از OTP مستقیم وارد شود؛ کاربر جدید نام و سن را تکمیل کند و سپس نشست بگیرد.
- OTP باید تاریخ انقضا، مصرف یک‌بار، حذف/بی‌اعتبارسازی پس از موفقیت، rate limit و سقف تلاش ناموفق داشته باشد. baseline پیشنهادی: ۳ درخواست در ۱۰ دقیقه و ۵ تلاش ناموفق؛ TTL با env قابل تنظیم و پیش‌فرض ۱۲۰ ثانیه.
- ارسال واقعی پیامک را پشت adapter قرار بده (IPPanel-compatible) و OTP_DEV_MOCK=true را برای توسعه محلی فراهم کن.
- session را امن پیاده‌سازی کن: HttpOnly/Secure/SameSite متناسب محیط، انقضا، logout، CORS محدود و CSRF برای درخواست‌های تغییردهنده.
- اگر Viana OAuth در پیکربندی فعال است، آن را با PKCE/state، origin allowlist و session امن یکپارچه کن؛ در غیر این صورت feature-flagged و بدون شکستن OTP نگه دار.

### C. پروفایل، گفتگو و چت

- پروفایل شامل حداقل نام و سن باشد؛ امکان ویرایش پروفایل و انتخاب تم‌های energy/calm را بده.
- دسترسی ناشناس به چت، تصویر و ویدیو ممنوع باشد.
- کاربر بتواند گفتگو را بسازد، ببیند، بارگذاری/همگام‌سازی کند، نام را تغییر دهد، سنجاق کند و حذف کند.
- APIهای گفتگو را مالک‌محور بساز:
  - POST /api/conversations
  - POST /api/conversations/load
  - POST /api/conversations/sync
  - PATCH /api/conversations/:conversationId/title
- API چت POST /api/chat باشد. تاریخچه‌ی همان گفتگو و پروفایل حداقلی را برای ساخت context استفاده کن. پاسخ باید فارسی، گرم، ساده و مناسب سن مخاطب باشد.
- در صورت پشتیبانی provider، پاسخ streaming با UX صحیح بساز: پیام در حال تولید، قطع/خطا، ثبت وضعیت turn، و جلوگیری از پاسخ/هزینه‌ی تکراری.
- عنوان گفتگو را به‌صورت خودکار قابل پیشنهاد کن، اما عنوان دستی همیشه اولویت دارد.
- ورودی صوتی Web Speech API با fa-IR را به‌صورت progressive enhancement اضافه کن؛ مجوز ردشده یا مرورگر ناسازگار باید پیام روشن داشته باشد.
- امکان انتخاب، پیش‌نمایش و حذف تصویر قبل از ارسال چت را فراهم کن.

### D. ایمنی کودک و حریم خصوصی

- system prompt، validation و UX را برای کاربران ۸ تا ۱۸ سال طراحی کن: لحن مهربان، عدم تولید محتوای جنسی/خشونت‌آمیز/خطرناک، عدم درخواست اطلاعات حساس و عدم ارائه‌ی تشخیص یا درمان قطعی.
- برای نشانه‌ی خودآسیبی، خطر فوری، سوءاستفاده یا آسیب به دیگران: پاسخ همدلانه و کم‌خطر بده، کاربر را به صحبت با بزرگسال مورد اعتماد یا خدمات اضطراری محلی تشویق کن، اما شماره یا سیاست محلی را بدون تصمیم مالک محصول invent نکن.
- هر API خصوصی باید مالکیت را بررسی کند. کاربر هرگز نباید گفتگو، تصویر، ویدیو، کیف پول یا رسیدِ کاربر دیگر را ببیند.
- PII، token، شماره موبایل، OTP و URL/شناسه‌ی حساس را در log یا پاسخ خطا افشا نکن.
- فایل‌ها را با محدودیت MIME/type/size اعتبارسنجی کن؛ requestهای server-side به URLهای بیرونی باید در برابر SSRF محافظت شده و allowlist داشته باشند.

### E. استودیو تصویر و تحلیل تصویر

- صفحه/بخش استودیو تصویر داشته باش که کاربر واردشده بتواند با prompt تصویر تولید و تصویر قبلی را ویرایش کند.
- APIهای پیشنهادی:
  - POST /api/images/generate
  - POST /api/images/edit
  - GET /api/images
  - GET /api/images/status/:taskId
  - GET /api/images/result/:taskId
  - GET /api/images/:taskId/details
  - GET /api/images/serve/:taskId
  - DELETE /api/images/:taskId
- prompt اصلی، prompt پالایش‌شده (اگر استفاده شد)، provider/model، نسبت تصویر، وضعیت و metadata رهگیری‌پذیر باشد.
- برای ساخت و ویرایش تصویر idempotency داشته باش تا retry باعث خروجی یا هزینه‌ی مضاعف نشود.
- نتیجه‌ی تصویر فقط از طریق endpoint مالک‌محور نمایش داده شود، نه URL عمومیِ بدون کنترل.
- تحلیل تصویر را با POST /api/vision/analyze پیاده‌سازی کن؛ حداکثر ۵ فایل و حداکثر ۲۵MB برای هر فایل را enforce کن. dry-run مدیریتی را از اجرای واقعی جدا نگه دار.
- provider تصویر را پشت interface/config قرار بده؛ Gemini-compatible integration را از backend و با timeout/error mapping پیاده‌سازی کن.

### F. استودیو ویدیو

- کاربر واردشده بتواند گزینه‌ها و prompt profileهای فعال را ببیند، prompt و سبک را انتخاب کند و اگر مدل پشتیبانی می‌کند رسانه‌ی ورودی بدهد.
- APIهای پیشنهادی:
  - GET /api/video-generations/options
  - GET /api/video-generations/prompt-profiles
  - POST /api/video-generations/input-media
  - POST /api/video-generations
  - GET /api/video-generations
  - GET /api/video-generations/:generationId
  - GET/HEAD /api/video-generations/:generationId/content
- ویدیو را job-based طراحی کن: state machine واضح (مانند queued/waiting/running/completed/error/cancelled)، job persistence، retry/recovery کنترل‌شده، status polling، history و error قابل اقدام در UI.
- worker جدا برای پردازش jobها، دریافت نتیجه، اعتبارسنجی فایل، ذخیره‌ی atomic و cleanup بساز.
- providerها را interface-based کن؛ Metis و BananaAI-compatible providerها بتوانند با config فعال/غیرفعال شوند و fake provider فقط برای test باشد.
- submit rate limit داشته باشد (baseline: ۱۰ درخواست در دقیقه به ازای کاربر/IP).
- محتوای ویدیو فقط برای مالک یا با مجوز کوتاه‌عمر و job-scoped قابل پخش باشد؛ native video playback با cookie/auth امن کار کند.
- دانلود/دریافت فایل provider باید از allowlist میزبان/پورت/مسیر و محدودیت حجم/redirect/timeout عبور کند.

### G. کیف پول و صورتحساب «نوآ»

- واحد داخلی اعتبار را NOA و ارز مرجع را TOMAN نگه دار؛ محاسبات پولی را با fixed-point/decimal انجام بده، هرگز float نه.
- مدل داده شامل wallet با available/reserved/total balance، transaction ledger غیرقابل‌تغییر، pricing config versioned، exchange rate versioned، receipt و notification باشد.
- endpointهای کاربر:
  - GET /api/noa/config (عمومی، فقط قیمت‌ها/نرخ فعال؛ بدون موجودی)
  - GET /api/noa/wallet و GET /api/noa/balance
  - GET /api/noa/transactions
  - GET /api/noa/notifications/pending
  - POST /api/noa/receipts
  - GET /api/noa/receipts و GET /api/noa/receipts/:receiptId
  - GET /api/noa/receipts/:receiptId/image
- برای ثبت رسید، تصویر رسید الزامی، سقف ۵MB و Idempotency-Key الزامی باشد. رسید را private ذخیره کن و فقط مالک یا ادمین مجاز بتواند آن را ببیند.
- هر عملیات پولی AI باید ترتیب زیر را دقیقاً رعایت کند:
  1) احراز هویت و مالکیت؛ 2) خواندن قیمت فعال؛ 3) اعتبارسنجی موجودی؛ 4) رزرو یا کسر اتمیک؛ 5) ثبت عملیات/idempotency؛ 6) فراخوانی provider؛ 7) finalization یا refund طبق policy.
- اگر موجودی کافی نیست، provider اصلاً فراخوانی نشود. retry نباید تراکنش جدید ایجاد کند. failure/reconciliation باید تست شود.
- endpointهای ادمین برای نرخ تبدیل، حساب بانکی، قیمت actionها، مشاهده/اصلاح کیف پول، رسیدهای pending و approve/reject بساز. همه‌ی عملیات مالی باید actor، زمان، دلیل و version را در audit ثبت کنند.
- پرداخت آنلاین را پیاده‌سازی نکن مگر من صریحاً اجازه دهم؛ پرداخت فعلی شارژ با رسید انتقال بانکی است.

### H. پنل مدیریت و مشاهده‌پذیری

- ورود جداگانه و محافظت‌شده برای ادمین بساز؛ امکان auth legacy API key فقط در صورت نیاز سازگاری، نه مسیر اصلی.
- پنل شامل داشبورد آمار، مدیریت کاربر (پروفایل/ban-unban/delete با safeguard)، تنظیمات و system prompt، گزارش/CSV، خطاها با filter/pagination، کنترل provider/AI routing، امور تصویر/ویدیو و مدیریت مالی نوآ باشد.
- تغییر حساس را audit کن. عملیات حذف یا مالی confirmation UI و رویداد ممیزی داشته باشد.
- health check برای سرویس و اتصال provider، request ID، لاگ ساخت‌یافته و error repository ایجاد کن. secret/PII را redact کن.

## معماری و کیفیت کد

- Backend را لایه‌بندی کن: bootstrap/composition، modules/use-cases، repositories/data-access و shared validators. Business logic را در route/controller قرار نده.
- هر integration خارجی پشت adapter/interface و config/env باشد.
- MySQL/MariaDB schema و migrationهای idempotent بساز. migration داده را قابل بازگشت یا حداقل دارای backup/plan کن.
- Docker Compose production-ready با DB health check، volumeهای پایدار برای upload، generated image، conversation memory و video input/result داشته باش.
- Headerهای امنیتی، compression (با استثنای stream)، محدودیت JSON body، rate limit و validation ورودی اعمال شوند.
- تمام configها از env خوانده شوند و .env.example کامل و فاقد secret واقعی باشد.

## روش اجرای اجباری

1. کار را به فازهای کوچک، قابل build و قابل review تقسیم کن. بعد از هر فاز، نتیجه، فایل‌های تغییرکرده، migration لازم، تست اجراشده و ریسک باقی‌مانده را گزارش بده.
2. تا زمانی که یک فاز با test/build مرتبط سبز نشده، به refactor گسترده‌ی بعدی نرو.
3. برای فرانت حداقل npm run build و testهای مرتبط را اجرا کن. برای backend testهای unit/module و testهای امنیتی/مالی/ویدیو مرتبط را اجرا کن.
4. اگر test قابل اجرا نیست، دلیل دقیق، اثر آن و command پیشنهادی را بگو؛ نتیجه‌ی ساختگی گزارش نکن.
5. بعد از تغییر UI، مسیرهای مهم را دستی بررسی کن: لندینگ→OTP→پروفایل→چت، کاربر قدیمی، چت جدید/سابقه، موجودی ناکافی، تصویر، ویدیو، رسید و پنل ادمین؛ موبایل و دسکتاپ؛ keyboard navigation.
6. API contractها، schema، migration و تغییرات breaking را در docs به‌روز کن.
7. تغییرات غیرمرتبط یا داده‌های کاربر را دست نزن. قبل از delete/reset/migration غیرقابل‌بازگشت دقیقاً از من تأیید بگیر.

## معیار نهایی پذیرش

محصول زمانی قابل تحویل است که:
- کاربر جدید و موجود بتوانند با OTP امن وارد شوند و به داده‌ی خود برسند؛
- چت فارسی، گفتگوهای پایدار، ورودی تصویر/صوت و پاسخ‌های امن کار کنند؛
- استودیو تصویر، تحلیل تصویر و استودیو ویدیو مالک‌محور، قابل پیگیری و مقاوم در برابر retry باشند؛
- هیچ عملیات هزینه‌داری بدون احراز موجودی و ثبت مالی سازگار شروع نشود؛
- رسید و تغییرات ادمین مالی private، idempotent و audit-able باشند؛
- ادمین بتواند کاربران، تنظیمات، providerها، خطاها و امور مالی را اداره کند؛
- UI در RTL، موبایل، دسکتاپ و پیمایش کیبورد قابل استفاده باشد؛
- تست‌ها/build مرتبط پاس شوند، secret در کد/لاگ نباشد و مستندات deployment/config/migration به‌روز باشند.

اکنون مرحله ۱ را انجام بده: repository و اسناد مرجع را بررسی کن، گزارش شکاف و برنامه‌ی فازبندی‌شده بده، سپس فقط فاز اولِ کم‌ریسک و مورد نیاز را اجرا و verify کن.
```

## شیوه استفاده

1. این فایل و [`README.md`](./README.md) را در اختیار agent قرار دهید.
2. اگر پروژه کاملاً خالی است، agent باید از بخش «پایه‌ی فنی» شروع کند؛ اگر پروژه نیمه‌کاره است، ابتدا گزارش شکاف تهیه کند.
3. در پایان هر فاز، نتیجه را تأیید کنید و سپس اجازه‌ی ورود به فاز بعدی را بدهید؛ به‌ویژه برای migration داده، سیاست کودک/والد و هر action مالی.
