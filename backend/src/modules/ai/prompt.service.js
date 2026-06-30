function createPromptService({ fileStore, configPath, systemPromptPath, defaultModel, defaultTimeoutMs }) {
  let systemPromptCache = null;

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
      systemPromptCache = (await fileStore.readFile(systemPromptPath, 'utf8')).trim();
      return systemPromptCache;
    } catch (_error) {
      systemPromptCache = '';
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
