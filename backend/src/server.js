const express = require('express');
const cors = require('cors');
const compression = require('compression');
const axios = require('axios');
const dotenv = require('dotenv');
const OpenAI = require('openai');
const path = require('path');
const fs = require('fs-extra');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
dotenv.config({
  path: path.join(__dirname, '../.env')
});
const db = require('../db');
const { createAdminRouter } = require('./adminRoutes');
const smsRoutes = require('./routes/smsRoutes');
const otpService = require('./services/otp.service');
const patternSmsService = require('./services/sms.service');
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

const app = express();
const conversationMemory = new Map();

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
const normalizePhone = (value) => {
  if (typeof value !== 'string') return '';
  const cleaned = value.trim().replace(/[-\s]/g, '');
  if (cleaned.startsWith('+98')) return `0${cleaned.slice(3)}`;
  if (cleaned.startsWith('98')) return `0${cleaned.slice(2)}`;
  return cleaned;
};
const isValidPhone = (value) => /^09[0-9]{9}$/.test(value);
const normalizeBaseUrl = (value, fallback) => String(value || fallback).replace(/\/+$/, '');

const port = normalizePort(process.env.PORT, 3000);
const host = '0.0.0.0';
const metisBaseUrl = normalizeBaseUrl(
  process.env.METIS_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL,
  'https://api.metisai.ir/openai/v1'
);
const defaultModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const metisApiKey =
  typeof (process.env.METIS_API_KEY || process.env.OPENAI_API_KEY) === 'string'
    ? (process.env.METIS_API_KEY || process.env.OPENAI_API_KEY).trim()
    : '';
const defaultTimeoutMs = Number(process.env.GAPGPT_TIMEOUT_MS || 30000);
const adminApiKey = typeof process.env.ADMIN_API_KEY === 'string' ? process.env.ADMIN_API_KEY.trim() : '';
const adminJwtSecret = typeof process.env.ADMIN_JWT_SECRET === 'string' ? process.env.ADMIN_JWT_SECRET.trim() : 'danoa-admin-secret';
const adminPanelPath = process.env.ADMIN_PANEL_PATH || '/admin-secure-9x7k';
const adminCookieName = process.env.ADMIN_COOKIE_NAME || 'admin_token';
const adminConfigPath = path.join(__dirname, '../config.json');
const openaiClient = new OpenAI({
  apiKey: metisApiKey || 'missing-metis-api-key',
  baseURL: metisBaseUrl
});
const systemPromptPath = path.join(__dirname, '../system-prompt.txt');

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
    console.log(`[BOOT] DB mode=${db.dbInfo?.mode || 'unknown'}`);
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
    const fallbackPrompt = (await fs.readFile(systemPromptPath, 'utf8')).trim();
    const parsed = await fs.readJson(adminConfigPath);
    const configuredPrompt =
      typeof parsed?.systemPrompt === 'string' && parsed.systemPrompt.trim()
        ? parsed.systemPrompt.trim()
        : fallbackPrompt;

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
    systemPromptCache = '';
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

const buildChatMessages = (messages) =>
  (Array.isArray(messages) ? messages : [])
    .filter(
      (item) =>
        item &&
        (item.role === 'system' || item.role === 'user' || item.role === 'assistant') &&
        typeof item.content === 'string' &&
        item.content.trim().length > 0
    )
    .map((item) => ({
      role: item.role,
      content: item.content.trim()
    }));

const extractReply = (response) => {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  return '';
};

const removeExtraGreeting = (text, isFirstMessage) => {
  if (typeof text !== 'string') return '';
  if (isFirstMessage) return text;

  const cleaned = text.trimStart();
  const greetingPattern =
    /^(?:(?:سلام(?:\s+(?:دوباره|مجدد))?)|درود|(?:من\s+دانوآ\s+هستم)|(?:من\s+دانوآم))(?:[\s،,:!.\-—]+|$)/i;

  return cleaned.replace(greetingPattern, '').trimStart();
};

const withTimeout = async (promise, timeoutMs) => {
  let timer = null;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const timeoutError = new Error('UPSTREAM_TIMEOUT');
          timeoutError.code = 'UPSTREAM_TIMEOUT';
          reject(timeoutError);
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const postOpenAIChatCompletion = async (payload, timeoutMs) => {
  const response = await axios.post(`${metisBaseUrl}/chat/completions`, payload, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${metisApiKey}`
    },
    timeout: timeoutMs
  });

  return response.data;
};

const callOpenAI = async (messages) => {
  if (!metisApiKey) {
    const error = new Error('METIS_API_KEY is missing');
    error.code = 'API_KEY_MISSING';
    throw error;
  }

  const runtimeConfig = await getRuntimeConfig();
  const payload = {
    model: runtimeConfig.model,
    messages: buildChatMessages(messages),
    temperature: 0.6
  };
  const totalTimeoutMs = Math.max(5000, runtimeConfig.timeoutMs);
  const sdkTimeoutMs = Math.min(8000, totalTimeoutMs);
  const fallbackTimeoutMs = Math.max(5000, totalTimeoutMs - sdkTimeoutMs);

  try {
    let response = null;

    try {
      response = await withTimeout(
        openaiClient.chat.completions.create(payload, {
          timeout: sdkTimeoutMs,
          maxRetries: 0
        }),
        sdkTimeoutMs
      );
    } catch (sdkError) {
      const shouldFallback =
        sdkError &&
        typeof sdkError === 'object' &&
        (sdkError.code === 'UPSTREAM_TIMEOUT' ||
          sdkError.name === 'APIConnectionError' ||
          sdkError.name === 'APIConnectionTimeoutError' ||
          sdkError.name === 'InternalServerError');

      if (!shouldFallback) {
        throw sdkError;
      }

      response = await postOpenAIChatCompletion(payload, fallbackTimeoutMs);
    }

    const reply = extractReply(response);

    if (!reply) {
      const error = new Error('EMPTY_UPSTREAM_REPLY');
      error.code = 'EMPTY_UPSTREAM_REPLY';
      error.details = response;
      throw error;
    }

    return reply;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'UPSTREAM_TIMEOUT') {
      throw error;
    }

    const status = Number(error?.status || error?.cause?.status || error?.response?.status);
    const details =
      error?.error ||
      error?.response?.data ||
      error?.cause ||
      (error instanceof Error ? error.message : 'unknown_error');

    if (error && typeof error === 'object' && error.code === 'ECONNABORTED') {
      const timeoutError = new Error('UPSTREAM_TIMEOUT');
      timeoutError.code = 'UPSTREAM_TIMEOUT';
      throw timeoutError;
    }

    if (!Number.isInteger(status)) {
      const networkError = new Error('UPSTREAM_FETCH_FAILED');
      networkError.code = 'UPSTREAM_FETCH_FAILED';
      networkError.details = {
        baseUrl: metisBaseUrl,
        cause: details
      };
      throw networkError;
    }

    const upstreamError = new Error('UPSTREAM_REQUEST_FAILED');
    upstreamError.code = 'UPSTREAM_REQUEST_FAILED';
    upstreamError.details = {
      status,
      details
    };
    throw upstreamError;
  }
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


app.post('/api/send-verification-code', async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const mode = typeof req.body?.mode === 'string' ? req.body.mode.trim() : '';

    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: 'شماره موبایل معتبر نیست.' });
    }

    const phoneExists = Boolean(await findUserByPhone(phone));

    if (mode === 'signup' && phoneExists) {
      return res.status(409).json({ error: 'این شماره قبلاً ثبت‌نام شده است', redirectTo: 'login', phoneExists });
    }

    if (mode === 'login' && !phoneExists) {
      return res.status(404).json({ error: 'حسابی با این شماره یافت نشد', redirectTo: 'signup', phoneExists });
    }

    const resend = otpService.canResend(phone);
    if (!resend.allowed) {
      return res.status(429).json({
        error: 'لطفا کمی صبر کنید و دوباره تلاش کنید.',
        retryAfter: resend.retryAfterSeconds
      });
    }

    const code = otpService.generateOtp();
    console.log('[OTP] code generated', {
      phone,
      codeLength: String(code).length,
      createdAt: new Date().toISOString()
    });

    const smsResult = await patternSmsService.sendVerificationCode(phone, code);
    if (!smsResult?.success) {
      return res.status(smsResult?.status || 500).json({ error: 'ارسال کد با خطا مواجه شد.' });
    }

    // Store OTP only after provider confirms send.
    otpService.saveOtp(phone, code);

    console.log('[OTP] verification code created', {
      phone,
      mode,
      expiresIn: otpService.getExpirySeconds(),
      createdAt: new Date().toISOString()
    });

    return res.json({ success: true, expiresIn: otpService.getExpirySeconds() });
  } catch (error) {
    console.error('[OTP] send-verification-code failed', {
      message: error instanceof Error ? error.message : 'unknown',
      status: error?.response?.status || null,
      responseBody: error?.response?.data || null
    });
    await logError('verification_code_failed', '/api/send-verification-code', 500, error instanceof Error ? error.message : 'unknown');
    return res.status(500).json({ error: 'ارسال کد با خطا مواجه شد.' });
  }
});

app.post('/api/auth/phone-status', async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const mode = typeof req.body?.mode === 'string' ? req.body.mode.trim() : '';

    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: 'شماره موبایل معتبر نیست.' });
    }

    const user = await findUserByPhone(phone);
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
    await logError('phone_status_failed', '/api/auth/phone-status', 500, error instanceof Error ? error.message : 'unknown');
    return res.status(500).json({ error: 'بررسی شماره موبایل با خطا مواجه شد.' });
  }
});

app.post('/api/verify-code', async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const rawCode = typeof req.body?.code === 'string' || typeof req.body?.code === 'number'
      ? String(req.body.code).trim()
      : '';
    const normalizedCode = rawCode
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776))
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632));
    const code = normalizedCode.replace(/\D/g, '');
    const mode = typeof req.body?.mode === 'string' ? req.body.mode.trim() : '';

    console.log('[OTP] verify-code request', {
      phone,
      mode,
      rawCodeLength: rawCode.length,
      normalizedCodeLength: normalizedCode.length,
      digitOnlyCodeLength: code.length
    });

    if (!isValidPhone(phone) || !/^[0-9]{5,6}$/.test(code)) {
      console.warn('[OTP] verify-code validation failed', {
        phoneValid: isValidPhone(phone),
        codeRegexPassed: /^[0-9]{5,6}$/.test(code)
      });
      return res.status(400).json({ success: false, error: 'کد منقضی شده یا نامعتبر است' });
    }

    const verifyResult = otpService.verifyOtp(phone, code);
    if (!verifyResult.valid) {
      console.warn('[OTP] verify-code failed', {
        phone,
        reason: verifyResult.reason,
        remainingAttempts: verifyResult.remainingAttempts || null,
        retryAfterSeconds: verifyResult.retryAfterSeconds || null
      });
      if (verifyResult.reason === 'too_many_attempts') {
        return res.status(429).json({
          success: false,
          error: 'تعداد تلاش ناموفق بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.',
          retryAfter: verifyResult.retryAfterSeconds || otpService.getExpirySeconds()
        });
      }
      if (verifyResult.reason === 'invalid_code') {
        return res.status(400).json({
          success: false,
          error: 'کد نادرست است',
          remainingAttempts: verifyResult.remainingAttempts
        });
      }
      if (verifyResult.reason === 'expired') {
        return res.status(410).json({ success: false, error: 'کد منقضی شده است. دوباره درخواست کد بدهید.' });
      }
      if (verifyResult.reason === 'not_found') {
        return res.status(404).json({ success: false, error: 'کدی برای این شماره پیدا نشد. دوباره درخواست کد بدهید.' });
      }
      return res.status(400).json({ success: false, error: 'کد منقضی شده یا نامعتبر است' });
    }

    const phoneExists = Boolean(await findUserByPhone(phone));
    if (mode === 'signup' && phoneExists) {
      return res.status(409).json({ success: false, error: 'این شماره قبلاً ثبت‌نام شده است', redirectTo: 'login' });
    }
    if (mode === 'login' && !phoneExists) {
      return res.status(404).json({ success: false, error: 'حسابی با این شماره یافت نشد', redirectTo: 'signup' });
    }

    console.log('[OTP] verification successful', {
      phone,
      mode,
      verifiedAt: new Date().toISOString()
    });
    return res.json({ success: true });
  } catch (error) {
    await logError('verify_code_failed', '/api/verify-code', 500, error instanceof Error ? error.message : 'unknown');
    return res.status(500).json({ success: false, error: 'تأیید کد با خطا مواجه شد.' });
  }
});

app.post('/api/register-profile', async (req, res) => {
  try {
    const inputName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const rawName = inputName || 'کاربر';
    const rawPhone = normalizePhone(req.body?.phone);
    const rawAge = Number(req.body?.age);
    const rawId = req.body?.id;
    const mode = typeof req.body?.mode === 'string' ? req.body.mode.trim() : '';

    if (!isValidPhone(rawPhone)) {
      return res.status(400).json({ error: 'شماره موبایل معتبر نیست.' });
    }

    const existingUser = await findUserByPhone(rawPhone);

    console.log('[AUTH] register-profile request', {
      phone: rawPhone,
      mode,
      hasInputName: Boolean(inputName),
      resolvedName: rawName
    });
    if (await isUserBannedByPhone(rawPhone)) {
      return res.status(403).json({ error: 'حساب شما مسدود شده است' });
    }
    if (mode === 'signup' && existingUser && String(existingUser.user_id) !== String(rawId)) {
      return res.status(409).json({ error: 'این شماره قبلاً ثبت‌نام شده است', redirectTo: 'login' });
    }
    if (mode === 'login' && !existingUser) {
      return res.status(404).json({ error: 'حسابی با این شماره یافت نشد', redirectTo: 'signup' });
    }

    if (mode !== 'login') {
      if (!Number.isFinite(rawAge)) {
        return res.status(400).json({ error: 'سن معتبر نیست.' });
      }
      if (!(typeof rawId === 'string' || typeof rawId === 'number')) {
        return res.status(400).json({ error: 'شناسه معتبر نیست.' });
      }
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

    const userId = await ensureUserExists(payloadProfile);

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
    await logError('register_profile_failed', '/api/register-profile', 500, details);
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

    if (!metisApiKey) {
      await logError('api_key_missing', '/api/chat', 500, 'METIS_API_KEY is missing');
      return res.status(500).json({ error: 'کلید API تنظیم نشده است.' });
    }

    if (!trimmedMessage) {
      return res.status(400).json({ error: 'پیام معتبر ارسال نشده است.' });
    }

    const userId = await ensureUserExists(profile || {});
    const category = detectCategory(trimmedMessage);
    const memoryKey =
      typeof conversationId === 'string' && conversationId.trim().length > 0
        ? `${userId}:${conversationId.trim()}`
        : `${userId}:default`;
    const normalizedConversationId =
      typeof conversationId === 'string' && conversationId.trim().length > 0 ? conversationId.trim() : 'default';

    await logEvent(userId, 'message_sent', category, {
      messageLength: trimmedMessage.length,
      requestId
    });

    const normalizedHistory = normalizeHistory(history, trimmedMessage);
    const storedHistory = conversationMemory.get(memoryKey);
    const dbHistory = await getConversationMessages(userId, normalizedConversationId);
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
    const rawReply = await callOpenAI(messages);
    const reply = removeExtraGreeting(rawReply, isFirstMessage);
    const nextConversationMessages = [...effectiveHistory, { role: 'assistant', content: reply }];
    conversationMemory.set(memoryKey, nextConversationMessages);
    await saveConversationMessages(userId, normalizedConversationId, nextConversationMessages);

    await logEvent(userId, 'message_received', category, {
      responseLength: reply.length,
      requestId
    });

    return res.json({ reply });
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'UPSTREAM_TIMEOUT') {
      await logError('openai_timeout', '/api/chat', 504, 'Upstream timeout reached');
      return res.status(504).json({ error: 'زمان پاسخ مدل طولانی شد. لطفاً دوباره تلاش کن.' });
    }

    if (error && typeof error === 'object' && error.code === 'UPSTREAM_FETCH_FAILED') {
      await logError('openai_fetch_failed', '/api/chat', 502, JSON.stringify(error.details || {}));
      return res.status(502).json({
        error: 'ارتباط با سرویس مدل برقرار نشد.',
        details: 'اتصال شبکه، DNS یا METIS_OPENAI_BASE_URL را بررسی کنید.'
      });
    }

    if (error && typeof error === 'object' && error.code === 'UPSTREAM_REQUEST_FAILED') {
      const status = Number(error?.details?.status);
      const safeStatus = Number.isInteger(status) && status >= 400 ? status : 502;
      await logError('openai_upstream_error', '/api/chat', safeStatus, JSON.stringify(error.details || {}));
      return res.status(safeStatus).json({
        error: 'خطا از سرویس مدل دریافت شد.',
        details: error?.details?.details || 'unknown_upstream_error'
      });
    }

    if (error && typeof error === 'object' && error.code === 'EMPTY_UPSTREAM_REPLY') {
      await logError('invalid_upstream_response', '/api/chat', 502, JSON.stringify(error.details || {}));
      return res.status(502).json({ error: 'پاسخ نامعتبر از مدل دریافت شد.' });
    }

    await logError('unknown', '/api/chat', null, error instanceof Error ? error.stack || error.message : 'unknown_error');

    return res.status(500).json({
      error: 'مشکلی در سرور پیش آمد.',
      details: error instanceof Error ? error.message : 'unknown_error'
    });
  }
});

app.post('/api/conversations/load', async (req, res) => {
  try {
    const profile = req.body?.profile || {};
    const userId = await ensureUserExists(profile);
    const items = await getUserConversations(userId);

    return res.json({
      success: true,
      userId,
      items
    });
  } catch (error) {
    await logError('load_conversations_failed', '/api/conversations/load', 500, error instanceof Error ? error.message : 'unknown');
    return res.status(500).json({ error: 'بارگذاری گفتگوها با خطا مواجه شد.' });
  }
});

app.post('/api/conversations/sync', async (req, res) => {
  try {
    const profile = req.body?.profile || {};
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const userId = await ensureUserExists(profile);

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

    const savedCount = await replaceUserConversations(userId, normalizedItems);
    return res.json({ success: true, savedCount });
  } catch (error) {
    await logError('sync_conversations_failed', '/api/conversations/sync', 500, error instanceof Error ? error.message : 'unknown');
    return res.status(500).json({ error: 'ذخیره گفتگوها با خطا مواجه شد.' });
  }
});

// SMS Routes
app.use('/api/sms', smsRoutes);
console.log('[SMS] routes mounted');

app.get('/api/admin/stats', async (req, res) => {
  if (!adminApiKey) {
    return res.status(404).json({ error: 'Not found' });
  }

  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  if (authHeader !== `Bearer ${adminApiKey}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return res.json(await getStats());
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
    baseUrl: metisBaseUrl
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
    baseUrl: metisBaseUrl,
    timeoutMs: defaultTimeoutMs
  });
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.requestTimeout = 30000;
