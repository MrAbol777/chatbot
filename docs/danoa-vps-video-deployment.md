# گزارش و راهنمای استقرار ساخت ویدیو روی VPS دامنه `danoa.ir`

## نتیجهٔ معماری

مسیر `video.image_to_video` فقط به BananaAI وصل است:

- Provider: `bananaai`
- Model: `grok-imagine-video`
- Routing policy: `PRIMARY_ONLY`
- Fallback: ندارد
- ورودی عکس: لینک امضاشده و پنج‌دقیقه‌ای روی `https://danoa.ir/api/video-provider-input/...`
- خروجی ویدیو: پس از تکمیل از BananaAI دریافت، اعتبارسنجی و در فضای خصوصی VPS ذخیره می‌شود.
- Metis در آپلود عکس یا تولید ویدیوی محیط Production دخالت ندارد.

## فایل‌های پروژه که باید روی VPS قرار بگیرند

کل Release پروژه باید در `/opt/chatbot` قرار گیرد. فایل‌های مهم این تغییر:

| فایل داخل پروژه | عملیات روی VPS | کاربرد |
|---|---|---|
| `docker-compose.yml` | جایگزین نسخهٔ قبلی | اجرای MariaDB و App، worker داخلی، volume ورودی و خروجی و bind امن پورت 3000 |
| `deploy/env.production.example` | کپی به `/opt/chatbot/.env` و تکمیل مقادیر | تنها فایل تنظیمات محرمانهٔ Docker |
| `deploy/deploy.sh` | اجرا از داخل پروژه | Build، migration، فعال‌سازی BananaAI، start و readiness check |
| `deploy/nginx.bootstrap.conf` | موقتاً کپی به `/etc/nginx/sites-available/danoa.ir` | دریافت اولین گواهی TLS |
| `deploy/nginx.conf` | بعد از صدور TLS جایگزین فایل بالا | Reverse proxy نهایی و مسیر امن عکس BananaAI |
| `backend/migrations/032_*.sql` تا `037_*.sql` | توسط deploy script اجرا می‌شوند | routing، رسانهٔ ورودی، prompt profile و تنظیمات Grok |
| `backend/src/modules/video-generation/**` | همراه Release کپی شود | API، صف، worker، BananaAI adapter و ذخیره‌سازی امن |
| `frontend/src/video-generation/**` | همراه Build کپی شود | رابط انتخاب سبک، عکس، زمان و کیفیت |

## فایل‌ها و مسیرهایی که روی VPS ایجاد می‌شوند

| مسیر VPS | نوع | توضیح |
|---|---|---|
| `/opt/chatbot/.env` | فایل محرمانه، mode `600` | کلیدها و تنظیمات Production؛ نباید وارد Git شود |
| `/etc/nginx/sites-available/danoa.ir` | فایل Nginx | ابتدا bootstrap و سپس config نهایی |
| `/etc/nginx/sites-enabled/danoa.ir` | symlink | فعال‌کردن سایت |
| `/var/www/certbot` | پوشه | ACME challenge برای Let's Encrypt |
| `/etc/letsencrypt/live/danoa.ir/` | پوشهٔ Certbot | certificate و private key دامنه |
| Docker volume `chatbot_mysql-data` | volume خصوصی | دیتابیس |
| Docker volume `chatbot_video-inputs` | volume خصوصی | عکس ورودی موقت |
| Docker volume `chatbot_video-results` | volume خصوصی | خروجی ویدیو |

نام واقعی volume ممکن است براساس نام پوشه/Compose project کمی متفاوت باشد؛ با `docker volume ls` قابل مشاهده است.

## ۱. پیش‌نیاز DNS و فایروال

رکورد `A` دامنهٔ `danoa.ir` باید به IP عمومی VPS اشاره کند. فقط پورت‌های زیر از اینترنت باز باشند:

- `22/tcp` برای SSH
- `80/tcp` برای ACME و هدایت HTTP
- `443/tcp` برای سایت

پورت `3000` نباید عمومی باشد؛ Compose آن را فقط روی `127.0.0.1` منتشر می‌کند.

## ۲. نصب ابزارهای میزبان

روی Ubuntu به‌عنوان کاربر دارای دسترسی sudo:

```bash
sudo apt update
sudo apt install -y ca-certificates curl nginx certbot

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
fi

sudo systemctl enable --now docker nginx
docker compose version
```

## ۳. انتقال Release

Release بررسی‌شده را در `/opt/chatbot` قرار دهید. فایل‌های runtime و secret قدیمی را کورکورانه overwrite نکنید. بعد:

```bash
cd /opt/chatbot
cp deploy/env.production.example .env
chmod 600 .env
nano .env
```

در `.env` همهٔ `CHANGE_ME`ها باید جایگزین شوند. برای ساخت secretهای جداگانه می‌توان سه بار این دستور را اجرا کرد:

```bash
openssl rand -hex 32
```

حداقل این متغیرها اجباری‌اند:

- `MYSQL_PASSWORD` و همان مقدار URL-safe در `DATABASE_URL`
- `MYSQL_ROOT_PASSWORD`
- `AUTH_JWT_SECRET`
- `ADMIN_JWT_SECRET`
- `ADMIN_API_KEY`
- `BANANAAI_API_KEY`
- `VIDEO_PROVIDER_INPUT_SIGNING_SECRET`

مقادیر ویدیویی زیر نباید تغییر مسیر دهند:

```dotenv
VIDEO_GENERATION_ENABLED=1
VIDEO_GENERATION_ACTIVATION_EXPECTED=1
AI_VIDEO_ROUTING_ENABLED=1
BANANAAI_BASE_URL=https://bananaai.ir
VIDEO_PROVIDER_INPUT_MODE=gateway
VIDEO_PROVIDER_INPUT_PUBLIC_BASE_URL=https://danoa.ir
VIDEO_GENERATION_WORKER_MODE=embedded
VIDEO_GENERATION_WORKER_ENABLED=true
```

کلید BananaAI که قبلاً داخل گفتگو ارسال شده بهتر است قبل از Production از پنل BananaAI تعویض شود؛ مقدار جدید فقط در `/opt/chatbot/.env` قرار می‌گیرد.

## ۴. اجرای برنامه و migration

```bash
cd /opt/chatbot
chmod +x deploy/deploy.sh
sudo PROJECT_DIR=/opt/chatbot ./deploy/deploy.sh
```

اسکریپت این کارها را انجام می‌دهد:

1. وجود `.env` و حذف placeholderها را کنترل می‌کند.
2. Docker Compose را validate می‌کند.
3. image برنامه را Build می‌کند.
4. MariaDB را بالا می‌آورد و منتظر health check می‌ماند.
5. migrationهای ویدیو را به‌شکل additive اجرا می‌کند.
6. route عکس‌به‌ویدیو را فقط روی BananaAI/Grok فعال می‌کند.
7. App و embedded worker را بالا می‌آورد.
8. health و readiness بدون درخواست خارجی را بررسی می‌کند.

## ۵. راه‌اندازی HTTPS

ابتدا config موقت را نصب کنید:

```bash
sudo install -d -m 755 /var/www/certbot
sudo cp /opt/chatbot/deploy/nginx.bootstrap.conf /etc/nginx/sites-available/danoa.ir
sudo ln -sfn /etc/nginx/sites-available/danoa.ir /etc/nginx/sites-enabled/danoa.ir
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

گواهی را صادر کنید و `YOUR_EMAIL` را عوض کنید:

```bash
sudo certbot certonly --webroot -w /var/www/certbot \
  -d danoa.ir --email YOUR_EMAIL --agree-tos --no-eff-email
```

سپس config نهایی را نصب کنید:

```bash
sudo cp /opt/chatbot/deploy/nginx.conf /etc/nginx/sites-available/danoa.ir
sudo nginx -t
sudo systemctl reload nginx
sudo certbot renew --dry-run
```

## ۶. کنترل قبل از درخواست واقعی

این دستورات هیچ درخواست تولیدی به BananaAI ارسال نمی‌کنند:

```bash
cd /opt/chatbot
curl -fsS http://127.0.0.1:3000/healthz
curl -fsS https://danoa.ir/healthz
curl -fsS https://danoa.ir/api/video-generation/options
curl -I https://danoa.ir/api/video-provider-input/invalid-token
docker compose exec -T app npm --prefix backend run check:video-generation-readiness
docker compose ps
```

انتظار می‌رود URL نامعتبر ورودی عکس `404` بدهد؛ این رفتار صحیح است.

## ۷. محدودکردن تست به یک درخواست

قبل از تست، quota پلن حساب تست را روی یک ویدیو در روز قرار دهید. نمونه برای پلن `diamond`:

```bash
cd /opt/chatbot
docker compose exec -T \
  -e ALLOW_VIDEO_QUOTA_CONFIGURATION=1 \
  app npm --prefix backend run admin:set-video-quota -- --plan=diamond --daily=1
```

سپس فقط از خود صفحهٔ `https://danoa.ir/studio/video` یک درخواست بسازید:

- Duration: `1` ثانیه
- Resolution: `480p`
- Style: یکی از Cinematic یا Animation
- Provider/Model واقعی: BananaAI / `grok-imagine-video`

هم‌زمان log را ببینید:

```bash
cd /opt/chatbot
docker compose logs -f --tail=200 app
```

بعد از ثبت task یا رخداد مبهم، Submit را تکرار نکنید. worker فقط status همان task را poll می‌کند و در پایان خروجی را داخل `video-results` ذخیره می‌کند.

## ۸. کنترل سلامت روزمره

```bash
cd /opt/chatbot
docker compose ps
docker compose logs --tail=200 app
docker compose exec -T app npm --prefix backend run check:video-generation-readiness
df -h
docker system df
```

از دیتابیس و volume خروجی ویدیو باهم backup بگیرید تا metadata و فایل‌ها سازگار بمانند.

## ۹. توقف اضطراری و Rollback

در `/opt/chatbot/.env` مقدار زیر را قرار دهید:

```dotenv
VIDEO_GENERATION_ENABLED=0
```

سپس کانتینر را recreate کنید تا env جدید خوانده شود:

```bash
cd /opt/chatbot
docker compose up -d --force-recreate app
```

Rollback نباید جدول‌های migration یا volumeهای `mysql-data`، `video-inputs` و `video-results` را حذف کند.
