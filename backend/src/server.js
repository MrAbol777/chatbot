const express = require('express');
const cors = require('cors');
const compression = require('compression');
const dotenv = require('dotenv');
const { ensureUserExists, logEvent, logError, getStats } = require('../db');

dotenv.config();

const app = express();
const verificationStore = new Map();
const conversationMemory = new Map();
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
const geminiBaseUrl = (process.env.GEMINI_BASE_URL || 'https://api.metisai.ir').replace(/\/+$/, '');
const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const geminiApiKey = typeof process.env.GEMINI_API_KEY === 'string' ? process.env.GEMINI_API_KEY.trim() : '';
const upstreamTimeoutMs = Number(process.env.GAPGPT_TIMEOUT_MS || 30000);
const adminApiKey = typeof process.env.ADMIN_API_KEY === 'string' ? process.env.ADMIN_API_KEY.trim() : '';

const chatEndpoint = `${geminiBaseUrl}/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`;

const normalizeHistory = (history, currentMessage) => {
  const clean = Array.isArray(history)
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

  while (clean.length > 0 && clean[0].role !== 'user') {
    clean.shift();
  }

  if (
    clean.length === 0 ||
    clean[clean.length - 1].role !== 'user' ||
    clean[clean.length - 1].content !== currentMessage
  ) {
    clean.push({ role: 'user', content: currentMessage });
  }

  return clean;
};

const buildMetisPayload = (messages) => {
  const systemMessage = messages.find((m) => m.role === 'system');
  const chatHistory = messages.filter((m) => m.role === 'user' || m.role === 'assistant');

  const contents = chatHistory.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: '' }] });
  }

  if (systemMessage && contents[contents.length - 1].role === 'user') {
    const lastText = contents[contents.length - 1].parts?.[0]?.text || '';
    contents[contents.length - 1].parts = [{ text: `${systemMessage.content}\n\n${lastText}` }];
  }

  return {
    contents,
    generationConfig: {
      temperature: 0.6
    }
  };
};

const parseJsonSafe = (text) => {
  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
};

const extractReply = (json) => {
  const parts = json?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return '';
  }

  const textParts = parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean);

  return textParts.join('\n').trim();
};

const doUpstreamRequest = async (payload, authHeaders) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), upstreamTimeoutMs);

  try {
    const response = await fetch(chatEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const raw = await response.text();
    const json = parseJsonSafe(raw);

    return {
      ok: response.ok,
      status: response.status,
      json,
      raw
    };
  } finally {
    clearTimeout(timer);
  }
};

const callGemini = async (messages) => {
  if (!geminiApiKey) {
    const error = new Error('GEMINI_API_KEY is missing');
    error.code = 'API_KEY_MISSING';
    throw error;
  }

  const payload = buildMetisPayload(messages);
  const authModes = [
    { mode: 'bearer', headers: { Authorization: `Bearer ${geminiApiKey}` } },
    { mode: 'x-goog-api-key', headers: { 'x-goog-api-key': geminiApiKey } }
  ];

  let lastFailure = null;

  for (const auth of authModes) {
    try {
      const result = await doUpstreamRequest(payload, auth.headers);

      if (!result.ok) {
        lastFailure = {
          authMode: auth.mode,
          status: result.status,
          details: result.json || result.raw
        };
        continue;
      }

      const reply = extractReply(result.json);
      if (!reply) {
        const error = new Error('EMPTY_UPSTREAM_REPLY');
        error.code = 'EMPTY_UPSTREAM_REPLY';
        error.details = result.json || result.raw;
        throw error;
      }

      return reply;
    } catch (error) {
      const causeCode =
        error &&
        typeof error === 'object' &&
        error.cause &&
        typeof error.cause === 'object' &&
        typeof error.cause.code === 'string'
          ? error.cause.code
          : null;

      if (error && typeof error === 'object' && error.name === 'AbortError') {
        const timeoutError = new Error('UPSTREAM_TIMEOUT');
        timeoutError.code = 'UPSTREAM_TIMEOUT';
        throw timeoutError;
      }

      if (error instanceof TypeError && error.message === 'fetch failed') {
        const networkError = new Error('UPSTREAM_FETCH_FAILED');
        networkError.code = 'UPSTREAM_FETCH_FAILED';
        networkError.details = {
          authMode: auth.mode,
          causeCode,
          baseUrl: geminiBaseUrl
        };
        throw networkError;
      }

      if (error && error.code === 'EMPTY_UPSTREAM_REPLY') {
        throw error;
      }

      lastFailure = {
        authMode: auth.mode,
        status: error && error.status ? error.status : null,
        details: error && error.details ? error.details : (error instanceof Error ? error.message : 'unknown_error')
      };
    }
  }

  const upstreamError = new Error('UPSTREAM_REQUEST_FAILED');
  upstreamError.code = 'UPSTREAM_REQUEST_FAILED';
  upstreamError.details = lastFailure;
  throw upstreamError;
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
6) سلام و خوش آمدگویی را فقط در شروع یک گفتگوی جدید انجام بده؛ در پیام های بعدی تکرار سلام نکن و مستقیم وارد پاسخ شو.
7) در مکالمه جاری، مگر در اولین پاسخ، از تکرار «سلام» و معرفی خود بپرهیز و مستقیماً به سوال پاسخ بده.

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
    const { message, profile, history, conversationId } = req.body || {};
    const requestId = res.locals.requestId;
    const trimmedMessage = typeof message === 'string' ? message.trim() : '';

    log('CHAT', 'incoming_message', {
      requestId,
      hasProfile: Boolean(profile),
      historyCount: Array.isArray(history) ? history.length : 0,
      messageLength: trimmedMessage.length
    });

    if (!geminiApiKey) {
      logError('api_key_missing', '/api/chat', 500, 'GEMINI_API_KEY is missing');
      return res.status(500).json({ error: 'کلید API تنظیم نشده است.' });
    }

    if (!trimmedMessage) {
      return res.status(400).json({ error: 'پیام معتبر ارسال نشده است.' });
    }

    const userId = ensureUserExists(profile || {});
    const category = detectCategory(trimmedMessage);
    const memoryKey =
      typeof conversationId === 'string' && conversationId.trim().length > 0
        ? `${userId}:${conversationId.trim()}`
        : `${userId}:default`;

    logEvent(userId, 'message_sent', category, {
      messageLength: trimmedMessage.length,
      requestId
    });

    const normalizedHistory = normalizeHistory(history, trimmedMessage);
    const storedHistory = conversationMemory.get(memoryKey);
    let effectiveHistory =
      Array.isArray(storedHistory) && storedHistory.length > normalizedHistory.length ? [...storedHistory] : normalizedHistory;
    const lastItem = effectiveHistory[effectiveHistory.length - 1];
    if (!lastItem || lastItem.role !== 'user' || lastItem.content !== trimmedMessage) {
      effectiveHistory.push({ role: 'user', content: trimmedMessage });
    }
    if (normalizedHistory.length > 50) {
      log('CHAT', 'long_conversation_warning', {
        requestId,
        historyCount: effectiveHistory.length,
        warning: 'مکالمه طولانی شده، ممکن است پاسخ ها کیفیت کمتری داشته باشند'
      });
    }

    const messages = [
      {
        role: 'system',
        content: buildSystemPrompt(profile)
      },
      ...effectiveHistory
    ];

    const reply = await callGemini(messages);
    conversationMemory.set(memoryKey, [...effectiveHistory, { role: 'assistant', content: reply }]);

    logEvent(userId, 'message_received', category, {
      responseLength: reply.length,
      requestId
    });

    return res.json({ reply });
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'UPSTREAM_TIMEOUT') {
      logError('gemini_timeout', '/gemini', 504, 'Upstream timeout reached');
      return res.status(504).json({ error: 'زمان پاسخ مدل طولانی شد. لطفاً دوباره تلاش کن.' });
    }

    if (error && typeof error === 'object' && error.code === 'UPSTREAM_FETCH_FAILED') {
      logError('gemini_fetch_failed', '/gemini', 502, JSON.stringify(error.details || {}));
      return res.status(502).json({
        error: 'ارتباط با سرویس مدل برقرار نشد.',
        details: 'اتصال شبکه، DNS یا GEMINI_BASE_URL را بررسی کنید.'
      });
    }

    if (error && typeof error === 'object' && error.code === 'UPSTREAM_REQUEST_FAILED') {
      const status = Number(error?.details?.status);
      const safeStatus = Number.isInteger(status) && status >= 400 ? status : 502;
      logError('gemini_upstream_error', '/gemini', safeStatus, JSON.stringify(error.details || {}));
      return res.status(safeStatus).json({
        error: 'خطا از سرویس مدل دریافت شد.',
        details: error?.details?.details || 'unknown_upstream_error'
      });
    }

    if (error && typeof error === 'object' && error.code === 'EMPTY_UPSTREAM_REPLY') {
      logError('invalid_upstream_response', '/gemini', 502, JSON.stringify(error.details || {}));
      return res.status(502).json({ error: 'پاسخ نامعتبر از مدل دریافت شد.' });
    }

    logError('unknown', '/gemini', null, error instanceof Error ? error.stack || error.message : 'unknown_error');

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
  res.json({
    ok: true,
    service: 'hemraz-backend',
    model: geminiModel,
    baseUrl: geminiBaseUrl
  });
});

const server = app.listen(port, () => {
  log('BOOT', 'backend_started', {
    port,
    model: geminiModel,
    baseUrl: geminiBaseUrl,
    timeoutMs: upstreamTimeoutMs
  });
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.requestTimeout = 30000;
