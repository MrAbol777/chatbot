# عملیات، استقرار و نگهداری

> وضعیت: ✅ runbook عملیاتی — بازبینی: ۲۰۲۶-۰۸-۱۵

## معماری استقرار پیشنهادی

در production، Nginx به‌عنوان reverse proxy جلوی container برنامه قرار می‌گیرد. پورت 3000 باید فقط روی loopback یا شبکه داخلی منتشر شود و اینترنت فقط به 80/443 دسترسی داشته باشد.

```text
Internet :443
    ↓
Nginx / TLS / static + proxy
    ↓ 127.0.0.1:3000
Docker app (Express + embedded video worker)
    ↓
MariaDB + volumes
```

راهنمای جزئیات دامنه `danoa.ir` در [danoa-vps-video-deployment.md](./danoa-vps-video-deployment.md) است.

## استقرار Docker

فایل‌های اصلی:

- `Dockerfile`
- `docker-compose.yml`
- `deploy/deploy.sh`
- `deploy/env.production.example`
- `deploy/nginx.bootstrap.conf`
- `deploy/nginx.conf`

دستور پایه:

```bash
docker compose config
docker compose up -d --build
docker compose ps
docker compose logs --tail=200 app
```

برای production از runbook deployment استفاده کنید تا ترتیب migration، health، TLS و فعال‌سازی ویدیو رعایت شود.

## ترتیب release

1. وضعیت branch و diff را بررسی کنید.
2. build frontend و تست‌های backend را اجرا کنید.
3. image را build و compose را validate کنید.
4. DB backup بگیرید.
5. migration additive را اجرا کنید.
6. app را بالا بیاورید و health check بگیرید.
7. یک smoke test غیرتولیدی اجرا کنید.
8. قابلیت‌های پرهزینه مثل video را با quota محدود و یک درخواست واقعی کنترل‌شده فعال کنید.

## health و readiness

```bash
curl -fsS https://YOUR_DOMAIN/healthz
curl -fsS https://YOUR_DOMAIN/api/health
curl -fsS https://YOUR_DOMAIN/api/health/video-generation
docker compose ps
docker compose logs -f --tail=200 app
```

برای ویدیو، readiness script و health endpoint باید قبل از تست live سبز باشند. `404` برای token نامعتبر input provider رفتار درست است.

## پایش روزمره

موارد زیر را پایش کنید:

- وضعیت container و restart count.
- latency و error rate endpointهای `/api/chat`، `/api/images` و `/api/video-generations`.
- حجم DB و volumeهای image/video/memory.
- تعداد jobهای `processing`, `failed`, `storing` و jobهای lease شده.
- reservationهای نوآی release نشده.
- نرخ OTP failure و خطاهای provider.
- error log و audit log ادمین.

## runbook رخدادها

### قطع provider AI

1. health upstream و DNS را بررسی کنید.
2. request id و status provider را از log استخراج کنید.
3. model/base URL و کلید را بدون چاپ مقدار secret بررسی کنید.
4. در صورت نیاز capability را از routing admin به provider سالم منتقل کنید.

### گیر کردن job ویدیو

1. status و `updated_at` job را بررسی کنید.
2. worker lease و log provider را بررسی کنید.
3. idempotency job را حفظ و submit مجدد کورکورانه نکنید.
4. اگر لازم است feature flag ویدیو را خاموش کنید؛ جدول و volume را حذف نکنید.

### خطای مالی نوآ

1. ledger، reservation و idempotency key را بررسی کنید.
2. capture/release را دستی بدون audit اجرا نکنید.
3. receipt را از پنل finance بررسی کنید.
4. مغایرت را با reconciliation و لاگ تراکنش حل کنید.

## rollback امن

- کد را به release قبلی برگردانید، اما migration additive و داده را حذف نکنید.
- برای خاموش‌سازی اضطراری ویدیو `VIDEO_GENERATION_ENABLED=0` تنظیم و app را recreate کنید.
- volumeهای `mysql-data`، `video-inputs` و `video-results` را حذف نکنید.
- rollback schema فقط با برنامه migration معکوس و تایید مالک داده انجام شود.

## backup و بازیابی

حداقل این‌ها باید با هم backup شوند:

- MariaDB
- `data/generated-images`
- `data/conversation-memory`
- volume ورودی و خروجی video
- فایل‌های config لازم، بدون secret یا با secret manager امن

بعد از restore، health، تعداد جدول‌ها، دسترسی فایل‌ها، یک login و یک خواندن conversation را بررسی کنید.

