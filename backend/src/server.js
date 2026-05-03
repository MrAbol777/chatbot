const express = require('express');
const cors = require('cors');
const compression = require('compression');
const dotenv = require('dotenv');
const http = require('http');
const https = require('https');
const { ensureUserExists, logEvent, logError, getStats } = require('../db');

dotenv.config();

const app = express();
const verificationStore = new Map();
const VERIFICATION_TTL_MS = 5 * 60 * 1000;

const now = () => new Date().toISOString();
const log = (scope, message, meta) => {
  if (meta && typeof meta === 'object') {
    console.log(`[${now()}] [${scope}] ${message} ${JSON.stringify(meta)}`);
    return;
  }
  console.log(`[${now()}] [${scope}] ${message}`);
};

const port = Number(process.env.PORT || 3001);
const gapBaseUrl = process.env.GAPGPT_BASE_URL || 'https://api.gapgpt.app/v1';
const gapModel = process.env.GAPGPT_MODEL || 'gpt-4o-mini';
const gapApiKey = typeof process.env.GAPGPT_API_KEY === 'string' ? process.env.GAPGPT_API_KEY.trim() : '';
const upstreamTimeoutMs = Number(process.env.GAPGPT_TIMEOUT_MS || 30000);
const maxUpstreamRetries = Number(process.env.GAPGPT_MAX_RETRIES || 2);
const adminApiKey = typeof process.env.ADMIN_API_KEY === 'string' ? process.env.ADMIN_API_KEY.trim() : '';

const httpAgent = new http.Agent({
  keepAlive: true,
  timeout: upstreamTimeoutMs
});
const httpsAgent = new https.Agent({
  keepAlive: true,
  timeout: upstreamTimeoutMs
});

const RETRYABLE_UPSTREAM_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const AUTH_ERROR_STATUSES = new Set([401, 403]);

const authHeaderCandidates = gapApiKey
  ? [
      { Authorization: `Bearer ${gapApiKey}` },
      { Authorization: gapApiKey },
      { 'x-api-key': gapApiKey }
    ]
  : [];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getRetryDelayMs = (attemptIndex, retryAfterHeader) => {
  const parsedRetryAfter = Number(retryAfterHeader);
  if (Number.isFinite(parsedRetryAfter) && parsedRetryAfter >= 1) {
    return Math.min(parsedRetryAfter * 1000, 8000);
  }
  return Math.min(400 * 2 ** attemptIndex, 2500);
};

const isRetryableError = (error) => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  return (
    error.name === 'AbortError' ||
    error.code === 'UND_ERR_CONNECT_TIMEOUT' ||
    error.code === 'ECONNRESET' ||
    error.code === 'ECONNREFUSED' ||
    error.code === 'ETIMEDOUT'
  );
};

const callUpstreamWithRetry = async (messages) => {
  let lastError = null;

  for (let attempt = 0; attempt <= maxUpstreamRetries; attempt += 1) {
    for (let authIndex = 0; authIndex < authHeaderCandidates.length; authIndex += 1) {
      log('UPSTREAM', 'attempt_started', {
        attempt: attempt + 1,
        maxAttempts: maxUpstreamRetries + 1,
        authVariant: authIndex + 1
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), upstreamTimeoutMs);

      try {
        const response = await fetch(`${gapBaseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaderCandidates[authIndex]
          },
          body: JSON.stringify({
            model: gapModel,
            messages,
            temperature: 0.6
          }),
          signal: controller.signal,
          agent: ({ protocol }) => (protocol === 'http:' ? httpAgent : httpsAgent)
        });

        if (response.ok) {
          log('UPSTREAM', 'attempt_succeeded', {
            attempt: attempt + 1,
            authVariant: authIndex + 1,
            status: response.status
          });
          return response;
        }

        log('UPSTREAM', 'attempt_failed_status', {
          attempt: attempt + 1,
          authVariant: authIndex + 1,
          status: response.status
        });

        if (AUTH_ERROR_STATUSES.has(response.status) && authIndex < authHeaderCandidates.length - 1) {
          continue;
        }

        if (!RETRYABLE_UPSTREAM_STATUSES.has(response.status) || attempt >= maxUpstreamRetries) {
          return response;
        }

        const retryDelayMs = getRetryDelayMs(attempt, response.headers.get('retry-after'));
        await wait(retryDelayMs);
        break;
      } catch (error) {
        lastError = error;

        log('UPSTREAM', 'attempt_failed_error', {
          attempt: attempt + 1,
          authVariant: authIndex + 1,
          errorName: error && typeof error === 'object' ? error.name : 'unknown',
          errorCode: error && typeof error === 'object' ? error.code : 'unknown'
        });

        if (!isRetryableError(error) || attempt >= maxUpstreamRetries) {
          throw error;
        }

        const retryDelayMs = getRetryDelayMs(attempt);
        await wait(retryDelayMs);
        break;
      } finally {
        clearTimeout(timeoutId);
      }
    }
  }

  throw lastError || new Error('unknown_upstream_error');
};

function detectCategory(msg) {
  const lower = typeof msg === 'string' ? msg.toLowerCase() : '';
  if (/ریاضی|علم|فرمول|معادله|چرا|چگونه|درس|مدرسه|فیزیک|شیمی|زیست/.test(lower)) return 'academic';
  if (/احساس|ناراحت|غمگین|ترس|استرس|خجالت|دعوا|دوست|رابطه|دوستی|مامان|بابا/.test(lower)) return 'emotional';
  if (/داستان|قصه|ایده|شخصیت|بنویس|نوشتن|خلاقیت|ماجراجویی/.test(lower)) return 'creative';
  return 'general';
}

app.use(cors());
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  const startedAt = Date.now();
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  res.locals.requestId = requestId;

  log('HTTP', 'request_started', {
    requestId,
    method: req.method,
    path: req.originalUrl
  });

  res.on('finish', () => {
    log('HTTP', 'request_finished', {
      requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - startedAt
    });
  });

  next();
});

const buildSystemPrompt = (profile) => {
  const safeName = typeof profile?.name === 'string' && profile.name.trim() ? profile.name.trim() : 'دوست من';
  const safeAge = Number(profile?.age);
  const ageText = Number.isFinite(safeAge) ? `${safeAge}` : 'نامشخص';
  const ageStyle =
    Number.isFinite(safeAge) && safeAge <= 12
      ? 'جمله ها ساده، کوتاه و خیلی روشن باشند.'
      : 'توضیح ها دقیق تر باشند ولی همچنان صمیمی و روان بمانند.';

  return `تو «همراز» هستی؛ یک همراه امن، مهربان و آموزشی برای نوجوانان.

مشخصات کاربر:
- نام: ${safeName}
- سن: ${ageText}

قوانین اصلی:
1) پاسخ ها همیشه فارسی و مناسب راست به چپ باشند.
2) لحن باید امن، محترمانه و دوستانه باشد.
3) ${ageStyle}
4) اگر اطلاعات کاربر ناقص بود، از لحن خنثی و محترمانه استفاده کن.
5) پاسخ کوتاه و مفید باشد، اما اگر سوال آموزشی است مرحله بندی واضح داشته باشد.

قواعد The Mom Test:
- همیشه اول اعتبارسنجی احساسی انجام بده (تایید احساس/تجربه کاربر).
- درباره رفتار گذشته و تجربه واقعی کاربر سوال کن، نه نظرهای کلی.
- داده ضعیف را تشخیص بده: تعریف و تمجید، کلمات مبهم، یا ایده خام بدون شواهد.
- در موقعیت مناسب «سوال قاتل» بپرس: بسامد (چندبار)، هزینه (پول/زمان)، تعهد (واقعاً چه کاری انجام داده).

تشخیص دسته و قالب پاسخ:
- دسته آموزشی/درسی: با ایموجی 📚 شروع کن، قدم به قدم، دقیق و واقعی.
- دسته احساسی: 5 گام را رعایت کن:
  1. همدلی
  2. عادی سازی احساس
  3. پیشنهاد صحبت با مادر یا پدر
  4. پیشنهاد حالت تمرین گفتگو
  5. یک جمله نمونه برای شروع گفتگوی واقعی
- دسته خلاقانه: اول سه جزئیات بپرس (چه کسی، کجا، مشکل چیست)، سپس 3 ایده داستان کوتاه بده.

حالت «تمرین با مامان»:
- اگر کاربر عبارتی مثل «تمرین با مامان» گفت، نقش مادر مهربان را بازی کن.
- تا وقتی کاربر «پایان تمرین» نگفته، در همان نقش بمان.
- در این حالت پاسخ ها کوتاه، حمایتی و گفتگومحور باشند.

ایمنی گفتگو:
- اگر موضوع حساس یا خطرناک بود، آرامش بده و پیشنهاد کمک از یک بزرگسال مورد اعتماد را اضافه کن.
- هیچ وقت پاسخ تحقیرآمیز یا ترسناک نده.

مهم: پاسخ نمونه از پیش نوشته نده؛ فقط بر اساس قوانین بالا پاسخ پویا تولید کن.`;
};

app.post('/api/send-verification-code', (req, res) => {
  try {
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';

    if (!/^09[0-9]{9}$/.test(phone)) {
      return res.status(400).json({ error: 'شماره موبایل معتبر نیست.' });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Date.now() + VERIFICATION_TTL_MS;
    verificationStore.set(phone, { code, expiresAt });
    console.log(`[VERIFICATION CODE] ${phone} -> ${code}`);

    return res.json({ success: true });
  } catch (error) {
    logError('verification_code_failed', '/api/send-verification-code', 500, error instanceof Error ? error.message : 'unknown');
    return res.status(500).json({ error: 'ارسال کد با خطا مواجه شد.' });
  }
});

app.post('/api/verify-code', (req, res) => {
  try {
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';

    if (!/^09[0-9]{9}$/.test(phone) || !/^[0-9]{6}$/.test(code)) {
      return res.status(400).json({ success: false, error: 'کد منقضی شده یا نامعتبر است' });
    }

    const stored = verificationStore.get(phone);
    if (!stored || Date.now() > stored.expiresAt) {
      verificationStore.delete(phone);
      return res.status(400).json({ success: false, error: 'کد منقضی شده یا نامعتبر است' });
    }

    if (stored.code !== code) {
      return res.status(400).json({ success: false, error: 'کد نادرست است' });
    }

    verificationStore.delete(phone);
    return res.json({ success: true });
  } catch (error) {
    logError('verify_code_failed', '/api/verify-code', 500, error instanceof Error ? error.message : 'unknown');
    return res.status(500).json({ success: false, error: 'تأیید کد با خطا مواجه شد.' });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message, profile, history } = req.body || {};
    const requestId = res.locals.requestId;
    const trimmedMessage = typeof message === 'string' ? message.trim() : '';

    log('CHAT', 'incoming_message', {
      requestId,
      hasProfile: Boolean(profile),
      historyCount: Array.isArray(history) ? history.length : 0,
      messageLength: trimmedMessage.length
    });

    if (!gapApiKey) {
      logError('api_key_missing', '/api/chat', 500, 'GAPGPT_API_KEY is missing');
      return res.status(500).json({ error: 'کلید API تنظیم نشده است.' });
    }

    if (typeof message !== 'string' || !trimmedMessage) {
      return res.status(400).json({ error: 'پیام معتبر ارسال نشده است.' });
    }

    const userId = ensureUserExists(profile || {});
    const category = detectCategory(trimmedMessage);

    logEvent(userId, 'message_sent', category, {
      messageLength: trimmedMessage.length,
      requestId
    });

    const normalizedHistory = Array.isArray(history)
      ? history
          .filter(
            (item) =>
              item &&
              (item.role === 'user' || item.role === 'assistant') &&
              typeof item.content === 'string' &&
              item.content.trim().length > 0
          )
          .map((item) => ({ role: item.role, content: item.content.trim() }))
      : [];

    if (normalizedHistory.length === 0 || normalizedHistory[normalizedHistory.length - 1].content !== trimmedMessage) {
      normalizedHistory.push({ role: 'user', content: trimmedMessage });
    }

    const messages = [
      {
        role: 'system',
        content: buildSystemPrompt(profile)
      },
      ...normalizedHistory
    ];

    const response = await callUpstreamWithRetry(messages);

    if (!response.ok) {
      const errorText = await response.text();
      const errorType = AUTH_ERROR_STATUSES.has(response.status) ? 'auth_failed' : `gapgpt_${response.status}`;
      logError(errorType, '/chat/completions', response.status, errorText);

      if (AUTH_ERROR_STATUSES.has(response.status)) {
        return res.status(response.status).json({
          error: 'احراز هویت سرویس مدل نامعتبر است. GAPGPT_API_KEY را بررسی کن.',
          details: errorText.slice(0, 400)
        });
      }

      return res.status(response.status).json({ error: 'خطا در ارتباط با مدل', details: errorText.slice(0, 400) });
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content;

    if (typeof reply !== 'string' || !reply.trim()) {
      logError('invalid_upstream_response', '/chat/completions', 502, 'Empty or invalid reply content');
      return res.status(502).json({ error: 'پاسخ نامعتبر از مدل دریافت شد.' });
    }

    logEvent(userId, 'message_received', category, {
      responseLength: reply.trim().length,
      requestId
    });

    return res.json({ reply: reply.trim() });
  } catch (error) {
    if (error && typeof error === 'object' && error.name === 'AbortError') {
      logError('gapgpt_timeout', '/chat/completions', 504, error.message);
      return res.status(504).json({
        error: 'زمان پاسخ مدل طولانی شد. لطفاً دوباره تلاش کن.'
      });
    }

    logError('unknown', '/chat/completions', null, error instanceof Error ? error.stack || error.message : 'unknown_error');

    return res.status(500).json({
      error: 'مشکلی در سرور پیش آمد.',
      details: error instanceof Error ? error.message : 'unknown_error'
    });
  }
});

app.get('/api/admin/stats', (req, res) => {
  if (!adminApiKey) {
    return res.status(404).json({ error: 'Not found' });
  }

  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  if (authHeader !== `Bearer ${adminApiKey}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return res.json(getStats());
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'hemraz-backend' });
});

const server = app.listen(port, () => {
  log('BOOT', 'backend_started', {
    port,
    model: gapModel,
    baseUrl: gapBaseUrl,
    timeoutMs: upstreamTimeoutMs,
    retries: maxUpstreamRetries
  });
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.requestTimeout = 30000;
