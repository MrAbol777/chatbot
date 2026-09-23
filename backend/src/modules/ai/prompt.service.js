function createPromptService({ fileStore, configPath, systemPromptPath, defaultModel, defaultTimeoutMs, fallbackSystemPrompt }) {
  let systemPromptCache = null;
  const safeFallbackSystemPrompt = typeof fallbackSystemPrompt === 'string' && fallbackSystemPrompt.trim()
    ? fallbackSystemPrompt.trim()
    : 'تو یک دستیار هوش مصنوعی فارسی، مفید، امن و کودک‌پسند هستی. پاسخ را روشن و دقیق بده.';

  const getRuntimeConfig = async () => {
    try {
      const parsed = await fileStore.readJson(configPath);
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
      const loadedPrompt = (await fileStore.readFile(systemPromptPath, 'utf8')).trim();
      systemPromptCache = loadedPrompt || safeFallbackSystemPrompt;
      return systemPromptCache;
    } catch (_error) {
      systemPromptCache = safeFallbackSystemPrompt;
      return systemPromptCache;
    }
  };

  const invalidateSystemPromptCache = () => {
    systemPromptCache = null;
  };

  return {
    getRuntimeConfig,
    getSystemPrompt,
    invalidateSystemPromptCache
  };
}

module.exports = { createPromptService };
