const { fingerprintApiKey } = require('../../bootstrap/config');
const { INPUT_OPTIMIZER_SYSTEM_PROMPT } = require('./input-optimizer.prompt');

const settingKeys = {
  enabled: 'input_optimizer.enabled', model: 'input_optimizer.model', temperature: 'input_optimizer.temperature',
  timeoutMs: 'input_optimizer.timeout_ms', maxRetries: 'input_optimizer.max_retries',
  maxOutputTokens: 'input_optimizer.max_output_tokens', version: 'input_optimizer.version',
  allowChatKeyFallback: 'input_optimizer.allow_chat_key_fallback'
};
const protectedPattern = /```[\s\S]*?```|https?:\/\/[^\s<>]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b|\b(?:[A-Za-z_][\w-]*\s+){0,3}(?:SELECT|INSERT|UPDATE|DELETE|DROP|npm|git|curl|powershell|bash)\b[^\n]*|\{[\s\S]*?\}/gi;
const normalizeString = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const bool = (value, fallback) => typeof value === 'boolean' ? value : typeof value === 'string' ? !['false', '0', 'off', 'no'].includes(value.toLowerCase()) : fallback;
const num = (value, fallback, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : fallback));
const languageOf = (text) => /[\u0600-\u06ff]/.test(text) && /[A-Za-z]/.test(text) ? 'mixed' : /[\u0600-\u06ff]/.test(text) ? 'fa' : /[A-Za-z]/.test(text) ? 'en' : 'unknown';
const extractReply = (data) => data?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('').trim() || data?.choices?.[0]?.message?.content?.trim() || '';
const jsonObject = (value) => {
  const text = String(value || '').replace(/^```json\s*|^```|```$/gim, '').trim();
  const start = text.indexOf('{'); const end = text.lastIndexOf('}');
  return JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
};

function normalizeSettings(settings = {}, config = {}) {
  const get = (key, fallback) => Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : fallback;
  return {
    enabled: bool(get(settingKeys.enabled, config.enabled ?? true), true), model: normalizeString(get(settingKeys.model, config.model || 'gemini-2.5-flash-lite-preview'), 'gemini-2.5-flash-lite-preview'),
    temperature: num(get(settingKeys.temperature, config.temperature ?? 0), 0, 0, 0.2), timeoutMs: num(get(settingKeys.timeoutMs, config.timeoutMs ?? 3500), 3500, 500, 30000),
    maxRetries: num(get(settingKeys.maxRetries, config.maxRetries ?? 1), 1, 0, 1), maxOutputTokens: num(get(settingKeys.maxOutputTokens, config.maxOutputTokens ?? 450), 450, 100, 1000),
    version: normalizeString(get(settingKeys.version, config.version || '1'), '1'), allowChatKeyFallback: bool(get(settingKeys.allowChatKeyFallback, config.allowChatKeyFallback ?? true), true)
  };
}

function validateOutput(output, originalText, settings) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) throw Object.assign(new Error('INVALID_OUTPUT'), { code: 'INVALID_OUTPUT' });
  const optimizedTextEn = normalizeString(output.optimizedTextEn);
  if (!optimizedTextEn || optimizedTextEn.length > 6000) throw Object.assign(new Error('INVALID_OUTPUT'), { code: 'INVALID_OUTPUT' });
  const protectedSegments = [...new Set((originalText.match(protectedPattern) || []).map((item) => item.trim()).filter(Boolean))];
  if (protectedSegments.some((segment) => !optimizedTextEn.includes(segment))) throw Object.assign(new Error('PROTECTED_SEGMENT_MISSING'), { code: 'INVALID_OUTPUT' });
  const ambiguityLevel = ['none', 'low', 'high'].includes(output.ambiguityLevel) ? output.ambiguityLevel : 'none';
  const needsClarification = Boolean(output.needsClarification) || ambiguityLevel === 'high';
  return {
    optimizedTextEn, sourceLanguage: ['fa', 'en', 'mixed', 'unknown'].includes(output.sourceLanguage) ? output.sourceLanguage : languageOf(originalText),
    targetLanguage: 'en', ambiguityLevel, needsClarification,
    clarificationQuestionFa: needsClarification ? normalizeString(output.clarificationQuestionFa, 'لطفاً مشخص‌تر بگو منظورت کدام مورد است؟') : null,
    preservedEntities: Array.isArray(output.preservedEntities) ? output.preservedEntities.slice(0, 30).filter((entry) => entry && entry.original).map((entry) => ({ type: normalizeString(entry.type, 'other'), original: String(entry.original).slice(0, 256), normalized: normalizeString(entry.normalized, String(entry.original)).slice(0, 256) })) : [],
    protectedSegments, confidence: num(output.confidence, 0.8, 0, 1), optimizerVersion: settings.version
  };
}

function createInputOptimizerService({ httpClient, settingsRepository, optimizationRepository, optimizerConfig = {}, chatConfig = {}, logger = console } = {}) {
  let cachedSettings; let cachedAt = 0;
  const getSettings = async ({ force = false } = {}) => {
    if (!force && cachedSettings && Date.now() - cachedAt < 30000) return cachedSettings;
    const all = settingsRepository?.getAll ? await settingsRepository.getAll().catch(() => ({})) : {};
    cachedSettings = normalizeSettings(all, optimizerConfig); cachedAt = Date.now(); return cachedSettings;
  };
  const keyFor = (settings) => {
    const dedicated = normalizeString(optimizerConfig.apiKey || process.env.METIS_INPUT_OPTIMIZER_API_KEY);
    const fallback = settings.allowChatKeyFallback ? normalizeString(chatConfig.apiKey || process.env.METIS_CHAT_API_KEY || process.env.METIS_API_KEY) : '';
    const apiKey = dedicated || fallback;
    return { apiKey, apiKeySource: dedicated ? 'METIS_INPUT_OPTIMIZER_API_KEY' : fallback ? 'fallback chat key' : 'missing', apiKeyFingerprint: apiKey ? fingerprintApiKey(apiKey) : '' };
  };
  const call = async ({ text, context, settings, key, signal }) => {
    const response = await httpClient.post(`https://api.metisai.ir/v1beta/models/${encodeURIComponent(settings.model)}:generateContent`, {
      systemInstruction: { parts: [{ text: INPUT_OPTIMIZER_SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify({ text, operationType: context.operationType, hasImages: Boolean(context.hasImages), optimizerVersion: settings.version }) }] }],
      generationConfig: { temperature: settings.temperature, maxOutputTokens: settings.maxOutputTokens, responseMimeType: 'application/json' }
    }, { headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key.apiKey }, timeout: settings.timeoutMs, signal });
    return jsonObject(extractReply(response?.data));
  };
  const save = async (result, context) => {
    if (!optimizationRepository || typeof optimizationRepository.upsert !== 'function') return;
    try {
      await optimizationRepository.upsert({ ...context, ...result });
    } catch (error) {
      logger.warn?.('[input-optimizer] audit write failed', { code: error?.code || 'DB_WRITE_FAILED' });
    }
  };
  const fromStored = (row) => ({ originalText: row.original_input, optimizedTextEn: row.optimized_input || row.original_input, needsClarification: Boolean(row.needs_clarification), clarificationQuestionFa: row.clarification_question_fa || null, ambiguityLevel: row.ambiguity_level || 'none', status: row.status, fallbackUsed: Boolean(row.fallback_used), metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata || '{}') : row.metadata || {} });
  const optimizeInput = async ({ text, operationId, operationType = 'chat', conversationId, turnId, attemptId, imageGenerationId, userId, guestId, signal, hasImages = false } = {}) => {
    const originalText = normalizeString(text); const context = { operationId: normalizeString(operationId), operationType: normalizeString(operationType, 'chat'), conversationId, turnId, attemptId, imageGenerationId, userId, guestId, hasImages };
    if (!originalText) return { originalText: '', optimizedTextEn: '', needsClarification: false, clarificationQuestionFa: null, ambiguityLevel: 'none', status: 'skipped', fallbackUsed: false, metadata: { reason: 'empty' } };
    let existing = null;
    if (context.operationId && optimizationRepository && typeof optimizationRepository.findByOperation === 'function') {
      existing = await optimizationRepository.findByOperation(context).catch(() => null);
    }
    if (existing && ['completed', 'clarification_required', 'fallback'].includes(existing.status)) return fromStored(existing);
    const settings = await getSettings(); const startedAt = Date.now(); const key = keyFor(settings);
    if (!settings.enabled) {
      const result = { originalText, optimizedTextEn: originalText, needsClarification: false, clarificationQuestionFa: null, ambiguityLevel: 'none', status: 'disabled', fallbackUsed: false, metadata: { enabled: false, optimizerVersion: settings.version } };
      await save({ ...result, sourceLanguage: languageOf(originalText), model: settings.model, optimizerVersion: settings.version, latencyMs: Date.now() - startedAt, retryCount: 0 }, context); return result;
    }
    if (!key.apiKey || !httpClient?.post) {
      const result = { originalText, optimizedTextEn: originalText, needsClarification: false, clarificationQuestionFa: null, ambiguityLevel: 'none', status: 'fallback', fallbackUsed: true, metadata: { reason: !key.apiKey ? 'missing_key' : 'missing_client', optimizerVersion: settings.version } };
      await save({ ...result, sourceLanguage: languageOf(originalText), model: settings.model, optimizerVersion: settings.version, latencyMs: Date.now() - startedAt, retryCount: 0, errorCode: result.metadata.reason }, context); return result;
    }
    let lastCode = 'OPTIMIZER_FAILED';
    for (let retryCount = 0; retryCount <= settings.maxRetries; retryCount += 1) {
      try {
        if (signal?.aborted) throw Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' });
        const normalized = validateOutput(await call({ text: originalText, context, settings, key, signal }), originalText, settings);
        const result = { originalText, optimizedTextEn: normalized.optimizedTextEn, needsClarification: normalized.needsClarification, clarificationQuestionFa: normalized.clarificationQuestionFa, ambiguityLevel: normalized.ambiguityLevel, status: normalized.needsClarification ? 'clarification_required' : 'completed', fallbackUsed: false, metadata: { ...normalized, provider: 'metis', model: settings.model, optimizerVersion: settings.version, apiKeySource: key.apiKeySource } };
        await save({ ...result, sourceLanguage: normalized.sourceLanguage, model: settings.model, optimizerVersion: settings.version, latencyMs: Date.now() - startedAt, retryCount }, context); return result;
      } catch (error) { if (error?.code === 'CANCELLED' || error?.name === 'AbortError') throw error; lastCode = error?.code || (/timeout/i.test(error?.message || '') ? 'TIMEOUT' : 'OPTIMIZER_FAILED'); }
    }
    const result = { originalText, optimizedTextEn: originalText, needsClarification: false, clarificationQuestionFa: null, ambiguityLevel: 'none', status: 'fallback', fallbackUsed: true, metadata: { errorCode: lastCode, optimizerVersion: settings.version } };
    await save({ ...result, sourceLanguage: languageOf(originalText), model: settings.model, optimizerVersion: settings.version, latencyMs: Date.now() - startedAt, retryCount: settings.maxRetries, errorCode: lastCode }, context); return result;
  };
  return { optimizeInput, getSettings, invalidate: () => { cachedSettings = null; cachedAt = 0; }, getDiagnostics: async () => { const settings = await getSettings(); const key = keyFor(settings); return { ...settings, apiKeySource: key.apiKeySource, apiKeySet: Boolean(key.apiKey), apiKeyFingerprint: key.apiKeyFingerprint }; } };
}

module.exports = { createInputOptimizerService, normalizeInputOptimizerSettings: normalizeSettings, inputOptimizerSettingKeys: settingKeys, validateInputOptimizerOutput: validateOutput };
