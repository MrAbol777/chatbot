const { fingerprintApiKey } = require('../../bootstrap/config');
const {
  DEFAULT_INTENT_ROUTER_SETTINGS,
  INTENT_ROUTER_ALLOWED_INTENTS,
  makeSafeKeyInfo,
  normalizeIntentRouterSettings,
  validateIntentRouterSettings
} = require('./intent-router.settings');

const extractReply = (response) => {
  if (Array.isArray(response?.candidates)) {
    const text = response.candidates[0]?.content?.parts?.[0]?.text;
    if (typeof text === 'string') return text.trim();
  }
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  return '';
};

const parseJsonObject = (value) => {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('empty_response');
  try {
    return JSON.parse(raw);
  } catch (_error) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('invalid_json');
    return JSON.parse(match[0]);
  }
};

// Image creation and editing are handled exclusively by Image Studio, so the
// chat router only needs to distinguish normal chat from image understanding.
const detectDeterministicRoute = () => null;

const normalizeRoute = (value) => {
  const intent = String(value?.intent || '').trim();
  const targetModule = String(value?.targetModule || intent).trim();
  if (!INTENT_ROUTER_ALLOWED_INTENTS.includes(intent) || !INTENT_ROUTER_ALLOWED_INTENTS.includes(targetModule)) {
    throw new Error('invalid_intent');
  }
  const confidence = Number(value?.confidence);
  if (!Number.isFinite(confidence)) throw new Error('invalid_confidence');
  return {
    intent,
    confidence: Math.min(1, Math.max(0, confidence)),
    targetModule,
    needsImage: Boolean(value?.needsImage),
    usesCurrentAttachment: Boolean(value?.usesCurrentAttachment),
    usesPreviousImage: Boolean(value?.usesPreviousImage),
    reasonCode: String(value?.reasonCode || `${intent}_route`).trim().replace(/[^a-z0-9_]/gi, '_').toLowerCase().slice(0, 80),
    source: 'intent_router',
    shouldRespondToUser: false
  };
};

const buildRouterInput = (input = {}) => ({
  userMessage: String(input.userMessage || input.message || '').trim(),
  previousUserMessage: String(input.previousUserMessage || '').trim().slice(0, 1000),
  currentTopic: String(input.currentTopic || '').trim().slice(0, 500),
  activeReferences: Array.isArray(input.activeReferences)
    ? input.activeReferences.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 10)
    : [],
  hasCurrentImageAttachment: Boolean(input.hasCurrentImageAttachment),
  hasPreviousUploadedImage: Boolean(input.hasPreviousUploadedImage),
  hasPreviousGeneratedImage: Boolean(input.hasPreviousGeneratedImage),
  lastImageKind: ['generated', 'uploaded', 'none'].includes(input.lastImageKind) ? input.lastImageKind : 'none',
  locale: input.locale || 'fa'
});

const getErrorType = (error) => {
  if (error?.code === 'ECONNABORTED' || /timeout/i.test(String(error?.message || ''))) return 'timeout';
  if (/json/i.test(String(error?.message || ''))) return 'invalid_json';
  if (/confidence/i.test(String(error?.message || ''))) return 'low_confidence';
  if (/api key/i.test(String(error?.message || ''))) return 'missing_key';
  return 'model_error';
};

function createIntentRouterService({
  httpClient,
  settingsRepository,
  routerConfig = {},
  chatConfig = {},
  logger = console
} = {}) {
  const modelHealth = new Map();
  let cachedSettings = null;
  let cachedAt = 0;

  const getSettings = async ({ force = false, overrideSettings = null } = {}) => {
    if (overrideSettings && typeof overrideSettings === 'object') {
      const normalized = normalizeIntentRouterSettings({ settings: overrideSettings, routerConfig });
      validateIntentRouterSettings(normalized);
      return normalized;
    }
    if (!force && cachedSettings && Date.now() - cachedAt < 30000) return cachedSettings;
    const all = settingsRepository && typeof settingsRepository.getAll === 'function'
      ? await settingsRepository.getAll().catch(() => ({}))
      : {};
    const normalized = normalizeIntentRouterSettings({ settings: all, routerConfig });
    validateIntentRouterSettings(normalized);
    cachedSettings = normalized;
    cachedAt = Date.now();
    return normalized;
  };

  const invalidate = () => {
    cachedSettings = null;
    cachedAt = 0;
  };

  const resolveApiKey = (settings) => {
    const primaryKey = typeof routerConfig.apiKey === 'string' ? routerConfig.apiKey.trim() : '';
    if (primaryKey) {
      return {
        apiKey: primaryKey,
        apiKeySource: routerConfig.apiKeySource || 'METIS_INTENT_ROUTER_API_KEY',
        apiKeyFingerprint: routerConfig.apiKeyFingerprint || fingerprintApiKey(primaryKey)
      };
    }
    if (settings.allowChatKeyFallback && typeof chatConfig.apiKey === 'string' && chatConfig.apiKey.trim()) {
      const source = chatConfig.apiKeySource === 'METIS_CHAT_API_KEY'
        ? 'fallback METIS_CHAT_API_KEY'
        : chatConfig.apiKeySource === 'legacy METIS_API_KEY'
          ? 'fallback legacy METIS_API_KEY'
          : `fallback ${chatConfig.apiKeySource || 'chat api key'}`;
      return {
        apiKey: chatConfig.apiKey.trim(),
        apiKeySource: source,
        apiKeyFingerprint: chatConfig.apiKeyFingerprint || fingerprintApiKey(chatConfig.apiKey)
      };
    }
    return { apiKey: '', apiKeySource: 'missing', apiKeyFingerprint: '' };
  };

  const getModelState = (model) => modelHealth.get(model) || {
    failures: 0,
    cooldownUntil: null,
    lastError: null,
    lastFailureAt: null,
    lastSuccessAt: null
  };

  const isModelAvailable = (model, settings) => {
    if (!settings.modelHealthEnabled) return true;
    const state = getModelState(model);
    return !state.cooldownUntil || Date.now() >= state.cooldownUntil;
  };

  const recordModelSuccess = (model) => {
    modelHealth.set(model, {
      failures: 0,
      cooldownUntil: null,
      lastError: null,
      lastFailureAt: null,
      lastSuccessAt: new Date().toISOString()
    });
  };

  const recordModelFailure = (model, settings, errorType) => {
    const current = getModelState(model);
    const failures = current.failures + 1;
    const cooldownUntil =
      settings.modelHealthEnabled && failures >= settings.modelHealthFailureThreshold
        ? new Date(Date.now() + settings.modelHealthCooldownMinutes * 60 * 1000).toISOString()
        : current.cooldownUntil;
    modelHealth.set(model, {
      ...current,
      failures,
      cooldownUntil,
      lastError: errorType,
      lastFailureAt: new Date().toISOString()
    });
  };

  const callModel = async ({ input, settings, model, apiKeyInfo }) => {
    if (!apiKeyInfo.apiKey) {
      const error = new Error('intent-router api key missing');
      error.code = 'API_KEY_MISSING';
      throw error;
    }
    if (!httpClient || typeof httpClient.post !== 'function') {
      throw new Error('intent-router http client missing');
    }
    const url = `https://api.metisai.ir/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const response = await httpClient.post(
      url,
      {
        systemInstruction: { parts: [{ text: settings.systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }],
        generationConfig: {
          temperature: settings.temperature,
          maxOutputTokens: settings.maxOutputTokens,
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
    return normalizeRoute(parseJsonObject(extractReply(response?.data)));
  };

  const tryModel = async ({ input, settings, model, apiKeyInfo }) => {
    const startedAt = Date.now();
    try {
      const route = await callModel({ input, settings, model, apiKeyInfo });
      const durationMs = Date.now() - startedAt;
      if (route.confidence < settings.confidenceThreshold) {
        const error = new Error('low_confidence');
        error.route = route;
        error.durationMs = durationMs;
        throw error;
      }
      recordModelSuccess(model);
      return { ok: true, route, durationMs, model };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const errorType = getErrorType(error);
      recordModelFailure(model, settings, errorType);
      return {
        ok: false,
        error,
        errorType,
        durationMs,
        model,
        route: error?.route || null
      };
    }
  };

  const route = async (inputPayload = {}, options = {}) => {
    const input = buildRouterInput(inputPayload);
    const settings = await getSettings({ overrideSettings: options.settings });
    const apiKeyInfo = resolveApiKey(settings);
    const startedAt = Date.now();
    const deterministicRoute = detectDeterministicRoute(input);

    if (settings.enabled && deterministicRoute) {
      return {
        ok: true,
        status: 'success',
        route: deterministicRoute,
        input,
        metadata: {
          enabled: Boolean(settings.enabled),
          provider: 'deterministic',
          model: null,
          fallbackModel: settings.fallbackModel,
          status: 'success',
          intent: deterministicRoute.intent,
          targetModule: deterministicRoute.targetModule,
          confidence: deterministicRoute.confidence,
          reasonCode: deterministicRoute.reasonCode,
          source: deterministicRoute.source,
          durationMs: Date.now() - startedAt,
          fallbackUsed: false
        },
        settings
      };
    }

    if (!settings.enabled) {
      return {
        ok: false,
        status: 'disabled',
        route: null,
        input,
        metadata: {
          enabled: false,
          source: 'heuristic_fallback',
          fallbackToHeuristic: settings.fallbackToHeuristic,
          durationMs: Date.now() - startedAt
        },
        settings
      };
    }

    const attempts = [];
    const primaryModel = isModelAvailable(settings.model, settings) ? settings.model : settings.fallbackModel;
    const primary = await tryModel({ input, settings, model: primaryModel, apiKeyInfo });
    attempts.push(primary);
    if (primary.ok) {
      return {
        ok: true,
        status: 'success',
        route: primary.route,
        input,
        metadata: {
          enabled: true,
          provider: settings.provider,
          model: primary.model,
          fallbackModel: settings.fallbackModel,
          status: 'success',
          intent: primary.route.intent,
          targetModule: primary.route.targetModule,
          confidence: primary.route.confidence,
          reasonCode: primary.route.reasonCode,
          source: primary.route.source,
          durationMs: Date.now() - startedAt,
          fallbackUsed: primary.model !== settings.model,
          ...makeSafeKeyInfo(apiKeyInfo)
        },
        settings
      };
    }

    let fallback = null;
    if (settings.allowModelFallback && primary.model !== settings.fallbackModel) {
      fallback = await tryModel({ input, settings, model: settings.fallbackModel, apiKeyInfo });
      attempts.push(fallback);
      if (fallback.ok) {
        return {
          ok: true,
          status: 'success',
          route: fallback.route,
          input,
          metadata: {
            enabled: true,
            provider: settings.provider,
            model: primary.model,
            fallbackModel: settings.fallbackModel,
            status: primary.errorType === 'timeout' ? 'primary_timeout' : primary.errorType === 'invalid_json' ? 'invalid_json' : primary.errorType === 'low_confidence' ? 'low_confidence' : 'primary_error',
            intent: fallback.route.intent,
            targetModule: fallback.route.targetModule,
            confidence: fallback.route.confidence,
            reasonCode: fallback.route.reasonCode,
            source: fallback.route.source,
            durationMs: Date.now() - startedAt,
            fallbackUsed: true,
            ...makeSafeKeyInfo(apiKeyInfo)
          },
          settings
        };
      }
    }

    if (typeof logger.warn === 'function') {
      logger.warn('[intent-router] model routing failed', {
        attempts: attempts.map((attempt) => ({
          model: attempt.model,
          ok: attempt.ok,
          errorType: attempt.errorType || null,
          durationMs: attempt.durationMs
        }))
      });
    }

    return {
      ok: false,
      status: 'router_failed',
      route: fallback?.route || primary.route || null,
      input,
      metadata: {
        enabled: true,
        provider: settings.provider,
        model: primary.model,
        fallbackModel: settings.fallbackModel,
        status: fallback ? 'router_failed' : (primary.errorType === 'timeout' ? 'primary_timeout' : primary.errorType || 'primary_error'),
        source: 'heuristic_fallback',
        durationMs: Date.now() - startedAt,
        fallbackUsed: Boolean(fallback),
        fallbackToHeuristic: settings.fallbackToHeuristic,
        ...makeSafeKeyInfo(apiKeyInfo)
      },
      settings
    };
  };

  const testDryRun = async ({ userMessage, context = {}, settings = null } = {}) => route({
    userMessage,
    hasCurrentImageAttachment: context.hasCurrentImageAttachment,
    hasPreviousUploadedImage: context.hasPreviousUploadedImage,
    hasPreviousGeneratedImage: context.hasPreviousGeneratedImage,
    lastImageKind: context.lastImageKind || (
      context.hasPreviousGeneratedImage ? 'generated' : context.hasPreviousUploadedImage ? 'uploaded' : 'none'
    ),
    locale: context.locale || 'fa'
  }, { settings });

  const modelProbe = async ({ settings: overrideSettings = null } = {}) => {
    const settings = await getSettings({ overrideSettings });
    const apiKeyInfo = resolveApiKey(settings);
    const input = buildRouterInput({
      userMessage: 'گربه‌ی توی عکس رو قرمز کن',
      hasPreviousGeneratedImage: true,
      lastImageKind: 'generated',
      locale: 'fa'
    });
    const models = ['gemini-2.5-flash-lite-preview', 'gemini-2.5-flash'];
    const results = [];
    for (const model of models) {
      const result = await tryModel({
        input,
        settings: {
          ...settings,
          confidenceThreshold: 0
        },
        model,
        apiKeyInfo
      });
      results.push({
        model,
        ok: Boolean(result.ok),
        durationMs: result.durationMs,
        errorType: result.ok ? null : result.errorType,
        safeMessage: result.ok ? null : 'intent-router model probe failed'
      });
    }
    return {
      models: results,
      apiKey: makeSafeKeyInfo(apiKeyInfo)
    };
  };

  const getDiagnostics = async ({ force = false } = {}) => {
    const settings = await getSettings({ force }).catch(() => ({ ...DEFAULT_INTENT_ROUTER_SETTINGS, lastValidationStatus: 'fallback' }));
    const apiKeyInfo = resolveApiKey(settings);
    const models = Object.fromEntries(['gemini-2.5-flash-lite-preview', 'gemini-2.5-flash'].map((model) => {
      const state = getModelState(model);
      return [model, {
        status: isModelAvailable(model, settings) ? 'healthy' : 'cooldown',
        failures: state.failures,
        cooldownUntil: state.cooldownUntil,
        lastError: state.lastError
      }];
    }));
    return {
      enabled: Boolean(settings.enabled),
      provider: settings.provider,
      model: settings.model,
      fallbackModel: settings.fallbackModel,
      experimentalModel: settings.experimentalModel,
      ...makeSafeKeyInfo(apiKeyInfo),
      temperature: settings.temperature,
      maxOutputTokens: settings.maxOutputTokens,
      timeoutMs: settings.timeoutMs,
      confidenceThreshold: settings.confidenceThreshold,
      fallbackToHeuristic: settings.fallbackToHeuristic,
      allowModelFallback: settings.allowModelFallback,
      allowChatKeyFallback: settings.allowChatKeyFallback,
      storeMetadata: settings.storeMetadata,
      health: {
        enabled: settings.modelHealthEnabled,
        failureThreshold: settings.modelHealthFailureThreshold,
        cooldownMinutes: settings.modelHealthCooldownMinutes,
        models
      },
      modelHealth: models,
      lastValidationStatus: settings.lastValidationStatus || 'valid'
    };
  };

  return {
    getSettings,
    invalidate,
    route,
    testDryRun,
    modelProbe,
    getDiagnostics,
    normalizeRoute
  };
}

module.exports = {
  buildRouterInput,
  createIntentRouterService,
  detectDeterministicRoute,
  normalizeRoute
};
