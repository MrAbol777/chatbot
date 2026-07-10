const crypto = require('crypto');
const { fingerprintApiKey } = require('../../bootstrap/config');

const DEFAULT_REFINER_SYSTEM_PROMPT = `You are an image prompt refinement engine for a Persian child-friendly AI product.

Your task is to convert the user's Persian or mixed-language image request into a precise, safe, high-quality English prompt for an image generation model.

Return only valid JSON. No markdown. No explanation.

Rules:
1. Preserve the user's main subject exactly.
2. Do not replace humans with animals, dolls, toys, mascots, cats, or unrelated characters.
3. If the user requests a human, child, girl, boy, woman, man, face, portrait, or person, do not add "no humans" or "no people".
4. If the subject is a child or teenager, add: age-appropriate, fully clothed, non-sexualized, safe child-friendly depiction.
5. If the user asks for Persian text inside the image, preserve the exact Persian text inside quotes. Do not translate it.
6. The final image prompt should be English, but any requested text to render inside the image must remain exactly in the original language.
7. If the request is vague, create a safe, imaginative, child-friendly visual prompt without asking questions.
8. Keep the prompt specific: subject, style, lighting, background, camera/composition, quality.
9. Avoid unsafe, sexual, violent, hateful, or age-inappropriate content.
10. If needed, soften unsafe requests into a safe child-friendly alternative.
11. If imageMode is "image-edit", write an image-to-image edit prompt: start from the input image, preserve the same subject identity, pose, composition, lighting, camera angle, and style unless explicitly changed, and change only the requested part. Do not describe a brand-new image from scratch.

Return this JSON schema exactly:
{
  "refinedPrompt": "...",
  "negativePrompt": "...",
  "detectedSubject": "...",
  "style": "...",
  "hasHumanSubject": true/false,
  "hasChildSubject": true/false,
  "containsTextInImage": true/false,
  "textToRender": null or "...",
  "preservedTextLanguage": null or "fa" or "en" or "mixed",
  "safetyTags": [],
  "warnings": []
}`;

const CHILD_SAFETY_PHRASE = 'age-appropriate, fully clothed, non-sexualized, safe child-friendly depiction';
const SUBJECT_GUARD_PHRASE = 'Do not replace the subject with an animal, doll, cat, toy, mascot, or unrelated character.';
const DEFAULT_REFINER_STYLE = 'clean, colorful, child-friendly digital illustration, soft lighting, high quality';
const DEFAULT_REFINER_NEGATIVE = 'no watermark, no distorted text, no extra fingers, no blurry face, no unrelated objects';
const HUMAN_PATTERN = /(?:دختر|دختربچه|دختر\s*بچه|پسر|پسربچه|پسر\s*بچه|کودک|بچه|نوجوان|آدم|انسان|شخص|زن|مرد|پرتره|چهره|girl|boy|child|kid|teen|person|human|woman|man|portrait)/i;
const CHILD_PATTERN = /(?:دختربچه|دختر\s*بچه|پسربچه|پسر\s*بچه|کودک|بچه|نوجوان|girl|boy|child|kid|teen)/i;
const PERSIAN_TEXT_PATTERN = /[«"]([^«»"]*[\u0600-\u06FF][^«»"]*)[»"]|نوشته(?:\s*باشه|\s*باشد)?\s*["«]?([^"»\n\r]+)["»]?/i;

const promptRefinerSettingKey = {
  enabled: 'ai.image.prompt_refiner.enabled',
  provider: 'ai.image.prompt_refiner.provider',
  model: 'ai.image.prompt_refiner.model',
  temperature: 'ai.image.prompt_refiner.temperature',
  maxTokens: 'ai.image.prompt_refiner.max_tokens',
  timeoutMs: 'ai.image.prompt_refiner.timeout_ms',
  fallbackEnabled: 'ai.image.prompt_refiner.fallback_enabled',
  cacheEnabled: 'ai.image.prompt_refiner.cache_enabled',
  cacheTtlMinutes: 'ai.image.prompt_refiner.cache_ttl_minutes',
  preservePersianText: 'ai.image.prompt_refiner.preserve_persian_text',
  humanSubjectGuard: 'ai.image.prompt_refiner.human_subject_guard',
  childSafetyGuard: 'ai.image.prompt_refiner.child_safety_guard',
  defaultStyle: 'ai.image.prompt_refiner.default_style',
  defaultNegativePrompt: 'ai.image.prompt_refiner.default_negative_prompt',
  systemPrompt: 'ai.image.prompt_refiner.system_prompt',
  storeMetadata: 'ai.image.prompt_refiner.store_metadata',
  allowChatKeyFallback: 'ai.image.prompt_refiner.allow_chat_key_fallback'
};

const normalizeBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
};

const normalizeNumber = (value, fallback, min, max) => {
  const numeric = Number(value);
  const finite = Number.isFinite(numeric) ? numeric : fallback;
  return Math.min(max, Math.max(min, finite));
};

const normalizeString = (value, fallback = '') => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
};

const normalizePromptRefinerSettings = ({ settings = {}, refinerConfig = {} } = {}) => {
  const get = (key, fallback) => (Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : fallback);
  return {
    enabled: normalizeBoolean(get(promptRefinerSettingKey.enabled, refinerConfig.enabled ?? true), true),
    provider: normalizeString(get(promptRefinerSettingKey.provider, refinerConfig.provider || 'metis'), 'metis').toLowerCase(),
    model: normalizeString(get(promptRefinerSettingKey.model, refinerConfig.model || 'gemini-2.5-flash'), 'gemini-2.5-flash'),
    temperature: normalizeNumber(get(promptRefinerSettingKey.temperature, refinerConfig.temperature ?? 0.2), 0.2, 0, 2),
    maxTokens: normalizeNumber(get(promptRefinerSettingKey.maxTokens, refinerConfig.maxTokens ?? 700), 700, 100, 2000),
    timeoutMs: normalizeNumber(get(promptRefinerSettingKey.timeoutMs, refinerConfig.timeoutMs ?? 6000), 6000, 1000, 30000),
    fallbackEnabled: normalizeBoolean(get(promptRefinerSettingKey.fallbackEnabled, true), true),
    cacheEnabled: normalizeBoolean(get(promptRefinerSettingKey.cacheEnabled, true), true),
    cacheTtlMinutes: normalizeNumber(get(promptRefinerSettingKey.cacheTtlMinutes, 1440), 1440, 1, 10080),
    preservePersianText: normalizeBoolean(get(promptRefinerSettingKey.preservePersianText, true), true),
    humanSubjectGuard: normalizeBoolean(get(promptRefinerSettingKey.humanSubjectGuard, true), true),
    childSafetyGuard: normalizeBoolean(get(promptRefinerSettingKey.childSafetyGuard, true), true),
    defaultStyle: normalizeString(get(promptRefinerSettingKey.defaultStyle, DEFAULT_REFINER_STYLE), DEFAULT_REFINER_STYLE),
    defaultNegativePrompt: normalizeString(get(promptRefinerSettingKey.defaultNegativePrompt, DEFAULT_REFINER_NEGATIVE), DEFAULT_REFINER_NEGATIVE),
    systemPrompt: normalizeString(get(promptRefinerSettingKey.systemPrompt, DEFAULT_REFINER_SYSTEM_PROMPT), DEFAULT_REFINER_SYSTEM_PROMPT),
    storeMetadata: normalizeBoolean(get(promptRefinerSettingKey.storeMetadata, true), true),
    allowChatKeyFallback: normalizeBoolean(get(promptRefinerSettingKey.allowChatKeyFallback, refinerConfig.allowChatKeyFallback ?? false), false),
    lastValidationStatus: 'valid'
  };
};

const stripCodeFence = (value) => String(value || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

const extractJsonObject = (value) => {
  const text = stripCodeFence(value);
  if (text.startsWith('{') && text.endsWith('}')) return text;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
};

const removeHumanNegativePrompt = (negativePrompt) => String(negativePrompt || '')
  .split(',')
  .map((item) => item.trim())
  .filter((item) => item && !/(^|\b)no\s+humans?\b|(^|\b)no\s+people\b|(^|\b)no\s+persons?\b/i.test(item))
  .join(', ');

const mergeNegativePrompts = (...values) => {
  const seen = new Set();
  const parts = [];
  for (const value of values) {
    for (const item of String(value || '').split(',')) {
      const normalized = item.trim();
      const key = normalized.toLowerCase();
      if (!normalized || seen.has(key)) continue;
      seen.add(key);
      parts.push(normalized);
    }
  }
  return parts.join(', ');
};

const detectPersianTextToRender = (prompt) => {
  const match = String(prompt || '').match(PERSIAN_TEXT_PATTERN);
  const text = (match?.[1] || match?.[2] || '').trim();
  return text && /[\u0600-\u06FF]/.test(text) ? text.replace(/[.،؛]+$/g, '').trim() : null;
};

const ensurePromptPhrase = (prompt, phrase) => {
  const text = String(prompt || '').trim().replace(/[.\s]+$/g, '');
  if (!phrase || text.toLowerCase().includes(phrase.toLowerCase())) return text;
  return `${text}. ${phrase}`;
};

const validateAndNormalizeRefinerOutput = ({ output, userPrompt, settings }) => {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    const error = new Error('invalid_output');
    error.code = 'INVALID_OUTPUT';
    throw error;
  }
  const hasHumanSubject = Boolean(output.hasHumanSubject) || HUMAN_PATTERN.test(userPrompt);
  const hasChildSubject = Boolean(output.hasChildSubject) || CHILD_PATTERN.test(userPrompt);
  let refinedPrompt = normalizeString(output.refinedPrompt, '');
  if (refinedPrompt.length < 10 || refinedPrompt.length > 2000) {
    const error = new Error('invalid_output');
    error.code = 'INVALID_OUTPUT';
    throw error;
  }

  if (hasHumanSubject && settings.humanSubjectGuard) {
    refinedPrompt = ensurePromptPhrase(refinedPrompt, SUBJECT_GUARD_PHRASE);
  }
  if (hasChildSubject && settings.childSafetyGuard) {
    refinedPrompt = ensurePromptPhrase(refinedPrompt, CHILD_SAFETY_PHRASE);
  }

  const detectedPersianText = settings.preservePersianText ? detectPersianTextToRender(userPrompt) : null;
  const containsTextInImage = Boolean(output.containsTextInImage) || Boolean(detectedPersianText);
  const textToRender = detectedPersianText || (typeof output.textToRender === 'string' ? output.textToRender.trim() : null);
  if (containsTextInImage && textToRender && settings.preservePersianText && /[\u0600-\u06FF]/.test(textToRender)) {
    if (!refinedPrompt.includes(textToRender)) {
      refinedPrompt = `${refinedPrompt.replace(/[.\s]+$/g, '')}. Include the exact Persian text "${textToRender}" clearly rendered in the image.`;
    }
  }

  let negativePrompt = normalizeString(output.negativePrompt, settings.defaultNegativePrompt);
  if (negativePrompt.length > 1000) negativePrompt = negativePrompt.slice(0, 1000).trim();
  if (hasHumanSubject) negativePrompt = removeHumanNegativePrompt(negativePrompt);
  if (!hasHumanSubject) negativePrompt = mergeNegativePrompts(negativePrompt, 'no humans', 'no people', 'no unrelated objects');

  return {
    refinedPrompt,
    negativePrompt,
    detectedSubject: normalizeString(output.detectedSubject, hasHumanSubject ? 'human subject' : 'main subject'),
    style: normalizeString(output.style, settings.defaultStyle),
    hasHumanSubject,
    hasChildSubject,
    containsTextInImage,
    textToRender: textToRender || null,
    preservedTextLanguage: textToRender && /[\u0600-\u06FF]/.test(textToRender) ? 'fa' : output.preservedTextLanguage || null,
    safetyTags: Array.isArray(output.safetyTags) ? output.safetyTags.map(String).slice(0, 20) : [],
    warnings: Array.isArray(output.warnings) ? output.warnings.map(String).slice(0, 20) : []
  };
};

const buildCacheKey = ({ userPrompt, imageMode, settings }) => crypto
  .createHash('sha256')
  .update(JSON.stringify({
    userPrompt,
    imageMode,
    model: settings.model,
    systemPrompt: settings.systemPrompt,
    defaultStyle: settings.defaultStyle,
    defaultNegativePrompt: settings.defaultNegativePrompt
  }))
  .digest('hex');

const extractReply = (responseData) => {
  const parts = responseData?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const text = parts.map((part) => part?.text || '').join('').trim();
    if (text) return text;
  }
  const content = responseData?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  return '';
};

function createImagePromptRefinerService({
  httpClient,
  settingsRepository,
  refinerConfig = {},
  chatConfig = {},
  fallbackPromptBuilder
} = {}) {
  const cache = new Map();
  let cachedSettings = null;
  let cachedSettingsAt = 0;

  const resolveApiKey = (settings) => {
    const refinerKey = normalizeString(refinerConfig.apiKey || process.env.METIS_PROMPT_REFINER_API_KEY, '');
    if (refinerKey) {
      return {
        apiKey: refinerKey,
        apiKeySource: 'METIS_PROMPT_REFINER_API_KEY',
        apiKeyFingerprint: fingerprintApiKey(refinerKey)
      };
    }
    const chatKey = normalizeString(chatConfig.apiKey || process.env.METIS_CHAT_API_KEY, '');
    if (settings.allowChatKeyFallback && chatKey) {
      return {
        apiKey: chatKey,
        apiKeySource: 'fallback METIS_CHAT_API_KEY',
        apiKeyFingerprint: fingerprintApiKey(chatKey)
      };
    }
    return {
      apiKey: '',
      apiKeySource: 'missing',
      apiKeyFingerprint: ''
    };
  };

  const getSettings = async ({ force = false, overrideSettings = null } = {}) => {
    if (overrideSettings && typeof overrideSettings === 'object') {
      return normalizePromptRefinerSettings({ settings: overrideSettings, refinerConfig });
    }
    if (!force && cachedSettings && Date.now() - cachedSettingsAt < 30000) return cachedSettings;
    const all = settingsRepository && typeof settingsRepository.getAll === 'function'
      ? await settingsRepository.getAll().catch(() => ({}))
      : {};
    cachedSettings = normalizePromptRefinerSettings({ settings: all, refinerConfig });
    cachedSettingsAt = Date.now();
    return cachedSettings;
  };

  const buildFallbackResult = async ({ userPrompt, imageSettings, settings = {}, apiKeyInfo = {}, status, startedAt, reason = '' }) => {
    const finalPrompt = typeof fallbackPromptBuilder === 'function'
      ? fallbackPromptBuilder(userPrompt, {
          promptEnhancerEnabled: imageSettings?.promptEnhancerEnabled,
          defaultNegativePrompt: imageSettings?.defaultNegativePrompt
        })
      : userPrompt;
    return {
      ok: false,
      status,
      reason,
      durationMs: Date.now() - startedAt,
      refinedPrompt: finalPrompt,
      negativePrompt: imageSettings?.defaultNegativePrompt || '',
      metadata: {
        enabled: true,
        provider: settings.provider,
        model: settings.model,
        apiKeySource: apiKeyInfo.apiKeySource,
        status,
        durationMs: Date.now() - startedAt,
        reason
      }
    };
  };

  const callRefiner = async ({ userPrompt, conversationContext = '', imageMode = 'text-to-image', locale = 'fa', settings, apiKeyInfo }) => {
    if (settings.provider !== 'metis') {
      const error = new Error('unsupported_provider');
      error.code = 'UNSUPPORTED_PROVIDER';
      throw error;
    }
    const url = `https://api.metisai.ir/v1beta/models/${encodeURIComponent(settings.model)}:generateContent`;
    const userPayload = {
      userPrompt,
      conversationContext,
      imageMode,
      locale,
      defaultStyle: settings.defaultStyle,
      defaultNegativePrompt: settings.defaultNegativePrompt,
      preservePersianText: settings.preservePersianText,
      humanSubjectGuard: settings.humanSubjectGuard,
      childSafetyGuard: settings.childSafetyGuard
    };
    const response = await httpClient.post(
      url,
      {
        systemInstruction: { parts: [{ text: settings.systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(userPayload) }] }],
        generationConfig: {
          temperature: settings.temperature,
          maxOutputTokens: settings.maxTokens,
          responseMimeType: 'application/json'
        }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKeyInfo.apiKey
        },
        timeout: settings.timeoutMs
      }
    );
    return extractReply(response?.data);
  };

  const refine = async ({
    userPrompt,
    conversationContext = '',
    imageMode = 'text-to-image',
    locale = 'fa',
    imageSettings = {},
    settings: overrideSettings = null
  } = {}) => {
    const startedAt = Date.now();
    const originalPrompt = normalizeString(userPrompt, '');
    const settings = await getSettings({ overrideSettings });
    const apiKeyInfo = resolveApiKey(settings);
    const baseMetadata = {
      enabled: settings.enabled,
      provider: settings.provider,
      model: settings.model,
      apiKeySource: apiKeyInfo.apiKeySource
    };

    if (!settings.enabled) {
      return {
        ok: false,
        status: 'disabled',
        refinedPrompt: typeof fallbackPromptBuilder === 'function' ? fallbackPromptBuilder(originalPrompt, imageSettings) : originalPrompt,
        negativePrompt: imageSettings.defaultNegativePrompt || '',
        metadata: { ...baseMetadata, status: 'disabled', durationMs: Date.now() - startedAt }
      };
    }
    if (!apiKeyInfo.apiKey) {
      return buildFallbackResult({ userPrompt: originalPrompt, imageSettings, settings, apiKeyInfo, status: 'missing_key', startedAt, reason: 'missing api key' });
    }

    const cacheKey = buildCacheKey({ userPrompt: originalPrompt, imageMode, settings });
    const cached = settings.cacheEnabled ? cache.get(cacheKey) : null;
    if (cached && Date.now() < cached.expiresAt) {
      return {
        ...cached.value,
        fromCache: true,
        metadata: {
          ...cached.value.metadata,
          ...baseMetadata,
          status: 'success',
          cache: 'hit',
          durationMs: Date.now() - startedAt
        }
      };
    }

    try {
      const raw = await callRefiner({ userPrompt: originalPrompt, conversationContext, imageMode, locale, settings, apiKeyInfo });
      let parsed;
      try {
        parsed = JSON.parse(extractJsonObject(raw));
      } catch (error) {
        return buildFallbackResult({ userPrompt: originalPrompt, imageSettings, settings, apiKeyInfo, status: 'invalid_json', startedAt, reason: error.message });
      }
      const normalized = validateAndNormalizeRefinerOutput({ output: parsed, userPrompt: originalPrompt, settings });
      const value = {
        ok: true,
        status: 'success',
        ...normalized,
        metadata: {
          ...baseMetadata,
          status: 'success',
          durationMs: Date.now() - startedAt,
          cache: 'miss'
        }
      };
      if (settings.cacheEnabled) {
        cache.set(cacheKey, {
          value,
          expiresAt: Date.now() + settings.cacheTtlMinutes * 60 * 1000
        });
      }
      return value;
    } catch (error) {
      const status = error?.code === 'ECONNABORTED' || /timeout/i.test(error?.message || '') ? 'timeout' : 'error';
      return buildFallbackResult({
        userPrompt: originalPrompt,
        imageSettings,
        settings,
        apiKeyInfo,
        status,
        startedAt,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const getDiagnostics = async ({ force = false } = {}) => {
    const settings = await getSettings({ force });
    const apiKeyInfo = resolveApiKey(settings);
    return {
      enabled: settings.enabled,
      provider: settings.provider,
      model: settings.model,
      apiKeySource: apiKeyInfo.apiKeySource,
      apiKeySet: Boolean(apiKeyInfo.apiKey),
      apiKeyFingerprint: apiKeyInfo.apiKeyFingerprint,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      timeoutMs: settings.timeoutMs,
      fallbackEnabled: settings.fallbackEnabled,
      cacheEnabled: settings.cacheEnabled,
      cacheTtlMinutes: settings.cacheTtlMinutes,
      lastValidationStatus: settings.lastValidationStatus || 'valid'
    };
  };

  const buildFinalPromptWithNegative = ({ refinedPrompt, negativePrompt }) => {
    const prompt = normalizeString(refinedPrompt, '');
    const negative = normalizeString(negativePrompt, '');
    return negative ? `${prompt}\n\nNegative prompt: ${negative}` : prompt;
  };

  return {
    refine,
    getSettings,
    getDiagnostics,
    invalidate: () => {
      cachedSettings = null;
      cachedSettingsAt = 0;
      cache.clear();
    },
    mergeNegativePrompts,
    buildFinalPromptWithNegative,
    validateAndNormalizeRefinerOutput
  };
}

module.exports = {
  CHILD_SAFETY_PHRASE,
  DEFAULT_REFINER_NEGATIVE,
  DEFAULT_REFINER_STYLE,
  DEFAULT_REFINER_SYSTEM_PROMPT,
  SUBJECT_GUARD_PHRASE,
  createImagePromptRefinerService,
  mergeNegativePrompts,
  normalizePromptRefinerSettings,
  promptRefinerSettingKey,
  validateAndNormalizeRefinerOutput
};
