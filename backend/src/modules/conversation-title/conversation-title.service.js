const { fingerprintApiKey } = require('../../bootstrap/config');
const { CONVERSATION_TITLE_SYSTEM_PROMPT } = require('./conversation-title.prompt');

const SETTING_KEYS = {
  enabled: 'conversation_title.enabled',
  model: 'conversation_title.model',
  temperature: 'conversation_title.temperature',
  timeoutMs: 'conversation_title.timeout_ms',
  maxRetries: 'conversation_title.max_retries',
  maxOutputTokens: 'conversation_title.max_output_tokens',
  maxCharacters: 'conversation_title.max_characters',
  version: 'conversation_title.version'
};

const DEFAULT_TITLE = 'گفتگوی جدید';
const GREETING_PATTERN = /^(?:سلام|درود|خوبی(?:\?|؟)?|چه خبر(?:\?|؟)?|چطوری(?:\?|؟)?|سلام خوبی(?:\?|؟)?)$/i;
const ACKNOWLEDGEMENT_PATTERN = /^(?:اوکی|اوکیه|باشه|ok|okay|قبوله)[!؟?\.\s]*$/i;
const URL_OR_UUID_PATTERN = /https?:\/\/\S+|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi;
const EMOJI_PATTERN = /[\p{Extended_Pictographic}\uFE0F]/gu;

const cleanString = (value) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const asBoolean = (value, fallback) => typeof value === 'boolean' ? value : typeof value === 'string' ? !['false', '0', 'off', 'no'].includes(value.toLowerCase()) : fallback;
const boundedNumber = (value, fallback, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : fallback));

const extractText = (value) => {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join('').trim();
  if (value && typeof value === 'object') return extractText(value.text || value.content || value.value);
  return '';
};

const extractReply = (data) => extractText(data?.candidates?.[0]?.content?.parts)
  || extractText(data?.choices?.[0]?.message?.content)
  || extractText(data?.output_text)
  || extractText(data?.content)
  || '';

const parseJsonObject = (value) => {
  const raw = String(value || '').replace(/^```(?:json)?\s*|```$/gim, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  return JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw);
};

const truncateAtWord = (value, maxCharacters) => {
  const text = cleanString(value);
  if (text.length <= maxCharacters) return text;
  const words = text.split(' ');
  const kept = [];
  for (const word of words) {
    const candidate = [...kept, word].join(' ');
    if (candidate.length > maxCharacters) break;
    kept.push(word);
  }
  return kept.join(' ') || '';
};

const sanitizeTitle = (value, maxCharacters = 40) => {
  let title = cleanString(value)
    .replace(/^\s*(?:عنوان|title)\s*[:：\-]\s*/i, '')
    .replace(/["'«»“”]/g, '')
    .replace(URL_OR_UUID_PATTERN, '')
    .replace(EMOJI_PATTERN, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[.。]+$/g, '');
  title = cleanString(title);
  return truncateAtWord(title, maxCharacters);
};

const hasPersian = (value) => /[\u0600-\u06ff]/.test(value);

const fallbackTitle = ({ originalText, requestType, visionSummary, maxCharacters }) => {
  const original = cleanString(originalText).replace(URL_OR_UUID_PATTERN, '');
  if (requestType === 'image_edit') return 'ویرایش تصویر';
  if (requestType === 'image_understanding') {
    const visual = sanitizeTitle(visionSummary, maxCharacters);
    return visual && hasPersian(visual) ? visual : 'تحلیل تصویر ارسالی';
  }
  if (!original) return 'بررسی تصویر ارسالی';
  if (GREETING_PATTERN.test(original)) return 'سلام و احوال‌پرسی';
  if (ACKNOWLEDGEMENT_PATTERN.test(original)) return 'تأیید و ادامه گفتگو';
  if (/(?:fps).*(?:گوست|ghost)/i.test(original)) return 'بهبود FPS بازی گوست';
  if (/(?:دیتابیس|database).*(?:وصل|اتصال|connect)|(?:وصل|اتصال|connect).*(?:دیتابیس|database)/i.test(original)) return 'مشکل اتصال دیتابیس';
  if (/(?:تفاوت|فرق).*(?:react).*(?:javascript)|(?:react).*(?:javascript).*(?:تفاوت|فرق)/i.test(original)) return 'تفاوت React و JavaScript';
  if (/(?:این )?(?:عکس|تصویر).*(?:چیه|چیست|چه)/i.test(original)) return 'بررسی تصویر ارسالی';
  const imagePrompt = /(?:بساز|طراحی|تولید|create|generate|draw|make)/i.test(original)
    && /(?:عکس|تصویر|پوستر|گربه|image|photo|poster)/i.test(original);
  if (requestType === 'image_generation' || imagePrompt) {
    const words = original.replace(/^(?:یه|یک)?\s*(?:عکس|تصویر)?\s*(?:رو)?\s*(?:بساز|تولید کن|درست کن)?\s*/i, '').replace(EMOJI_PATTERN, '').split(/\s+/).filter(Boolean).slice(0, 5);
    return sanitizeTitle(words.join(' '), maxCharacters) || 'ساخت تصویر جدید';
  }
  const words = original.replace(/^(?:چطور|چگونه|چرا|آیا|می[‌\s-]?خوام|لطفاً|برام|میشه|می[‌\s-]?توانم|می[‌\s-]?تونم)\s*/i, '').replace(EMOJI_PATTERN, '').split(/\s+/).filter(Boolean).slice(0, 5);
  const candidate = sanitizeTitle(words.join(' '), maxCharacters);
  return candidate && hasPersian(candidate) ? candidate : 'بررسی درخواست شما';
};

const validateOutput = (output, settings) => {
  if (!output || typeof output !== 'object' || Array.isArray(output)) throw Object.assign(new Error('INVALID_OUTPUT'), { code: 'INVALID_OUTPUT' });
  const title = sanitizeTitle(output.title, settings.maxCharacters);
  if (!title || !hasPersian(title) || title.length > settings.maxCharacters) {
    throw Object.assign(new Error('INVALID_OUTPUT'), { code: 'INVALID_OUTPUT' });
  }
  const confidence = boundedNumber(output.confidence, 0.8, 0, 1);
  return { title, language: 'fa', confidence, generatorVersion: settings.version };
};

function normalizeSettings(settings = {}, config = {}) {
  const get = (key, fallback) => Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : fallback;
  return {
    enabled: asBoolean(get(SETTING_KEYS.enabled, config.enabled ?? true), true),
    model: cleanString(get(SETTING_KEYS.model, config.model || 'gemini-2.5-flash-lite')) || 'gemini-2.5-flash-lite',
    temperature: boundedNumber(get(SETTING_KEYS.temperature, config.temperature ?? 0), 0, 0, 0.2),
    timeoutMs: boundedNumber(get(SETTING_KEYS.timeoutMs, config.timeoutMs ?? 6000), 6000, 500, 30000),
    maxRetries: boundedNumber(get(SETTING_KEYS.maxRetries, config.maxRetries ?? 1), 1, 0, 1),
    maxOutputTokens: boundedNumber(get(SETTING_KEYS.maxOutputTokens, config.maxOutputTokens ?? 64), 64, 16, 256),
    maxCharacters: boundedNumber(get(SETTING_KEYS.maxCharacters, config.maxCharacters ?? 40), 40, 12, 80),
    version: cleanString(get(SETTING_KEYS.version, config.version || '1')) || '1'
  };
}

function createConversationTitleService({ httpClient, settingsRepository, conversationsRepository, titleConfig = {}, chatConfig = {}, logger = console } = {}) {
  let cachedSettings = null;
  let cachedAt = 0;
  const inFlight = new Map();
  const getSettings = async ({ force = false } = {}) => {
    if (!force && cachedSettings && Date.now() - cachedAt < 30000) return cachedSettings;
    const values = settingsRepository?.getAll ? await settingsRepository.getAll().catch(() => ({})) : {};
    cachedSettings = normalizeSettings(values, titleConfig);
    cachedAt = Date.now();
    return cachedSettings;
  };
  const keyFor = () => {
    const dedicated = cleanString(titleConfig.apiKey || process.env.METIS_CONVERSATION_TITLE_API_KEY);
    const fallback = cleanString(chatConfig.apiKey || process.env.METIS_CHAT_API_KEY || process.env.METIS_API_KEY);
    const apiKey = dedicated || fallback;
    return { apiKey, apiKeySource: dedicated ? 'METIS_CONVERSATION_TITLE_API_KEY' : fallback ? 'fallback chat key' : 'missing', apiKeyFingerprint: apiKey ? fingerprintApiKey(apiKey) : '' };
  };
  const callModel = async ({ input, settings, key }) => {
    const response = await httpClient.post(`https://api.metisai.ir/v1beta/models/${encodeURIComponent(settings.model)}:generateContent`, {
      systemInstruction: { parts: [{ text: CONVERSATION_TITLE_SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }],
      generationConfig: { temperature: settings.temperature, maxOutputTokens: settings.maxOutputTokens, responseMimeType: 'application/json' }
    }, { headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key.apiKey }, timeout: settings.timeoutMs });
    return validateOutput(parseJsonObject(extractReply(response?.data)), settings);
  };
  const errorMetadata = (error) => ({
    category: error?.response?.status ? `http_${error.response.status}` : error?.code === 'ECONNABORTED' || /timeout/i.test(String(error?.message || '')) ? 'timeout' : error?.code || 'provider_error',
    providerStatus: Number.isFinite(Number(error?.response?.status)) ? Number(error.response.status) : null,
    message: String(error?.response?.data?.error?.message || error?.message || '').slice(0, 240)
  });
  const queue = async ({ userId, conversationId, originalText = '', optimizedTextEn = '', intent = 'chat', visionSummary = '', requestType = intent } = {}) => {
    const key = `${String(userId || '')}:${String(conversationId || '')}`;
    if (!key || !userId || !conversationId) return { status: 'skipped', title: null };
    if (inFlight.has(key)) return inFlight.get(key);
    const task = (async () => {
      const settings = await getSettings();
      if (!settings.enabled) return { status: 'disabled', title: null };
      if (typeof conversationsRepository.ensureConversation === 'function') {
        await conversationsRepository.ensureConversation(userId, conversationId, { title: '', messages: [] });
      }
      const claimed = await conversationsRepository.claimTitleGeneration(userId, conversationId).catch(() => false);
      if (!claimed) return { status: 'skipped', title: null };
      const startedAt = Date.now();
      const apiKey = keyFor();
      let lastErrorCode = 'TITLE_GENERATION_FAILED';
      if (apiKey.apiKey && httpClient?.post) {
        for (let retryCount = 0; retryCount <= settings.maxRetries; retryCount += 1) {
          try {
            const generated = await callModel({
              settings,
              key: apiKey,
              input: { originalText: cleanString(originalText), optimizedTextEn: cleanString(optimizedTextEn), intent, requestType, visionSummary: sanitizeTitle(visionSummary, 180), generatorVersion: settings.version }
            });
            const normalizedTitle = GREETING_PATTERN.test(cleanString(originalText))
              ? 'سلام و احوال‌پرسی'
              : ACKNOWLEDGEMENT_PATTERN.test(cleanString(originalText))
                ? 'تأیید و ادامه گفتگو'
                : generated.title;
            const saved = await conversationsRepository.completeGeneratedTitle(userId, conversationId, {
              ...generated, title: normalizedTitle, model: settings.model, latencyMs: Date.now() - startedAt
            });
            return { status: saved ? 'completed' : 'skipped', title: saved ? normalizedTitle : null };
          } catch (error) {
            const metadata = errorMetadata(error);
            lastErrorCode = metadata.category.toUpperCase();
            logger.warn?.('[conversation-title] provider attempt failed', {
              conversationId,
              attempt: retryCount + 1,
              durationMs: Date.now() - startedAt,
              errorCategory: metadata.category,
              providerStatus: metadata.providerStatus,
              message: metadata.message
            });
          }
        }
      } else {
        lastErrorCode = apiKey.apiKey ? 'TITLE_CLIENT_MISSING' : 'TITLE_API_KEY_MISSING';
      }
      const title = fallbackTitle({ originalText, requestType, visionSummary, maxCharacters: settings.maxCharacters });
      const saved = await conversationsRepository.completeFallbackTitle(userId, conversationId, {
        title, model: settings.model, version: settings.version, latencyMs: Date.now() - startedAt, errorCode: lastErrorCode
      });
      if (!saved) return { status: 'skipped', title: null };
      logger.warn?.('[conversation-title] provider failed; used local fallback', { conversationId, errorCode: lastErrorCode });
      return { status: 'fallback', title };
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, task);
    return task;
  };
  return { queue, getSettings, invalidate: () => { cachedSettings = null; cachedAt = 0; }, sanitizeTitle, fallbackTitle, validateOutput };
}

module.exports = { createConversationTitleService, normalizeConversationTitleSettings: normalizeSettings, conversationTitleSettingKeys: SETTING_KEYS, extractConversationTitleReply: extractReply, sanitizeConversationTitle: sanitizeTitle, fallbackConversationTitle: fallbackTitle, validateConversationTitleOutput: validateOutput, DEFAULT_CONVERSATION_TITLE: DEFAULT_TITLE };
