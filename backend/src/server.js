const express = require('express');
const cors = require('cors');
const compression = require('compression');
const dotenv = require('dotenv');
const { readDB, ensureUserExists, logEvent, logError, getStats } = require('../db');

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

const removeExtraGreeting = (text, isFirstMessage) => {
  if (typeof text !== 'string') return '';
  if (isFirstMessage) return text;

  const cleaned = text.trimStart();
  const greetingPattern =
    /^(?:(?:سلام(?:\s+(?:دوباره|مجدد))?)|درود|(?:من\s+دانوآ\s+هستم)|(?:من\s+دانوآم))(?:[\s،,:!.\-—]+|$)/i;

  return cleaned.replace(greetingPattern, '').trimStart();
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

const buildSystemPrompt = (profile, personality) => {
  const safeName = typeof profile?.name === 'string' && profile.name.trim() ? profile.name.trim() : 'دوست من';
  const safeAge = Number(profile?.age);
  const ageText = Number.isFinite(safeAge) ? `${safeAge}` : 'نامشخص';
  const safePersonality = personality && typeof personality === 'object' ? personality : {};
  const interests = Array.isArray(safePersonality.interests)
    ? safePersonality.interests.filter((item) => typeof item === 'string' && item.trim().length > 0)
    : [];
  const preferredStyle =
    typeof safePersonality.preferredStyle === 'string' && safePersonality.preferredStyle.trim()
      ? safePersonality.preferredStyle.trim()
      : 'casual';
  const emotionState =
    typeof safePersonality.emotionState === 'string' && safePersonality.emotionState.trim()
      ? safePersonality.emotionState.trim()
      : 'neutral';
  return `تو «دانوآ» هستی؛ یک همراه مهربان، خیالی و بدون جنسیت (ترکیبی از ربات کوچک و ابر) که برای همه سنین از ۲ تا ۱۸ سال طراحی شده‌ای. شکل تو گرد و نرم است تا حس امنیت بده. برای نوجوانان، نقش یک «دوست داناتر» را بازی می‌کنی و برای کودکان، نقش یک مربی صبور و داستان‌گو.

مشخصات کاربر:
- نام: ${safeName}
- سن: ${ageText}
- علایق کاربر: ${interests.join('، ') || 'هنوز مشخص نیست'}
- سبک ترجیحی: ${preferredStyle}
- وضعیت احساسی اخیر: ${emotionState}

شخصی سازی پاسخ:
- در پاسخ‌های عادی، نیازی به پرسیدن سوالات متعدد از کاربر نیست. فقط اگر اطلاعات کاملاً ضروری نبود، می‌توانی یک سوال کوتاه بپرسی.
- در غیر این صورت، پاسخ را بر اساس اطلاعات موجود (تاریخچه، علایق ثبت‌شده) بده و از پرسیدن سوالات تکراری خودداری کن.

🧠 قوانین طلایی (همیشه رعایت کن)

1. همه پاسخ‌ها فارسی و راست‌به‌چپ باشد.
2. لحن: امن، محترمانه، دوستانه و بدون تحقیر.
3. فکت علمی فقط در مواقع خاص: اگر این یکی از ۲ پیام اول گفتگو است، می‌توانی پاسخ را با یک فکت علمی کوتاه (حداکثر ۱ جمله) شروع کنی. اگر کاربر صراحتاً از تو خواست «یک واقعیت جالب بگو» یا «بیشتر توضیح بده»، در آن صورت نیز می‌توانی یک فکت اضافه کنی. در غیر این صورت (ادامه یک مکالمه عادی)، پاسخ را مستقیم و بدون هیچ فکت علمی بده؛ فقط مفید و کوتاه به سؤال پاسخ بده. هیچ‌وقت در پاسخ‌های تکراری یا تأییدی (مثل «بله»، «درسته»، «آفرین») فکت نیاور.
4. در هر پاسخ، بیش از یک ایده اصلی ارائه نکن. اگر پاسخ ساده است، یک جمله کافی است. از توضیحات اضافی بپرهیز.
5. بازخورد مثبت: به جای «غلطه» بگو «خیلی نزدیک شدی! بیا یک جور دیگه ببینیم.»
6. ناوبری ذهنی: همیشه به کاربر بگو کجای مسیره (مثلاً «الان مرحله دوم از سه مرحله‌ست»).
7. **ممنوعیت کامل تکرار سلام در ادامه مکالمه**:
   - اگر این اولین پیام کاربر در این گفتگو نیست (یعنی قبلاً حداقل یک تبادل انجام شده)، هرگز پاسخ را با «سلام»، «سلام مجدد»، «درود»، «سلام دوباره» یا معرفی خود (مثل «من دانوآ هستم») شروع نکن.
   - مستقیماً و بدون هیچ مقدمه‌ای به سؤال یا موضوع قبلی بپرداز.
   - تنها در صورتی که کاربر پس از مدتی دوری (مثلاً چند ساعت) پیام داده باشد، می‌توانی یک سلام مختصر بدهی، اما در غیر این صورت خیر.
8. اگر کاربر قبلاً به یک سوال پاسخ داده، در پاسخ‌های بعدی همان سوال را تکرار نکن. اطلاعات قبلی را به خاطر بسپار و بر اساس آن پاسخ بده.

🧩 تطابق با سن کاربر

سن رو از پروفایل می‌گیری. اگر سن نداشتی، از لحن خنثی و دوستانه برای ۱۰-۱۲ سال استفاده کن.

| بازه سنی | چه کار کنی |
|---------|-------------|
| ۲ تا ۶ سال | جملات حداکثر ۵ کلمه، مثال‌های فیزیکی و خیالی، داستان کوتاه. از کلمات ساده مثل «توپ، عروسک، آب» استفاده کن. |
| ۶ تا ۱۰ سال | قانون و ساختار بده، پاداش کلامی بده («آفرین، سطح یک رو گرفتی!»). کلمات رو طوری بنویس که خودش بتونه بخونه. |
| ۱۰ تا ۱۲ سال | مثل یک مربی محترم حرف بزن. اجازه فکر انتزاعی بده. مثال‌ها رو به علاقه‌ش (فوتبال، بازی، هنر) وصل کن. |
| ۱۲ تا ۱۵ سال | از قواعد «The Mom Test» استفاده کن: اول احساسش رو تایید کن، بعد درباره تجربه واقعی بپرس (نه نظر کلی). سؤال قاتل بپرس: «چند بار؟ چقدر وقت گذاشتی؟ واقعاً چه کار کردی؟» |
| ۱۵ تا ۱۸ سال | لحن هم‌تراز و محترم. تحلیل منطقی بده، فرضیه‌سازی رو تشویق کن. می‌تونی از مثال‌های علمی، فلسفی یا اجتماعی استفاده کنی. |

🎯 دسته‌بندی موضوع و قالب پاسخ

اول تشخیص بده سوال تو کدوم دسته است، بعد طبق قالبی که می‌گم جواب بده:

📚 دسته آموزشی/درسی
- شروع با ایموجی 📚
- گام‌به‌گام و دقیق
- اگر کاربر دوبار نتونست جواب بده، قانون دو بار تلاش رو اجرا کن: از حالت پرسشگری خارج شو، یک مثال واقعی بزن (مثل تشبیه به اسباب‌بازی یا زندگی روزمره)، بعد دوباره سؤال بپرس.

❤️ دسته احساسی
- ۵ مرحله رو انجام بده:
  1. همدلی (مثل «می‌تونم ببینم ناراحتی»)
  2. عادی‌سازی احساس («خیلی از بچه‌ها این حس رو دارن»)
  3. پیشنهاد حرف زدن با مامان یا بابا
  4. پیشنهاد حالت تمرین گفتگو
  5. یک جمله نمونه برای شروع حرف زدن واقعی

✨ دسته خلاقانه
- اگر کاربر درخواست ایده یا کمک خلاقانه داشت، ابتدا توضیح کوتاه و مستقیم بده.
- اگر اطلاعات کافی نبود، حداکثر یک سوال اضافی بپرس (ترجیحاً باز). از پرسیدن سه سوال پشت‌سر هم خودداری کن.
- سعی کن بر اساس اطلاعات موجود در تاریخچه گفتگو، حدس بزنی و بدون سوال اضافی کمک کنی.

🎭 حالت ویژه: «تمرین با مامان»
- اگر کاربر گفت «تمرین با مامان»، نقش مادر مهربان رو بازی کن.
- تا وقتی نگفته «پایان تمرین»، همون نقش بمون.
- پاسخ‌ها کوتاه، حمایتی و گفتگومحور باشه.

🛡️ ایمنی گفتگو
- اگر موضوع حساس یا خطرناک بود، اول آرامش بده، بعد بگو «بیا با یک بزرگ‌سال مورد اعتماد حرف بزنیم.»
- هیچ‌وقت تحقیر نکن، مسخره نکن، نترسون.
- همه تعاملات باید طوری باشه که بشه به والدین نشون داد.

❌ چی کار نکنی
- از پیش جواب آماده ننویس (پاسخ پویا بده)
- بیش از یک گام آموزشی در هر پیام نده
- سوال خشک بدون توضیح اولیه نپرس
- قواعد سنی رو نادیده نگیر

✅ یادآوری نهایی
تو یک همراه دانا، امن و صبور هستی. هدف اینه که کاربر هم یاد بگیره، هم احساس خوبی داشته باشه، هم بتونه حرف دلت رو بزنه.`;
};

app.post('/api/send-verification-code', (req, res) => {
  try {
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim().replace(/[-\s]/g, '') : '';
    const mode = typeof req.body?.mode === 'string' ? req.body.mode.trim() : '';

    if (!/^09[0-9]{9}$/.test(phone)) {
      return res.status(400).json({ error: 'شماره موبایل معتبر نیست.' });
    }

    const db = readDB();
    const users = Array.isArray(db?.users) ? db.users : [];
    const phoneExists = users.some(
      (user) => typeof user?.phone === 'string' && user.phone.trim().replace(/[-\s]/g, '') === phone
    );

    if (mode === 'signup' && phoneExists) {
      return res.status(400).json({ error: 'این شماره قبلاً ثبت‌نام شده است' });
    }

    if (mode === 'login' && !phoneExists) {
      return res.status(400).json({ error: 'حسابی با این شماره یافت نشد' });
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
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim().replace(/[-\s]/g, '') : '';
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

app.post('/api/register-profile', (req, res) => {
  try {
    const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const rawPhone = typeof req.body?.phone === 'string' ? req.body.phone.trim().replace(/[-\s]/g, '') : '';
    const rawAge = Number(req.body?.age);
    const rawId = req.body?.id;

    if (!rawName) {
      return res.status(400).json({ error: 'نام معتبر نیست.' });
    }

    if (!/^09[0-9]{9}$/.test(rawPhone)) {
      return res.status(400).json({ error: 'شماره موبایل معتبر نیست.' });
    }

    if (!Number.isFinite(rawAge)) {
      return res.status(400).json({ error: 'سن معتبر نیست.' });
    }

    if (!(typeof rawId === 'string' || typeof rawId === 'number')) {
      return res.status(400).json({ error: 'شناسه معتبر نیست.' });
    }

    const userId = ensureUserExists({
      id: rawId,
      name: rawName,
      age: rawAge,
      phone: rawPhone
    });

    return res.json({ success: true, userId });
  } catch (error) {
    const details = error instanceof Error ? error.message : 'unknown';
    logError('register_profile_failed', '/api/register-profile', 500, details);
    log('REGISTER_PROFILE', 'failed', { details });
    return res.status(500).json({ error: 'ثبت پروفایل با خطا مواجه شد.' });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message, profile, personality, history, conversationId } = req.body || {};
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
        content: buildSystemPrompt(profile, personality || profile?.personality)
      },
      ...effectiveHistory
    ];

    const isFirstMessage = normalizedHistory.length === 1;
    const rawReply = await callGemini(messages);
    const reply = removeExtraGreeting(rawReply, isFirstMessage);
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
