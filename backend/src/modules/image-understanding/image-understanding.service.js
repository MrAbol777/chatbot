const path = require('path');
const FormData = require('form-data');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const {
  DEFAULT_VISION_SETTINGS,
  createVisionSettingsResolver
} = require('./image-understanding-settings');

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif'
]);
const MIME_BY_EXTENSION = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif'
};
const INLINE_TRANSPORT_MAX_MB = 4;
const OCR_DESIGN_DETAIL_PATTERN =
  /متن|نوشته|بخون|بخوان|خواندن|ocr|طراحی|طرح|بنر|پوستر|استوری|لوگو|رنگ|فونت|چیدمان|ایراد|جزئیات|دقیق|read text|extract text|design|layout|readability|detail/i;

const normalizeText = (value) =>
  String(value || '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\s+/g, ' ')
    .trim();

const extractReply = (response) => {
  if (Array.isArray(response?.candidates)) {
    const parts = response.candidates[0]?.content?.parts;
    if (Array.isArray(parts)) {
      return parts.map((part) => (typeof part?.text === 'string' ? part.text : '')).filter(Boolean).join('\n').trim();
    }
  }
  if (typeof response?.text === 'string') return response.text.trim();
  if (typeof response?.output_text === 'string') return response.output_text.trim();
  return '';
};

const extractTokenUsage = (response) => {
  if (response?.usageMetadata && typeof response.usageMetadata === 'object') return response.usageMetadata;
  if (response?.usage && typeof response.usage === 'object') return response.usage;
  return null;
};

const getFileNameFromMime = (mimeType) => {
  if (mimeType === 'image/png') return 'image.png';
  if (mimeType === 'image/webp') return 'image.webp';
  if (mimeType === 'image/heic') return 'image.heic';
  if (mimeType === 'image/heif') return 'image.heif';
  return 'image.jpg';
};

const parseDataImageUrl = (url) => {
  if (typeof url !== 'string') return null;
  const match = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\r\n]+)$/);
  if (!match) return null;
  return {
    mimeType: match[1].toLowerCase(),
    buffer: Buffer.from(match[2].replace(/\s+/g, ''), 'base64')
  };
};

const parseGeneratedImageTaskId = (value) => {
  const raw = String(value || '').trim();
  try {
    const url = new URL(raw, 'https://local.invalid');
    const match = url.pathname.match(/^\/api\/images\/(?:result|serve)\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  } catch (_error) {
    return '';
  }
};

const parseUploadedImageId = (value) => {
  const raw = String(value || '').trim();
  try {
    const url = new URL(raw, 'https://local.invalid');
    const match = url.pathname.match(/^\/api\/uploads\/images\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  } catch (_error) {
    return '';
  }
};

const classifyVisionPrompt = (prompt) => {
  const text = normalizeText(prompt).toLowerCase();
  if (/متن|نوشته|بخون|بخوان|خواندن|ocr|read text|extract text/.test(text)) return 'ocr';
  if (/طرح|طراحی|بنر|پوستر|استوری|لوگو|رنگ|فونت|چیدمان|ایراد|ui|ux|design|layout|readability/.test(text)) return 'design';
  if (/محصول|کالا|جنس|مدل|برند|product/.test(text)) return 'product';
  if (/جزئیات|دقیق|detail/i.test(text)) return 'detail';
  return 'general';
};

const buildUserPrompt = (userPrompt, settings) => {
  const prompt = normalizeText(userPrompt) || 'این تصویر را دقیق و خلاصه به فارسی توضیح بده.';
  const kind = classifyVisionPrompt(prompt);
  if (kind === 'ocr') return `${settings.ocrPrompt}\n\nUser request: ${prompt}`;
  if (kind === 'design') return `${settings.designAnalysisPrompt}\n\nUser request: ${prompt}`;
  if (kind === 'product') return `${settings.productPrompt}\n\nUser request: ${prompt}`;
  return prompt;
};

const normalizeMimeType = (value, fallback = '') => {
  const mimeType = String(value || fallback || '').trim().toLowerCase();
  if (mimeType === 'image/jpg') return 'image/jpeg';
  return mimeType;
};

const sanitizeImageInput = (image, index) => {
  const mimeType = normalizeMimeType(image?.mimeType);
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
    const error = new Error('UNSUPPORTED_IMAGE_FORMAT');
    error.code = 'UNSUPPORTED_IMAGE_FORMAT';
    throw error;
  }

  const buffer = Buffer.isBuffer(image?.buffer)
    ? image.buffer
    : typeof image?.base64 === 'string'
      ? Buffer.from(image.base64, 'base64')
      : null;

  if (!buffer || buffer.length === 0) {
    const error = new Error('IMAGE_NOT_FOUND');
    error.code = 'IMAGE_NOT_FOUND';
    throw error;
  }

  return {
    id: image?.id || `image-${index + 1}`,
    source: image?.source || 'inline',
    mimeType,
    buffer,
    size: buffer.length,
    url: typeof image?.url === 'string' ? image.url.trim() : '',
    originalName: image?.originalName || getFileNameFromMime(mimeType)
  };
};

const safeErrorCode = (error) => {
  if (error?.code) return error.code;
  if (error?.response?.status) return `HTTP_${error.response.status}`;
  return 'VISION_REQUEST_FAILED';
};

const safeVisionError = (error, fallbackMessage = 'Vision model request failed.') => {
  const statusCode = error?.response?.status || null;
  const rawMessage = String(
    error?.response?.data?.error?.message ||
      error?.response?.data?.message ||
      error?.message ||
      ''
  );
  const code = String(error?.response?.data?.error?.code || error?.code || '').toUpperCase();
  const combined = `${code} ${statusCode || ''} ${rawMessage}`.toLowerCase();
  let errorType = 'upstream_error';
  let upstreamCode = code || safeErrorCode(error);

  if (error?.code === 'ECONNABORTED' || /timeout/.test(combined)) {
    errorType = 'timeout';
    upstreamCode = 'TIMEOUT';
  } else if (statusCode === 401 || /unauthorized|auth|api[_ -]?key|invalid key/.test(combined)) {
    errorType = 'access_denied';
    upstreamCode = 'AUTH_OR_KEY_REJECTED';
  } else if (statusCode === 403 || /forbidden|permission|access denied/.test(combined)) {
    errorType = 'access_denied';
    upstreamCode = 'ACCESS_DENIED';
  } else if (statusCode === 404 || /not found|not_found|model.*not|unsupported.*model|model_not_found/.test(combined)) {
    errorType = 'model_not_found';
    upstreamCode = 'MODEL_NOT_FOUND_OR_UNSUPPORTED';
  } else if (statusCode === 400 || /invalid|bad request|unsupported/.test(combined)) {
    errorType = 'invalid_request';
    upstreamCode = /model|unsupported/.test(combined) ? 'MODEL_NOT_FOUND_OR_UNSUPPORTED' : 'INVALID_REQUEST';
  }

  return {
    statusCode,
    errorType,
    safeMessage: fallbackMessage,
    upstreamCode
  };
};

function createImageUnderstandingService({
  httpClient,
  settingsRepository,
  visionConfig = {},
  chatConfig = {},
  uploadedImagesRepository = null,
  imageGenerationController = null,
  db = null,
  logger = console,
  visionSettingsResolver = null
} = {}) {
  const settingsResolver = visionSettingsResolver || createVisionSettingsResolver({ settingsRepository, visionConfig });
  let lastValidationStatus = 'unknown';
  const modelHealth = new Map();

  const log = (scope, message, meta) => {
    if (typeof logger.log === 'function') {
      logger.log(scope, message, meta);
    } else if (typeof logger.info === 'function') {
      logger.info(`[${scope}] ${message}`, meta || {});
    }
  };

  const getApiKey = (settings) => {
    const visionKey = String(visionConfig.apiKey || '').trim();
    if (visionKey) {
      return {
        apiKey: visionKey,
        apiKeySource: visionConfig.apiKeySource || 'METIS_VISION_API_KEY',
        apiKeyFingerprint: visionConfig.apiKeyFingerprint || ''
      };
    }
    if (settings.allowChatKeyFallback && chatConfig?.apiKey) {
      return {
        apiKey: String(chatConfig.apiKey || '').trim(),
        apiKeySource: `fallback ${chatConfig.apiKeySource || 'METIS_CHAT_API_KEY'}`,
        apiKeyFingerprint: chatConfig.apiKeyFingerprint || ''
      };
    }
    return { apiKey: '', apiKeySource: 'missing', apiKeyFingerprint: '' };
  };

  const getModelHealthEntry = (model) => {
    const key = String(model || '').trim();
    if (!key) return null;
    const entry = modelHealth.get(key) || {
      status: 'healthy',
      failures: 0,
      cooldownUntil: null,
      lastError: null
    };
    if (entry.cooldownUntil && Date.now() >= entry.cooldownUntil) {
      entry.status = 'healthy';
      entry.failures = 0;
      entry.cooldownUntil = null;
      entry.lastError = null;
      modelHealth.set(key, entry);
    }
    return entry;
  };

  const isModelTemporarilyDisabled = (model) => {
    const entry = getModelHealthEntry(model);
    return Boolean(entry?.cooldownUntil && Date.now() < entry.cooldownUntil);
  };

  const recordModelFailure = (model, error, settings) => {
    if (!settings.modelHealthEnabled || !model) return null;
    const key = String(model).trim();
    const entry = getModelHealthEntry(key) || {};
    const failures = Number(entry.failures || 0) + 1;
    const threshold = Math.max(1, Number(settings.modelHealthFailureThreshold || 3));
    const shouldDisable = failures >= threshold;
    const updated = {
      status: shouldDisable ? 'disabled_temporarily' : 'degraded',
      failures,
      cooldownUntil: shouldDisable ? Date.now() + Math.max(1, Number(settings.modelHealthCooldownMinutes || 60)) * 60 * 1000 : null,
      lastError: safeVisionError(error, 'Vision model failed and was recorded in model health.')
    };
    modelHealth.set(key, updated);
    return updated;
  };

  const recordModelSuccess = (model, settings) => {
    if (!settings.modelHealthEnabled || !model) return;
    modelHealth.set(String(model).trim(), {
      status: 'healthy',
      failures: 0,
      cooldownUntil: null,
      lastError: null
    });
  };

  const getModelHealthSnapshot = (settings = DEFAULT_VISION_SETTINGS) => {
    const models = [
      settings.experimentalModel,
      settings.defaultModel,
      settings.fastModel,
      settings.qualityModel,
      settings.proModel
    ].filter(Boolean);
    return Object.fromEntries([...new Set(models)].map((model) => {
      const hasRecordedHealth = modelHealth.has(model);
      const entry = getModelHealthEntry(model) || {};
      const isExperimental = model === settings.experimentalModel;
      const status = hasRecordedHealth ? entry.status : (isExperimental ? 'failed_or_experimental' : 'healthy');
      return [model, {
        status,
        failures: hasRecordedHealth ? Number(entry.failures || 0) : 0,
        cooldownUntil: hasRecordedHealth && entry.cooldownUntil ? new Date(entry.cooldownUntil).toISOString() : null,
        lastError: hasRecordedHealth ? entry.lastError || null : null
      }];
    }));
  };

  const chooseHealthyModel = ({ preferred, fallback, settings }) => {
    if (preferred && !isModelTemporarilyDisabled(preferred)) {
      return { model: preferred, healthReason: 'preferred' };
    }
    if (fallback && fallback !== preferred && !isModelTemporarilyDisabled(fallback)) {
      return { model: fallback, healthReason: 'preferred_disabled_using_fallback' };
    }
    return { model: preferred || fallback, healthReason: 'no_healthy_alternative' };
  };

  const selectVisionModel = ({ prompt = '', settings, promptKind = null } = {}) => {
    const kind = promptKind || classifyVisionPrompt(prompt);
    const needsBetterVision = kind === 'ocr' || kind === 'design' || kind === 'detail' || OCR_DESIGN_DETAIL_PATTERN.test(normalizeText(prompt));

    if (settings.mode === 'economy') {
      const picked = chooseHealthyModel({
        preferred: settings.experimentalModel || settings.fastModel || settings.defaultModel,
        fallback: settings.fastModel || settings.qualityModel,
        settings
      });
      return {
        model: picked.model,
        reason: picked.healthReason === 'preferred' ? 'economy_experimental' : `economy_${picked.healthReason}`,
        promptKind: kind,
        needsBetterVision
      };
    }

    if (settings.mode === 'balanced') {
      const preferred = needsBetterVision ? settings.qualityModel : settings.defaultModel;
      const fallback = needsBetterVision ? settings.defaultModel : settings.qualityModel;
      const picked = chooseHealthyModel({ preferred, fallback, settings });
      return {
        model: picked.model,
        reason: picked.healthReason === 'preferred'
          ? (needsBetterVision ? 'balanced_ocr_design_detail' : 'balanced_simple')
          : `balanced_${picked.healthReason}`,
        promptKind: kind,
        needsBetterVision
      };
    }

    if (settings.mode === 'accurate') {
      return {
        model: settings.qualityModel,
        reason: 'accurate',
        promptKind: kind,
        needsBetterVision
      };
    }

    if (settings.mode === 'pro') {
      return {
        model: settings.allowProModel ? settings.proModel : settings.qualityModel,
        reason: settings.allowProModel ? 'pro_allowed' : 'pro_blocked_downgraded_to_quality',
        promptKind: kind,
        needsBetterVision
      };
    }

    return {
      model: settings.defaultModel,
      reason: 'fallback_default',
      promptKind: kind,
      needsBetterVision
    };
  };

  const getFallbackModel = ({ settings, selected }) => {
    if (selected?.model && selected.model !== settings.qualityModel && settings.qualityModel) {
      return settings.qualityModel;
    }
    return '';
  };

  const chooseTransport = (image, settings, overrideTransport = '') => {
    const requested = normalizeText(overrideTransport || settings.transport).toLowerCase();
    if (requested === 'inline') return 'inline';
    if (requested === 'metis_storage') return 'metis_storage';
    if (image.source === 'public_url' && image.url) return 'signed_url';
    const inlineMaxBytes = INLINE_TRANSPORT_MAX_MB * 1024 * 1024;
    return image.size <= inlineMaxBytes ? 'inline' : 'metis_storage';
  };

  const uploadToMetisStorage = async ({ image, settings, apiKey, requestId }) => {
    const form = new FormData();
    form.append('files', image.buffer, {
      filename: image.originalName || getFileNameFromMime(image.mimeType),
      contentType: image.mimeType,
      knownLength: image.size
    });

    const response = await httpClient.post(`${settings.baseUrl}/api/v1/storage`, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${apiKey}`
      },
      maxBodyLength: Infinity,
      timeout: Math.min(settings.timeoutMs, 30000)
    });

    const file = Array.isArray(response?.data?.files) ? response.data.files[0] : null;
    if (!file?.url) {
      const error = new Error('METIS_STORAGE_EMPTY_RESPONSE');
      error.code = 'METIS_STORAGE_EMPTY_RESPONSE';
      error.details = response?.data;
      throw error;
    }
    log('VISION', 'storage_upload_succeeded', {
      requestId,
      contentType: file.contentType,
      size: file.size || image.size
    });
    return file;
  };

  const buildParts = async ({ prompt, images, settings, apiKey, requestId, transportOverride }) => {
    const parts = [{ text: prompt }];
    const transportDetails = [];
    for (const image of images) {
      const transport = chooseTransport(image, settings, transportOverride);
      if (transport === 'inline') {
        parts.push({
          inline_data: {
            mime_type: image.mimeType,
            data: image.buffer.toString('base64')
          }
        });
        transportDetails.push({ imageId: image.id, transport, metisStorageUrlUsed: false });
        continue;
      }

      if (transport === 'signed_url' && image.url) {
        parts.push({
          file_data: {
            mime_type: image.mimeType,
            file_uri: image.url
          }
        });
        transportDetails.push({ imageId: image.id, transport, metisStorageUrlUsed: false });
        continue;
      }

      const storedFile = await uploadToMetisStorage({ image, settings, apiKey, requestId });
      parts.push({
        file_data: {
          mime_type: storedFile.contentType || image.mimeType,
          file_uri: storedFile.url
        }
      });
      transportDetails.push({
        imageId: image.id,
        transport: 'metis_storage',
        metisStorageUrlUsed: true,
        objectName: storedFile.objectName || null,
        size: storedFile.size || image.size
      });
    }
    return { parts, transportDetails };
  };

  const buildRequestBody = ({ prompt, parts, settings }) => {
    const payload = {
      contents: [
        {
          role: 'user',
          parts
        }
      ],
      systemInstruction: {
        parts: [{ text: settings.systemPrompt }]
      },
      generationConfig: {
        temperature: settings.temperature,
        maxOutputTokens: settings.maxOutputTokens
      }
    };

    return payload;
  };

  const makeDryRun = async ({ prompt = '', image = null, settingsOverride = null, transport = '' } = {}) => {
    const current = settingsRepository && typeof settingsRepository.getAll === 'function'
      ? await settingsRepository.getAll().catch(() => ({}))
      : {};
    const settings = settingsOverride && typeof settingsOverride === 'object'
      ? settingsResolver.normalizeVisionSettings({ settings: { ...current, ...settingsOverride }, visionConfig })
      : await settingsResolver.getRuntimeSettings({ force: true });
    settingsResolver.validateVisionSettings(settings);

    const sampleImage = image
      ? sanitizeImageInput(image, 0)
      : {
          id: 'dry-run-image',
          source: 'inline',
          mimeType: 'image/jpeg',
          buffer: Buffer.from('DRY_RUN_IMAGE_BYTES'),
          size: 123456,
          originalName: 'dry-run.jpg'
        };
    const visionPrompt = buildUserPrompt(prompt, settings);
    const selectedTransport = chooseTransport(sampleImage, settings, transport);
    const parts = [
      { text: visionPrompt },
      selectedTransport === 'inline'
        ? { inline_data: { mime_type: sampleImage.mimeType, data: 'BASE64_IMAGE' } }
        : { file_data: { mime_type: sampleImage.mimeType, file_uri: 'METIS_STORAGE_URL' } }
    ];
    const requestBody = buildRequestBody({ prompt: visionPrompt, parts, settings });

    return {
      settings,
      model: selectVisionModel({ prompt, settings }).model,
      transport: selectedTransport,
      endpoint: `${settings.baseUrl}/v1beta/models/${selectVisionModel({ prompt, settings }).model}:generateContent`,
      adapter: 'gemini_generate_content_inline_data',
      requestBody
    };
  };

  const callVisionModel = async ({ model, payload, settings, apiKey, requestId, timeoutMs = null }) => {
    const endpoint = `${settings.baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const response = await httpClient.post(endpoint, payload, {
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      timeout: timeoutMs || settings.timeoutMs
    });
    const answer = extractReply(response?.data);
    if (!answer) {
      const error = new Error('EMPTY_VISION_REPLY');
      error.code = 'EMPTY_VISION_REPLY';
      error.details = response?.data;
      throw error;
    }
    log('VISION', 'request_succeeded', { requestId, model, answerLength: answer.length });
    return {
      answer,
      tokenUsage: extractTokenUsage(response?.data),
      raw: response?.data
    };
  };

  const analyzeImages = async ({
    userPrompt = '',
    images = [],
    requestId = '',
    settingsOverride = null,
    transport = '',
    dryRun = false
  } = {}) => {
    const startedAt = Date.now();
    const current = settingsRepository && typeof settingsRepository.getAll === 'function'
      ? await settingsRepository.getAll().catch(() => ({}))
      : {};
    const settings = settingsOverride && typeof settingsOverride === 'object'
      ? settingsResolver.normalizeVisionSettings({ settings: { ...current, ...settingsOverride }, visionConfig })
      : await settingsResolver.getRuntimeSettings();
    settingsResolver.validateVisionSettings(settings);

    if (!settings.enabled) {
      const error = new Error('VISION_DISABLED');
      error.code = 'VISION_DISABLED';
      throw error;
    }

    const key = getApiKey(settings);
    if (!key.apiKey) {
      const error = new Error('METIS_VISION_API_KEY is missing');
      error.code = 'API_KEY_MISSING';
      throw error;
    }

    const normalizedImages = images.map(sanitizeImageInput);
    if (normalizedImages.length === 0) {
      const error = new Error('IMAGE_NOT_FOUND');
      error.code = 'IMAGE_NOT_FOUND';
      throw error;
    }

    const maxBytes = settings.maxImageMb * 1024 * 1024;
    const tooLarge = normalizedImages.find((image) => image.size > maxBytes);
    if (tooLarge) {
      const error = new Error('IMAGE_TOO_LARGE');
      error.code = 'IMAGE_TOO_LARGE';
      error.details = { maxImageMb: settings.maxImageMb, size: tooLarge.size };
      throw error;
    }

    const promptKind = classifyVisionPrompt(userPrompt);
    const selected = selectVisionModel({ prompt: userPrompt, settings, promptKind });
    const visionPrompt = buildUserPrompt(userPrompt, settings);
    const { parts, transportDetails } = await buildParts({
      prompt: visionPrompt,
      images: normalizedImages,
      settings,
      apiKey: key.apiKey,
      requestId,
      transportOverride: transport
    });
    const requestBody = buildRequestBody({ prompt: visionPrompt, parts, settings });
    const model = selected.model;
    const safeRequestBody = JSON.parse(JSON.stringify(requestBody));
    for (const part of safeRequestBody.contents?.[0]?.parts || []) {
      if (part.inline_data?.data) part.inline_data.data = 'BASE64_IMAGE';
    }

    if (dryRun) {
      return {
        success: true,
        mode: 'dry-run',
        model,
        provider: settings.provider,
        transport: transportDetails[0]?.transport || 'inline',
        requestBody: safeRequestBody,
        diagnostics: {
          apiKeySource: key.apiKeySource,
          selectedModel: model,
          selectedModelReason: selected.reason,
          promptKind: selected.promptKind,
          mediaResolutionSupported: false,
          adapter: 'gemini_generate_content_inline_data',
          transportDetails
        }
      };
    }

    try {
      log('VISION', 'request_started', {
        requestId,
          model,
          mode: settings.mode,
          selectedModelReason: selected.reason,
          imageCount: normalizedImages.length,
        transports: transportDetails.map((item) => item.transport)
      });
      const result = await callVisionModel({ model, payload: requestBody, settings, apiKey: key.apiKey, requestId, timeoutMs: settings.timeoutMs });
      recordModelSuccess(model, settings);
      lastValidationStatus = 'valid';
      return {
        success: true,
        status: 'success',
        answer: result.answer,
        model,
        provider: settings.provider,
        apiKeySource: key.apiKeySource,
        tokenUsage: result.tokenUsage,
        requestBody: safeRequestBody,
        diagnostics: {
          originalUserPrompt: userPrompt,
          visionPrompt,
          model,
          selectedModel: model,
          selectedModelReason: selected.reason,
          promptKind: selected.promptKind,
          provider: settings.provider,
          imageSource: normalizedImages[0]?.source || 'inline',
          mimeType: normalizedImages[0]?.mimeType || null,
          imageSize: normalizedImages[0]?.size || null,
          transport: transportDetails[0]?.transport || 'inline',
          metisStorageUrlUsed: transportDetails.some((item) => item.metisStorageUrlUsed),
          durationMs: Date.now() - startedAt,
          status: 'success',
          answer: result.answer,
          apiKeySource: key.apiKeySource,
          mediaResolutionSupported: false,
          adapter: 'gemini_generate_content_inline_data',
          transportDetails
        }
      };
    } catch (error) {
      const isTimeout = error?.code === 'ECONNABORTED' || /timeout/i.test(error?.message || '');
      const primaryError = safeVisionError(error, 'Primary vision model failed before fallback.');
      recordModelFailure(model, error, settings);
      const fallbackModel = getFallbackModel({ settings, selected });
      if (fallbackModel) {
        try {
          log('VISION', 'fallback_started', { requestId, from: model, to: fallbackModel, reason: primaryError.errorType });
          const result = await callVisionModel({
            model: fallbackModel,
            payload: requestBody,
            settings,
            apiKey: key.apiKey,
            requestId,
            timeoutMs: settings.fallbackTimeoutMs
          });
          recordModelSuccess(fallbackModel, settings);
          lastValidationStatus = 'valid';
          return {
            success: true,
            status: 'success',
            answer: result.answer,
            model: fallbackModel,
            provider: settings.provider,
            apiKeySource: key.apiKeySource,
            tokenUsage: result.tokenUsage,
            requestBody: safeRequestBody,
            diagnostics: {
              originalUserPrompt: userPrompt,
              visionPrompt,
              model: fallbackModel,
              selectedModel: fallbackModel,
              selectedModelReason: 'fallback_to_quality',
              promptKind: selected.promptKind,
              provider: settings.provider,
              imageSource: normalizedImages[0]?.source || 'inline',
              mimeType: normalizedImages[0]?.mimeType || null,
              imageSize: normalizedImages[0]?.size || null,
              transport: transportDetails[0]?.transport || 'inline',
              metisStorageUrlUsed: transportDetails.some((item) => item.metisStorageUrlUsed),
              durationMs: Date.now() - startedAt,
              status: 'success',
              answer: result.answer,
              primaryModel: model,
              primaryFailed: true,
              primaryError,
              fallbackModel,
              fallbackUsed: true,
              fallbackSuccess: true,
              fallbackFrom: model,
              fallbackCount: 1,
              apiKeySource: key.apiKeySource,
              mediaResolutionSupported: false,
              adapter: 'gemini_generate_content_inline_data',
              transportDetails
            }
          };
        } catch (fallbackError) {
          recordModelFailure(fallbackModel, fallbackError, settings);
          lastValidationStatus = safeErrorCode(fallbackError);
          fallbackError.code = fallbackError.code || safeErrorCode(fallbackError);
          throw fallbackError;
        }
      }

      lastValidationStatus = safeErrorCode(error);
      if (isTimeout) {
        const timeoutError = new Error('VISION_TIMEOUT');
        timeoutError.code = 'VISION_TIMEOUT';
        throw timeoutError;
      }
      error.code = error.code || safeErrorCode(error);
      throw error;
    }
  };

  const resolveUploadedImages = async (imageIds) => {
    if (!uploadedImagesRepository || typeof uploadedImagesRepository.getByIds !== 'function') return [];
    const uploaded = await uploadedImagesRepository.getByIds(imageIds);
    return uploaded.map((image) => ({
      id: image.imageId,
      source: 'upload',
      mimeType: image.mimeType,
      base64: image.base64,
      originalName: `${image.imageId}.${image.mimeType === 'image/png' ? 'png' : image.mimeType === 'image/webp' ? 'webp' : 'jpg'}`
    }));
  };

  const resolveGeneratedImage = async (req, res, taskId) => {
    if (!imageGenerationController || typeof imageGenerationController.getEditableImageInput !== 'function') return null;
    const editable = await imageGenerationController.getEditableImageInput(req, res, taskId).catch(() => null);
    const parsed = parseDataImageUrl(editable?.dataUrl);
    if (!parsed) return null;
    return {
      id: editable.imageId || taskId,
      source: 'generated',
      mimeType: parsed.mimeType,
      buffer: parsed.buffer,
      originalName: `${editable.imageId || taskId}.${parsed.mimeType === 'image/png' ? 'png' : 'jpg'}`
    };
  };

  const resolveImageFromHistoryItem = async (req, res, image) => {
    const url = typeof image?.url === 'string' ? image.url : typeof image === 'string' ? image : '';
    if (!url || /^blob:/i.test(url)) return null;
    const dataUrl = parseDataImageUrl(url);
    if (dataUrl) {
      return {
        id: `data-url-${uuidv4()}`,
        source: 'inline',
        mimeType: dataUrl.mimeType,
        buffer: dataUrl.buffer,
        originalName: getFileNameFromMime(dataUrl.mimeType)
      };
    }
    const generatedTaskId = parseGeneratedImageTaskId(url);
    if (generatedTaskId) return resolveGeneratedImage(req, res, generatedTaskId);
    const uploadId = parseUploadedImageId(url);
    if (uploadId) {
      const uploaded = await resolveUploadedImages([uploadId]);
      return uploaded[0] || null;
    }
    if (/^https?:\/\//i.test(url)) {
      const ext = path.extname(new URL(url).pathname).toLowerCase();
      return {
        id: `public-url-${uuidv4()}`,
        source: 'public_url',
        mimeType: MIME_BY_EXTENSION[ext] || 'image/jpeg',
        url,
        buffer: Buffer.from('public-url-placeholder'),
        size: 1,
        originalName: getFileNameFromMime(MIME_BY_EXTENSION[ext] || 'image/jpeg')
      };
    }
    return null;
  };

  const resolveImagesForChat = async ({ req, res, imageIds = [], history = [] }) => {
    const images = [];
    const explicit = Array.isArray(imageIds) && imageIds.length > 0 ? await resolveUploadedImages(imageIds) : [];
    images.push(...explicit);

    if (images.length === 0 && Array.isArray(history)) {
      const recentWithImages = [...history].reverse().find((item) => Array.isArray(item?.images) && item.images.length > 0);
      for (const image of Array.isArray(recentWithImages?.images) ? recentWithImages.images : []) {
        const resolved = await resolveImageFromHistoryItem(req, res, image);
        if (resolved) images.push(resolved);
        if (images.length >= 5) break;
      }
    }

    return images;
  };

  const analyzeChatImages = async ({ req, res, message, imageIds, history, requestId }) => {
    const images = await resolveImagesForChat({ req, res, imageIds, history });
    return analyzeImages({ userPrompt: message, images, requestId });
  };

  const probeModels = async ({ settingsOverride = null, transport = 'inline' } = {}) => {
    const current = settingsRepository && typeof settingsRepository.getAll === 'function'
      ? await settingsRepository.getAll().catch(() => ({}))
      : {};
    const settings = settingsOverride && typeof settingsOverride === 'object'
      ? settingsResolver.normalizeVisionSettings({ settings: { ...current, ...settingsOverride }, visionConfig })
      : await settingsResolver.getRuntimeSettings({ force: true });
    settingsResolver.validateVisionSettings(settings);
    const key = getApiKey(settings);
    if (!key.apiKey) {
      const error = new Error('METIS_VISION_API_KEY is missing');
      error.code = 'API_KEY_MISSING';
      throw error;
    }

    const models = [
      settings.experimentalModel,
      settings.qualityModel
    ];
    if (settings.allowProModel) models.push(settings.proModel);
    const uniqueModels = [...new Set(models.filter(Boolean))];
    const image = sanitizeImageInput({
      id: 'model-probe-pixel',
      source: 'model_probe',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        'base64'
      ),
      originalName: 'model-probe.png'
    }, 0);
    const prompt = 'این تصویر تستی را خیلی کوتاه تایید کن.';
    const { parts, transportDetails } = await buildParts({
      prompt,
      images: [image],
      settings,
      apiKey: key.apiKey,
      requestId: 'vision-model-probe',
      transportOverride: transport
    });
    const payload = buildRequestBody({ prompt, parts, settings });
    const results = [];

    for (const model of uniqueModels) {
      const startedAt = Date.now();
      try {
        await callVisionModel({
          model,
          payload,
          settings,
          apiKey: key.apiKey,
          requestId: `vision-model-probe-${model}`,
          timeoutMs: settings.timeoutMs
        });
        recordModelSuccess(model, settings);
        results.push({
          model,
          ok: true,
          statusCode: 200,
          errorType: null,
          safeMessage: 'Vision model probe succeeded.',
          durationMs: Date.now() - startedAt
        });
      } catch (error) {
        const safe = safeVisionError(error, 'Model failed on Metis Gemini wrapper.');
        recordModelFailure(model, error, settings);
        results.push({
          model,
          ok: false,
          statusCode: safe.statusCode,
          errorType: safe.errorType,
          safeMessage: safe.safeMessage,
          upstreamCode: safe.upstreamCode,
          durationMs: Date.now() - startedAt
        });
      }
    }

    return {
      success: true,
      transport: transportDetails[0]?.transport || 'inline',
      apiKeySource: key.apiKeySource,
      models: results,
      modelHealth: getModelHealthSnapshot(settings)
    };
  };

  const getDiagnostics = async ({ force = false, settingsOverride = null } = {}) => {
    const current = settingsRepository && typeof settingsRepository.getAll === 'function'
      ? await settingsRepository.getAll().catch(() => ({}))
      : {};
    const settings = settingsOverride && typeof settingsOverride === 'object'
      ? settingsResolver.normalizeVisionSettings({ settings: { ...current, ...settingsOverride }, visionConfig })
      : await settingsResolver.getRuntimeSettings({ force });
    const key = getApiKey(settings);
    return {
      enabled: Boolean(settings.enabled),
      provider: settings.provider,
      mode: settings.mode,
      defaultModel: settings.defaultModel,
      fastModel: settings.fastModel,
      experimentalModel: settings.experimentalModel,
      qualityModel: settings.qualityModel,
      proModel: settings.proModel,
      allowProModel: Boolean(settings.allowProModel),
      apiKeySource: key.apiKeySource,
      apiKeySet: Boolean(key.apiKey),
      apiKeyFingerprint: key.apiKeyFingerprint || '',
      transport: settings.transport,
      timeoutMs: settings.timeoutMs,
      fallbackTimeoutMs: settings.fallbackTimeoutMs,
      maxImageMb: settings.maxImageMb,
      mediaResolution: settings.mediaResolution,
      temperature: settings.temperature,
      maxOutputTokens: settings.maxOutputTokens,
      selectedModelForSimpleImage: selectVisionModel({ prompt: 'این عکس چیه؟', settings }).model,
      selectedModelForOcrOrDesign: selectVisionModel({ prompt: 'متن این عکس رو بخون و این طرح رو بررسی کن', settings }).model,
      modelHealth: getModelHealthSnapshot(settings),
      lastValidationStatus: lastValidationStatus === 'unknown' ? settings.lastValidationStatus || 'valid' : lastValidationStatus
    };
  };

  const loadImageFromPath = async (filePath, mimeType = '') => {
    const fullPath = path.resolve(filePath);
    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) {
      const error = new Error('IMAGE_NOT_FOUND');
      error.code = 'IMAGE_NOT_FOUND';
      throw error;
    }
    const ext = path.extname(fullPath).toLowerCase();
    return {
      id: path.basename(fullPath),
      source: 'local_file',
      mimeType: normalizeMimeType(mimeType, MIME_BY_EXTENSION[ext] || 'image/jpeg'),
      buffer: await fs.readFile(fullPath),
      originalName: path.basename(fullPath)
    };
  };

  return {
    analyzeImages,
    analyzeChatImages,
    buildUserPrompt,
    getApiKey,
    getDiagnostics,
    getRuntimeSettings: settingsResolver.getRuntimeSettings,
    invalidate: settingsResolver.invalidate,
    loadImageFromPath,
    makeDryRun,
    probeModels,
    resolveImagesForChat,
    selectVisionModel,
    settingsResolver,
    supportedMimeTypes: Array.from(SUPPORTED_IMAGE_MIME_TYPES)
  };
}

module.exports = {
  INLINE_TRANSPORT_MAX_MB,
  SUPPORTED_IMAGE_MIME_TYPES,
  createImageUnderstandingService,
  parseDataImageUrl
};
