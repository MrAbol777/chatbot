class VideoWorkerProcessingError extends Error {
  constructor(code, message = 'Video generation worker could not process this job.', { retryable = false } = {}) {
    super(message);
    this.name = 'VideoWorkerProcessingError';
    this.code = code;
    this.retryable = retryable;
  }
}

function classifyProviderError(error) {
  const status = Number(error?.response?.status || error?.status || 0);
  const code = String(error?.code || '').toUpperCase();
  if (status === 429 || status >= 500 || ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    return { code: status === 429 ? 'VIDEO_PROVIDER_RATE_LIMITED' : code.includes('TIME') ? 'VIDEO_PROVIDER_TIMEOUT' : 'VIDEO_PROVIDER_TEMPORARY_ERROR', retryable: true };
  }
  return { code: error?.code === 'VIDEO_PROVIDER_INVALID_RESPONSE' ? 'VIDEO_PROVIDER_MALFORMED_RESPONSE' : 'VIDEO_PROVIDER_PERMANENT_ERROR', retryable: false };
}

function safeErrorMessage(error, provider) {
  try {
    const message = provider?.sanitizeError?.(error);
    if (typeof message === 'string' && message.trim()) return message.slice(0, 500);
  } catch (_) {}
  return 'خطا در سرویس ساخت ویدیو رخ داد.';
}

module.exports = { VideoWorkerProcessingError, classifyProviderError, safeErrorMessage };
