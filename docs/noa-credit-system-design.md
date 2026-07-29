# سامانه اعتبار Noa — قرارداد اجرایی

وضعیت: پیاده‌سازی‌شده  
پشته: Express/CommonJS، `mysql2/promise`، MariaDB/InnoDB، React/TypeScript

Noa جایگزین کامل subscription/plan/quota در runtime است. داده‌های قدیمی فقط برای
rollback در جداول archive نگه‌داری می‌شوند و هیچ مسیر backend یا UI از آن‌ها برای
تصمیم مالی استفاده نمی‌کند.

## تصمیم‌های محصول

- هر کاربر احراز هویت‌شده یک کیف پول مستقل بر اساس `user_id` دارد.
- مهمان اجازه اجرای chat، vision، image generation/edit یا video generation ندارد.
- موجودی اولیه کیف پول صفر است.
- هر اشتراک قدیمی فعال در migration لغو و دقیقاً `5.000000` نوآ یک‌بار و
  idempotent به کاربر هدیه داده می‌شود.
- ارز پرداخت `TOMAN` است.
- نرخ تبدیل اولیه `10000.000000` تومان برای هر نوآ است و در runtime فقط از DB
  خوانده می‌شود.
- نقش‌های مجاز عملیات مالی فقط `finance` و `superadmin` هستند.

## قیمت‌گذاری پویا

اعداد اولیه فقط seed هستند و اجرای دوباره migration تغییر ادمین را overwrite
نمی‌کند:

| action key | واحد | قیمت اولیه |
|---|---|---:|
| `text_chat` | message | `0.120000` Noa |
| `image_generation` | image | `1.700000` Noa |
| `video_generation` | second | `0.800000` Noa |

قیمت یا نرخ fallback در runtime وجود ندارد. قیمت غایب، غیرفعال یا نامعتبر باعث
fail-closed می‌شود و provider فراخوانی نمی‌شود.

## Schema مرجع

Schema کامل و قابل اجرا در
`backend/migrations/039_noa_credit_system.sql` و نسخه idempotent زمان اجرا در
`backend/src/modules/noa/noa.schema.js` قرار دارد.

جدول‌های اصلی:

- `app_noa_pricing_configs`: action، واحد، قیمت، وضعیت، version و admin تغییر‌دهنده.
- `app_noa_settings`: نرخ `toman_per_noa`، ارز `TOMAN`، وضعیت و version.
- `app_noa_wallets`: یک رکورد یکتا برای هر user، مانده available/reserved و version.
- `app_noa_reservations`: snapshot قیمت و version، quantity، مبلغ، payload hash،
  idempotency hash، reference و وضعیت `reserved/captured/released`.
- `app_noa_transaction_logs`: ledger append-only با before/after و delta هر دو مانده.
- `app_noa_receipts`: اطلاعات انتقال بانکی، فایل خصوصی، مبلغ اظهارشده/تأییدشده
  تومان، نرخ snapshot، Noa محاسبه‌شده/تأییدشده و audit بازبینی.
- `app_noa_legacy_subscriptions_archive`: snapshot اشتراک فایل قدیمی و نتیجه هدیه.
- `app_noa_legacy_*_archive`: snapshot جدول‌های plan/quota/guest قدیمی.

قیود DB مانده منفی، quantity/price/amount غیرمثبت، transaction ID تکراری و
اعتباردهی دوباره یک receipt را مسدود می‌کنند.

## مدل عددی

- مانده، قیمت، نرخ و مبلغ Noa: `DECIMAL(24,6)`.
- مبلغ تومان رسید: `DECIMAL(24,2)`.
- quantity: `DECIMAL(20,6)`.
- همه مقدارهای مالی در API به شکل decimal string منتقل می‌شوند.
- محاسبه با fixed-point `BigInt` انجام می‌شود؛ JavaScript float وارد محاسبه مالی
  نمی‌شود.

## چرخه اتمیک عملیات

### Reserve

1. transaction شروع می‌شود.
2. wallet صفر به‌صورت lazy و idempotent ساخته می‌شود.
3. wallet با `FOR UPDATE` lock می‌شود.
4. idempotency key و payload hash بررسی می‌شوند.
5. price فعال خوانده و lock و version آن snapshot می‌شود.
6. هزینه دقیق محاسبه می‌شود.
7. مانده ناکافی با HTTP `402` و بدون provider call رد می‌شود.
8. مبلغ با شرط دفاعی از available به reserved منتقل می‌شود.
9. reservation و ledger entry در همان transaction درج می‌شوند.

### Capture

reservation و wallet lock می‌شوند، مبلغ از reserved خارج و ledger `capture`
درج می‌شود. capture تکراری همان snapshot نهایی را برمی‌گرداند.

### Release

reservation و wallet lock می‌شوند، مبلغ از reserved به available بازمی‌گردد و
ledger `release` درج می‌شود. release تکراری idempotent است.

ترتیب lockها در همه mutationها ثابت است تا race و double-spend ایجاد نشود.

## اتصال به AI

### Chat و Vision

- turn یکتا پیش از optimizer، intent router، title generator و provider اصلی claim
  می‌شود.
- Noa پیش از هر فراخوانی AI کمکی یا اصلی reserve می‌شود.
- replay همان turn هزینه و provider call جدید ندارد.
- پاسخ کامل capture می‌شود.
- failure/timeout/cancel پیش از خروجی release می‌شود.
- اگر حتی بخشی از stream به کاربر رسیده باشد، کل `0.12` capture می‌شود و refund
  انجام نمی‌شود.
- پاسخ clarification تولیدشده توسط optimizer یک پاسخ chat محسوب و capture می‌شود.
- regenerate/retry terminal فقط با `attemptId` جدید، reservation و هزینه جدید دارد.

### Image generation/edit

- تشخیص محلی درخواست تصویر provider call ندارد.
- برای routing از chat فقط action نهایی تصویر charge می‌شود؛ chat reservation یا
  enhancer جداگانه اجرا نمی‌شود.
- reservation و رکورد `image_generations` با وضعیت `WAITING` در یک transaction
  ایجاد می‌شوند. unique idempotency از اجرای هم‌زمان optimizer/refiner جلوگیری
  می‌کند.
- پس از آماده‌شدن prompt وضعیت به `QUEUE` می‌رود و provider شروع می‌شود.
- completion باعث capture و هر failure آماده‌سازی/اجرا باعث release و `ERROR` می‌شود.
- generation و edit هر دو از `image_generation` قیمت می‌گیرند.
- sweep رزروهای منقضی، رکوردهای stale در `WAITING/QUEUE/RUNNING` را نیز به
  `ERROR` می‌برد.

### Video

- duration معتبر به ثانیه canonical تبدیل می‌شود.
- هزینه برابر `duration × DB unit price` است.
- job و reservation اتمیک ایجاد می‌شوند.
- worker روی success عملیات capture و روی failure/timeout/cancel عملیات release
  انجام می‌دهد.
- recovery و تست‌های crash مانع reservation رهاشده و دوباره‌برداشت می‌شوند.
- reconciliation دوره‌ای job منقضی را به وضعیت terminal `expired` می‌برد.

## رسید انتقال بانکی

کاربر transaction ID، مبلغ اظهارشده تومان، `Idempotency-Key` و یک فایل
JPEG/PNG/WebP تا ۵ مگابایت می‌فرستد. magic bytes فایل بررسی و فایل با نام تصادفی
در storage خصوصی ذخیره می‌شود.

ادمین در approve:

1. مبلغ تأییدشده تومان را وارد می‌کند.
2. سیستم نرخ فعال DB را lock و Noa را دقیق محاسبه می‌کند.
3. ادمین می‌تواند Noa را دستی override کند؛ در این حالت دلیل override الزامی است.
4. credit کیف پول، ledger، snapshot نرخ و نهایی‌شدن receipt در یک transaction
   انجام می‌شوند.

approve/reject هم‌زمان یا تکراری به credit دوباره منجر نمی‌شود.

## APIها

Public read-only:

- `GET /api/noa/config`

Client، نیازمند JWT:

- `GET /api/noa/wallet`
- `GET /api/noa/balance`
- `GET /api/noa/transactions`
- `POST /api/noa/receipts`
- `GET /api/noa/receipts`
- `GET /api/noa/receipts/:receiptId`
- `GET /api/noa/receipts/:receiptId/image`

Admin، نیازمند admin auth و نقش `finance|superadmin`:

- `GET /api/admin/noa/config`
- `GET /api/admin/noa/pricing`
- `PUT|PATCH /api/admin/noa/pricing/:actionKey`
- `PUT|PATCH /api/admin/noa/exchange-rate`
- `GET /api/admin/noa/receipts`
- `GET /api/admin/noa/receipts/:receiptId`
- `GET /api/admin/noa/receipts/:receiptId/image`
- `POST /api/admin/noa/receipts/:receiptId/approve`
- `POST /api/admin/noa/receipts/:receiptId/reject`
- `GET /api/admin/noa/users/:userId/wallet`
- `POST /api/admin/noa/wallet-adjustments` — افزایش/کاهش دستی با `userId`، مقدار decimal، جهت تغییر، یادداشت اختیاری و `Idempotency-Key`.

تغییر price/rate با optimistic `expectedVersion` محافظت و در audit مالی و audit
ثانویه پنل ثبت می‌شود.

## UI

- موجودی Noa در هدر و کیف پول کاربر نمایش داده می‌شود.
- فرم انتقال بانکی، وضعیت رسیدها و refresh موجودی در UI کاربر فعال است.
- HTTP 402 کاربر را به بخش شارژ کیف پول هدایت می‌کند.
- Image Studio و Video Studio قیمت زنده را از `/api/noa/config` نمایش می‌دهند.
- پنل «مالی نوآ» فقط برای `finance/superadmin` قابل مشاهده است و نرخ، قیمت‌ها،
  صف receipt، محاسبه خودکار و override مستدل را پوشش می‌دهد.
- مدیر مالی می‌تواند کاربر را جست‌وجو، موجودی را مشاهده و نوآ را افزایش یا کاهش
  دهد. موجودی قابل استفاده می‌تواند منفی شود؛ رزروهای درحال‌اجرا همچنان هرگز
  منفی نمی‌شوند. یادداشت اختیاری عملیات، یک‌بار در ورود بعدی به کاربر نمایش داده
  می‌شود. همه تغییرات idempotent، ledger-backed و audit‌شده هستند.
- UIهای plan/subscription/quota قدیمی حذف شده‌اند.

## Payment gateway

اسکلت آینده در `payment-gateway.js` وجود دارد، اما
`PAYMENT_GATEWAY_ENABLED` عمداً و به‌صورت immutable برابر `false` است. هیچ route
درگاه mount نشده و هر فراخوانی مستقیم skeleton نیز fail-closed است.

## Migration و verification

فرمان migration:

```text
npm run db:migrate-noa
```

این فرمان schema را idempotent می‌سازد، داده legacy را archive می‌کند، اشتراک‌های
فعال فایل قدیمی را لغو می‌کند و هدیه ۵ Noa را دقیقاً یک بار ثبت می‌کند.

تست‌های اثبات‌کننده شامل fixed-point، seed بدون overwrite، race/double-spend،
idempotency conflict، receipt approval concurrency، file validation، RBAC،
gateway-off، pre-execution 402، ترتیب reserve پیش از optimizer/refiner، partial
stream capture، video worker/crash recovery و build/test کامل frontend هستند.
