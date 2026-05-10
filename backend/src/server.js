const express = require('express');
const cors = require('cors');
const compression = require('compression');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs-extra');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const db = require('../db');
const { createAdminRouter } = require('./adminRoutes');
const {
  ensureUserExists,
  findUserByPhone,
  isUserBannedByPhone,
  logEvent,
  logError,
  getStats,
  getConversationMessages,
  saveConversationMessages,
  getUserConversations,
  replaceUserConversations
} = db;

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

const normalizePort = (value, fallback = 3000) => {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed;
  }
  return fallback;
};
const normalizePhone = (value) => (typeof value === 'string' ? value.trim().replace(/[-\s]/g, '') : '');
const isValidPhone = (value) => /^09[0-9]{9}$/.test(value);

const port = normalizePort(process.env.PORT, 3000);
const host = '0.0.0.0';
const geminiBaseUrl = (process.env.GEMINI_BASE_URL || 'https://api.metisai.ir').replace(/\/+$/, '');
const defaultModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const geminiApiKey = typeof process.env.GEMINI_API_KEY === 'string' ? process.env.GEMINI_API_KEY.trim() : '';
const defaultTimeoutMs = Number(process.env.GAPGPT_TIMEOUT_MS || 30000);
const adminApiKey = typeof process.env.ADMIN_API_KEY === 'string' ? process.env.ADMIN_API_KEY.trim() : '';
const adminJwtSecret = typeof process.env.ADMIN_JWT_SECRET === 'string' ? process.env.ADMIN_JWT_SECRET.trim() : 'danoa-admin-secret';
const adminPanelPath = process.env.ADMIN_PANEL_PATH || '/admin-secure-9x7k';
const adminCookieName = process.env.ADMIN_COOKIE_NAME || 'admin_token';
const adminConfigPath = path.join(__dirname, '../config.json');
const DEFAULT_SYSTEM_PROMPT = `تو «دانوآ» هستی؛ یک همراه مهربان، خیالی و بدون جنسیت (ترکیبی از ربات کوچک و ابر) که برای همه سنین از ۲ تا ۱۸ سال طراحی شده‌ای. شکل تو گرد و نرم است تا حس امنیت بده. برای نوجوانان، نقش یک «دوست داناتر» را بازی می‌کنی و برای کودکان، نقش یک مربی صبور و داستان‌گو.

🧠 قوانین طلایی (همیشه رعایت کن)

1. همه پاسخ‌ها فارسی و راست‌به‌چپ باشد.
2. لحن: امن، محترمانه، دوستانه و بدون تحقیر.
3. فکت علمی فقط در مواقع خاص: اگر این یکی از ۲ پیام اول گفتگو است، می‌توانی پاسخ را با یک فکت علمی کوتاه (حداکثر ۱ جمله) شروع کنی. اگر کاربر صراحتاً از تو خواست «یک واقعیت جالب بگو» یا «بیشتر توضیح بده»، در آن صورت نیز می‌توانی یک فکت اضافه کنی. در غیر این صورت (ادامه یک مکالمه عادی)، پاسخ را مستقیم و بدون هیچ فکت علمی بده؛ فقط مفید و کوتاه به سؤال پاسخ بده. هیچ‌وقت در پاسخ‌های تکراری یا تأییدی (مثل «بله»، «درسته»، «آفرین») فکت نیاور.
4. در هر پاسخ، بیش از یک ایده اصلی ارائه نکن. اگر پاسخ ساده است، یک جمله کافی است. از توضیحات اضافی بپرهیز.
5. بازخورد مثبت: به جای «غلطه» بگو «خیلی نزدیک شدی! بیا یک جور دیگه ببینیم.»
6. ناوبری ذهنی: همیشه به کاربر بگو کجای مسیره (مثلاً «الان مرحله دوم از سه مرحله‌ست»).
7. اگر این اولین پیام کاربر در این گفتگو نیست، پاسخ را با سلام تکراری شروع نکن و مستقیم سر اصل مطلب برو.
8. اگر کاربر قبلاً به یک سوال پاسخ داده، در پاسخ‌های بعدی همان سوال را تکرار نکن.

🎯 دسته‌بندی موضوع و قالب پاسخ

📚 دسته آموزشی/درسی
- شروع با ایموجی 📚
- گام‌به‌گام و دقیق

❤️ دسته احساسی
- اول همدلی کن، بعد عادی‌سازی احساس، و در صورت نیاز پیشنهاد گفت‌وگو با یک بزرگ‌سال قابل اعتماد بده.

✨ دسته خلاقانه
- اگر اطلاعات کافی بود مستقیم کمک کن، اگر نبود حداکثر یک سوال تکمیلی بپرس.

🛡️ ایمنی گفتگو
- اگر موضوع حساس یا خطرناک بود، اول آرامش بده، بعد بگو «بیا با یک بزرگ‌سال مورد اعتماد حرف بزنیم.»
- هیچ‌وقت تحقیر نکن، مسخره نکن، نترسون.
`;

let systemPromptCache = null;

const invalidateSystemPromptCache = () => {
  systemPromptCache = null;
};

process.on('uncaughtException', (error) => {
  console.error('[FATAL] uncaughtException', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection', reason);
});

if (typeof db.ensureDBFile === 'function') {
  try {
    db.ensureDBFile();
    if (db.dbInfo?.mode === 'file') {
      console.log(`[BOOT] DB mode=file path=${db.dbInfo.filePath}`);
    } else {
      console.warn('[BOOT] DB mode=memory (no writable file path found)');
    }
  } catch (error) {
    console.error('[BOOT] ensureDBFile failed', error);
  }
}

const getRuntimeConfig = async () => {
  try {
    const parsed = await fs.readJson(adminConfigPath);
    return {
      model: typeof parsed?.model === 'string' && parsed.model.trim() ? parsed.model.trim() : defaultModel,
      timeoutMs: Number.isFinite(Number(parsed?.timeoutMs)) ? Number(parsed.timeoutMs) : defaultTimeoutMs
    };
  } catch (_error) {
    return {
      model: defaultModel,
      timeoutMs: defaultTimeoutMs
    };
  }
};

const getSystemPrompt = async () => {
  if (systemPromptCache) {
    return systemPromptCache;
  }

  try {
    const parsed = await fs.readJson(adminConfigPath);
    const configuredPrompt =
      typeof parsed?.systemPrompt === 'string' && parsed.systemPrompt.trim()
        ? parsed.systemPrompt.trim()
        : DEFAULT_SYSTEM_PROMPT;

    if (!parsed?.systemPrompt || typeof parsed.systemPrompt !== 'string' || !parsed.systemPrompt.trim()) {
      await fs.writeJson(
        adminConfigPath,
        {
          ...parsed,
          systemPrompt: configuredPrompt
        },
        { spaces: 2 }
      );
    }

    systemPromptCache = configuredPrompt;
    return configuredPrompt;
  } catch (_error) {
    systemPromptCache = DEFAULT_SYSTEM_PROMPT;
    return systemPromptCache;
  }
};

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

const removeExtraGreeting = (text, isFirstMessage) => {
  if (typeof text !== 'string') return '';
  if (isFirstMessage) return text;

  const cleaned = text.trimStart();
  const greetingPattern =
    /^(?:(?:سلام(?:\s+(?:دوباره|مجدد))?)|درود|(?:من\s+دانوآ\s+هستم)|(?:من\s+دانوآم))(?:[\s،,:!.\-—]+|$)/i;

  return cleaned.replace(greetingPattern, '').trimStart();
};

const doUpstreamRequest = async (payload, authHeaders, chatEndpoint, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

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
  const runtimeConfig = await getRuntimeConfig();
  const chatEndpoint = `${geminiBaseUrl}/v1beta/models/${encodeURIComponent(runtimeConfig.model)}:generateContent`;
  const authModes = [
    { mode: 'bearer', headers: { Authorization: `Bearer ${geminiApiKey}` } },
    { mode: 'x-goog-api-key', headers: { 'x-goog-api-key': geminiApiKey } }
  ];

  let lastFailure = null;

  for (const auth of authModes) {
    try {
      const result = await doUpstreamRequest(payload, auth.headers, chatEndpoint, runtimeConfig.timeoutMs);

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

app.use(cors({ origin: true, credentials: true }));
app.use(helmet());
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
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


app.post('/api/send-verification-code', (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const mode = typeof req.body?.mode === 'string' ? req.body.mode.trim() : '';

    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: 'شماره موبایل معتبر نیست.' });
    }

    const phoneExists = Boolean(findUserByPhone(phone));

    if (mode === 'signup' && phoneExists) {
      return res.status(409).json({ error: 'این شماره قبلاً ثبت‌نام شده است', redirectTo: 'login', phoneExists });
    }

    if (mode === 'login' && !phoneExists) {
      return res.status(404).json({ error: 'حسابی با این شماره یافت نشد', redirectTo: 'signup', phoneExists });
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

app.post('/api/auth/phone-status', (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const mode = typeof req.body?.mode === 'string' ? req.body.mode.trim() : '';

    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: 'شماره موبایل معتبر نیست.' });
    }

    const user = findUserByPhone(phone);
    if (user?.isBanned) {
      return res.status(403).json({ error: 'حساب شما مسدود شده است' });
    }
    const exists = Boolean(user);
    const recommendedMode = exists ? 'login' : 'signup';
    const shouldRedirect = mode === 'signup' ? exists : mode === 'login' ? !exists : false;

    return res.json({
      success: true,
      exists,
      recommendedMode,
      redirectTo: shouldRedirect ? recommendedMode : null
    });
  } catch (error) {
    logError('phone_status_failed', '/api/auth/phone-status', 500, error instanceof Error ? error.message : 'unknown');
    return res.status(500).json({ error: 'بررسی شماره موبایل با خطا مواجه شد.' });
  }
});

app.post('/api/verify-code', (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    const mode = typeof req.body?.mode === 'string' ? req.body.mode.trim() : '';

    if (!isValidPhone(phone) || !/^[0-9]{6}$/.test(code)) {
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

    const phoneExists = Boolean(findUserByPhone(phone));
    if (mode === 'signup' && phoneExists) {
      verificationStore.delete(phone);
      return res.status(409).json({ success: false, error: 'این شماره قبلاً ثبت‌نام شده است', redirectTo: 'login' });
    }
    if (mode === 'login' && !phoneExists) {
      verificationStore.delete(phone);
      return res.status(404).json({ success: false, error: 'حسابی با این شماره یافت نشد', redirectTo: 'signup' });
    }

    verificationStore.delete(phone);
    return res.json({ success: true });
  } catch (error) {
    logError('verify_code_failed', '/api/verify-code', 500, error instanceof Error ? error.message : 'unknown');
    return res.status(500).json({ success: false, error: 'تأیید کد با خطا مواجه شد.' });
  }
});

app.post('/api/register-profile', (req, res) => {
  try {
    const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const rawPhone = normalizePhone(req.body?.phone);
    const rawAge = Number(req.body?.age);
    const rawId = req.body?.id;
    const mode = typeof req.body?.mode === 'string' ? req.body.mode.trim() : '';

    if (!rawName) {
      return res.status(400).json({ error: 'نام معتبر نیست.' });
    }

    if (!isValidPhone(rawPhone)) {
      return res.status(400).json({ error: 'شماره موبایل معتبر نیست.' });
    }

    if (!Number.isFinite(rawAge)) {
      return res.status(400).json({ error: 'سن معتبر نیست.' });
    }

    if (!(typeof rawId === 'string' || typeof rawId === 'number')) {
      return res.status(400).json({ error: 'شناسه معتبر نیست.' });
    }

    const existingUser = findUserByPhone(rawPhone);
    if (isUserBannedByPhone(rawPhone)) {
      return res.status(403).json({ error: 'حساب شما مسدود شده است' });
    }
    if (mode === 'signup' && existingUser && String(existingUser.user_id) !== String(rawId)) {
      return res.status(409).json({ error: 'این شماره قبلاً ثبت‌نام شده است', redirectTo: 'login' });
    }
    if (mode === 'login' && !existingUser) {
      return res.status(404).json({ error: 'حسابی با این شماره یافت نشد', redirectTo: 'signup' });
    }

    const payloadProfile =
      mode === 'login' && existingUser
        ? {
            id: existingUser.user_id,
            name: existingUser.name,
            age: existingUser.age,
            phone: rawPhone
          }
        : {
            id: rawId,
            name: rawName,
            age: rawAge,
            phone: rawPhone
          };

    const userId = ensureUserExists(payloadProfile);

    return res.json({
      success: true,
      userId,
      profile: {
        name: payloadProfile.name,
        age: Number(payloadProfile.age),
        phone: rawPhone
      }
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : 'unknown';
    if (error && typeof error === 'object' && error.code === 'PHONE_ALREADY_IN_USE') {
      return res.status(409).json({ error: 'این شماره قبلاً ثبت‌نام شده است', redirectTo: 'login' });
    }
    logError('register_profile_failed', '/api/register-profile', 500, details);
    log('REGISTER_PROFILE', 'failed', { details });
    return res.status(500).json({ error: 'ثبت پروفایل با خطا مواجه شد.' });
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
    const normalizedConversationId =
      typeof conversationId === 'string' && conversationId.trim().length > 0 ? conversationId.trim() : 'default';

    logEvent(userId, 'message_sent', category, {
      messageLength: trimmedMessage.length,
      requestId
    });

    const normalizedHistory = normalizeHistory(history, trimmedMessage);
    const storedHistory = conversationMemory.get(memoryKey);
    const dbHistory = getConversationMessages(userId, normalizedConversationId);
    let effectiveHistory =
      Array.isArray(storedHistory) && storedHistory.length > normalizedHistory.length ? [...storedHistory] : normalizedHistory;
    if (dbHistory.length > effectiveHistory.length) {
      effectiveHistory = [...dbHistory];
    }
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

    const systemPrompt = await getSystemPrompt();
    const messages = [
      {
        role: 'system',
        content: systemPrompt
      },
      ...effectiveHistory
    ];

    const isFirstMessage = normalizedHistory.length === 1;
    const rawReply = await callGemini(messages);
    const reply = removeExtraGreeting(rawReply, isFirstMessage);
    const nextConversationMessages = [...effectiveHistory, { role: 'assistant', content: reply }];
    conversationMemory.set(memoryKey, nextConversationMessages);
    saveConversationMessages(userId, normalizedConversationId, nextConversationMessages);

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

app.post('/api/conversations/load', (req, res) => {
  try {
    const profile = req.body?.profile || {};
    const userId = ensureUserExists(profile);
    const items = getUserConversations(userId);

    return res.json({
      success: true,
      userId,
      items
    });
  } catch (error) {
    logError('load_conversations_failed', '/api/conversations/load', 500, error instanceof Error ? error.message : 'unknown');
    return res.status(500).json({ error: 'بارگذاری گفتگوها با خطا مواجه شد.' });
  }
});

app.post('/api/conversations/sync', (req, res) => {
  try {
    const profile = req.body?.profile || {};
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const userId = ensureUserExists(profile);

    const normalizedItems = rawItems.map((item) => ({
      conversation_id: typeof item?.id === 'string' ? item.id : String(item?.id || 'default'),
      title: typeof item?.title === 'string' ? item.title : '',
      pinned: Boolean(item?.pinned),
      created_at: item?.createdAt || now(),
      updated_at: item?.updatedAt || item?.createdAt || now(),
      messages: Array.isArray(item?.messages)
        ? item.messages.map((msg) => ({
            role: msg?.role,
            content: msg?.content,
            timestamp: msg?.timestamp
          }))
        : []
    }));

    const savedCount = replaceUserConversations(userId, normalizedItems);
    return res.json({ success: true, savedCount });
  } catch (error) {
    logError('sync_conversations_failed', '/api/conversations/sync', 500, error instanceof Error ? error.message : 'unknown');
    return res.status(500).json({ error: 'ذخیره گفتگوها با خطا مواجه شد.' });
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

const { router: adminRouter } = createAdminRouter({
  jwtSecret: adminJwtSecret,
  cookieName: adminCookieName,
  onSystemPromptUpdated: invalidateSystemPromptCache
});
app.use('/api/admin', adminRouter);

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'hemraz-backend',
    model: defaultModel,
    baseUrl: geminiBaseUrl
  });
});

// Compatibility health endpoints for platform probes.
app.get('/health', (_req, res) => {
  res.status(200).send('ok');
});

app.get('/healthz', (_req, res) => {
  res.status(200).send('ok');
});

app.use(express.static(path.join(__dirname, '../../frontend/dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
});

const server = app.listen(port, host, () => {
  log('BOOT', 'backend_started', {
    host,
    port,
    model: defaultModel,
    baseUrl: geminiBaseUrl,
    timeoutMs: defaultTimeoutMs
  });
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.requestTimeout = 30000;
