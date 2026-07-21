const { fingerprintApiKey } = require('../../bootstrap/config');
const {
  DEFAULT_CONVERSATION_MEMORY_SETTINGS,
  makeSafeKeyInfo,
  normalizeConversationMemorySettings,
  validateConversationMemorySettings
} = require('./conversation-memory.settings');

const extractReply = (response) => {
  if (Array.isArray(response?.candidates)) {
    const text = response.candidates[0]?.content?.parts?.[0]?.text;
    if (typeof text === 'string') return text.trim();
  }
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  return '';
};

const stripCodeFence = (value) => {
  const text = String(value || '').trim();
  const match = text.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
  return (match ? match[1] : text).trim();
};

function createConversationMemoryWriterService({
  httpClient,
  settingsRepository,
  memoryConfig = {},
  chatConfig = {},
  conversationMemoryService,
  logger = console
}) {
  const queues = new Map();
  const turnQueues = new Map();
  let cachedSettings = null;
  let cachedAt = 0;

  const getSettings = async ({ force = false, overrideSettings = null } = {}) => {
    if (overrideSettings && typeof overrideSettings === 'object') {
      const normalized = normalizeConversationMemorySettings({ settings: overrideSettings, memoryConfig });
      validateConversationMemorySettings(normalized);
      return normalized;
    }
    if (!force && cachedSettings && Date.now() - cachedAt < 30000) return cachedSettings;
    const all = settingsRepository && typeof settingsRepository.getAll === 'function'
      ? await settingsRepository.getAll().catch(() => ({}))
      : {};
    const normalized = normalizeConversationMemorySettings({ settings: all, memoryConfig });
    validateConversationMemorySettings(normalized);
    cachedSettings = normalized;
    cachedAt = Date.now();
    return normalized;
  };

  const invalidate = () => {
    cachedSettings = null;
    cachedAt = 0;
  };

  const resolveApiKey = (settings) => {
    const primaryKey = typeof memoryConfig.apiKey === 'string' ? memoryConfig.apiKey.trim() : '';
    if (primaryKey) {
      return {
        apiKey: primaryKey,
        apiKeySource: memoryConfig.apiKeySource || 'METIS_CONVERSATION_MEMORY_API_KEY',
        apiKeyFingerprint: memoryConfig.apiKeyFingerprint || fingerprintApiKey(primaryKey)
      };
    }
    if (settings.allowChatKeyFallback && typeof chatConfig.apiKey === 'string' && chatConfig.apiKey.trim()) {
      return {
        apiKey: chatConfig.apiKey.trim(),
        apiKeySource: `fallback ${chatConfig.apiKeySource || 'chat api key'}`,
        apiKeyFingerprint: chatConfig.apiKeyFingerprint || fingerprintApiKey(chatConfig.apiKey)
      };
    }
    return { apiKey: '', apiKeySource: 'missing', apiKeyFingerprint: '' };
  };

  const enqueue = (conversationId, task) => {
    const key = String(conversationId || '').trim();
    const previous = queues.get(key) || Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(task)
      .finally(() => {
        if (queues.get(key) === current) {
          queues.delete(key);
        }
      });
    queues.set(key, current);
    return current;
  };

  const runExclusive = (conversationId, task) => enqueue(conversationId, task);

  const acquireTurnLock = async (conversationId) => {
    const key = String(conversationId || '').trim();
    if (!key) return () => undefined;

    const previous = turnQueues.get(key) || Promise.resolve();
    let releaseCurrent = null;
    const current = new Promise((resolve) => {
      releaseCurrent = resolve;
    });
    const next = previous
      .catch(() => undefined)
      .then(() => current)
      .finally(() => {
        if (turnQueues.get(key) === next) {
          turnQueues.delete(key);
        }
      });

    turnQueues.set(key, next);
    await previous.catch(() => undefined);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseCurrent();
    };
  };

  const callWriterModel = async ({ previousDocument, userMessage, assistantResponse, conversationId, settings, model, apiKeyInfo }) => {
    if (!apiKeyInfo.apiKey) {
      const error = new Error('conversation-memory api key missing');
      error.code = 'API_KEY_MISSING';
      throw error;
    }
    if (!httpClient || typeof httpClient.post !== 'function') {
      throw new Error('conversation-memory http client missing');
    }
    const url = `https://api.metisai.ir/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const input = [
      `Conversation ID: ${conversationId}`,
      '',
      'Previous conversation document:',
      previousDocument,
      '',
      'Current user message:',
      userMessage,
      '',
      'Current assistant response:',
      assistantResponse
    ].join('\n');

    const response = await httpClient.post(
      url,
      {
        systemInstruction: { parts: [{ text: settings.systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: input }] }],
        generationConfig: {
          temperature: settings.temperature,
          maxOutputTokens: settings.maxOutputTokens
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
    return stripCodeFence(extractReply(response?.data));
  };

  const updateAfterTurn = async ({
    conversationId,
    owner,
    previousDocument = null,
    userMessage,
    assistantResponse,
    sourceUserMessageId = null,
    sourceAssistantMessageId = null
  }) => {
    const startedAt = Date.now();
    let settings = DEFAULT_CONVERSATION_MEMORY_SETTINGS;
    let attemptedModel = null;
    try {
      settings = await getSettings();
      if (!settings.enabled) {
        return { ok: true, skipped: true, status: 'disabled' };
      }

      const document = previousDocument || await conversationMemoryService.readForConversation(conversationId, owner, { createIfMissing: true });
      const apiKeyInfo = resolveApiKey(settings);
      const models = [settings.model];
      if (settings.allowModelFallback && settings.fallbackModel && settings.fallbackModel !== settings.model) {
        models.push(settings.fallbackModel);
      }

      let lastError = null;
      for (const model of models) {
        attemptedModel = model;
        try {
          const content = await callWriterModel({
            previousDocument: document.content || document,
            userMessage,
            assistantResponse,
            conversationId,
            settings,
            model,
            apiKeyInfo
          });
          const saved = await conversationMemoryService.saveUpdatedDocument({
            conversationId,
            content,
            model,
            durationMs: Date.now() - startedAt,
            sourceUserMessageId,
            sourceAssistantMessageId,
            maxDocumentChars: settings.maxDocumentChars
          });
          return {
            ok: true,
            model,
            durationMs: Date.now() - startedAt,
            metadata: saved.metadata,
            apiKey: makeSafeKeyInfo(apiKeyInfo)
          };
        } catch (error) {
          lastError = error;
          logger.warn?.('[conversation-memory] writer attempt failed', {
            conversationId,
            model,
            code: error?.code || null,
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }

      throw lastError || new Error('MEMORY_WRITER_FAILED');
    } catch (error) {
      const errorCode = error?.code || 'MEMORY_WRITER_FAILED';
      await conversationMemoryService.markWriterFailed({
        conversationId,
        errorCode,
        model: attemptedModel,
        durationMs: Date.now() - startedAt,
        sourceUserMessageId,
        sourceAssistantMessageId
      }).catch(() => undefined);
      return {
        ok: false,
        errorCode,
        durationMs: Date.now() - startedAt
      };
    }
  };

  const enqueueUpdateAfterTurn = (payload) => enqueue(payload.conversationId, () => updateAfterTurn(payload));

  const getDiagnostics = async ({ force = false } = {}) => {
    const settings = await getSettings({ force }).catch(() => ({ ...DEFAULT_CONVERSATION_MEMORY_SETTINGS, lastValidationStatus: 'fallback' }));
    const apiKeyInfo = resolveApiKey(settings);
    return {
      enabled: Boolean(settings.enabled),
      provider: settings.provider,
      model: settings.model,
      fallbackModel: settings.fallbackModel,
      ...makeSafeKeyInfo(apiKeyInfo),
      temperature: settings.temperature,
      maxOutputTokens: settings.maxOutputTokens,
      timeoutMs: settings.timeoutMs,
      allowModelFallback: settings.allowModelFallback,
      allowChatKeyFallback: settings.allowChatKeyFallback,
      maxDocumentChars: settings.maxDocumentChars,
      storeMetadata: settings.storeMetadata,
      queueSize: queues.size,
      turnQueueSize: turnQueues.size,
      lastValidationStatus: settings.lastValidationStatus || 'valid'
    };
  };

  return {
    getSettings,
    invalidate,
    acquireTurnLock,
    runExclusive,
    updateAfterTurn,
    enqueueUpdateAfterTurn,
    getDiagnostics
  };
}

module.exports = { createConversationMemoryWriterService };
