'use strict';

const https = require('https');
const { fail } = require('../video-generation.errors');
const { VideoStorageError } = require('../storage/video-storage.errors');
const { fetchValidatedResultWithNode, validateProviderBaseUrl } = require('./provider-result-downloader');
const { createVideoResultUrlValidator } = require('../storage/video-result-url-validator');
const { BANANAAI_MODEL_IDS, BANANAAI_IMAGE_TO_VIDEO_MODEL_ID } = require('../video-model.registry');

const CONFIRMED_REJECTION_STATUSES = new Set([400, 401, 403, 409, 422, 429]);
const CAPABILITIES = Object.freeze(['video.text_to_video', 'video.image_to_video']);
const REJECTION_CODES = Object.freeze({
  invalid_request: 'VIDEO_PROVIDER_INVALID_REQUEST',
  insufficient_credits: 'VIDEO_PROVIDER_INSUFFICIENT_CREDITS',
  rate_limit_exceeded: 'VIDEO_PROVIDER_RATE_LIMITED',
  missing_authorization: 'VIDEO_PROVIDER_AUTH_FAILED',
  invalid_api_key: 'VIDEO_PROVIDER_AUTH_FAILED',
  revoked_api_key: 'VIDEO_PROVIDER_AUTH_FAILED'
});
const SAFE_ERROR_MESSAGES = Object.freeze({
  VIDEO_PROVIDER_INVALID_REQUEST: 'درخواست ارسالی برای سرویس ساخت ویدیو معتبر نیست.',
  VIDEO_PROVIDER_INSUFFICIENT_CREDITS: 'اعتبار سرویس بالادستی برای ساخت ویدیو کافی نیست.',
  VIDEO_PROVIDER_RATE_LIMITED: 'سرویس ساخت ویدیو موقتاً با محدودیت درخواست مواجه است.',
  VIDEO_PROVIDER_AUTH_FAILED: 'دسترسی سرویس ساخت ویدیو به Provider معتبر نیست.',
  VIDEO_GENERATION_COMPILED_PROMPT_TOO_LONG: 'متن نهایی درخواست از سقف مدل ویدیو بیشتر است.'
});

function validErrorEnvelope(value) {
  return Boolean(value && typeof value.error === 'object' && typeof value.error.code === 'string' && typeof value.error.message === 'string');
}

function bananaSubmissionError(code, message, outcome, details = {}) {
  return Object.assign(new Error(message), { code, safe: true, submissionOutcome: outcome, details });
}

function createBananaProxyConfig(value) {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  let url;
  try { url = new URL(raw); } catch (_) { throw fail('VIDEO_PROVIDER_NOT_CONFIGURED', 'تنظیمات پروکسی سرویس ساخت ویدیو معتبر نیست.', 503); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.pathname !== '/' || url.search || url.hash) {
    throw fail('VIDEO_PROVIDER_NOT_CONFIGURED', 'تنظیمات پروکسی سرویس ساخت ویدیو معتبر نیست.', 503);
  }
  const proxy = {
    protocol: url.protocol.slice(0, -1),
    host: url.hostname,
    port: Number(url.port || (url.protocol === 'https:' ? 443 : 80))
  };
  if (url.username || url.password) proxy.auth = { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
  return proxy;
}

function classifyBananaSubmissionError(error) {
  const status = Number(error?.response?.status || 0);
  const body = error?.response?.data;
  const providerCode = validErrorEnvelope(body)
    ? String(body.error.code).trim().toLowerCase()
    : String(body?.code || body?.error?.code || '').trim().toLowerCase().slice(0, 80);
  if (status === 409 && providerCode === 'idempotency_key_in_progress') {
    return bananaSubmissionError('VIDEO_PROVIDER_STATUS_UNKNOWN', 'BananaAI is still registering the idempotent request.', 'ambiguous', {
      status,
      providerCode,
      retryAfter: String(error?.response?.headers?.['retry-after'] || '').slice(0, 32) || null
    });
  }
  if (CONFIRMED_REJECTION_STATUSES.has(status)) {
    const rejectionCode = providerCode || 'confirmed_rejection';
    const code = REJECTION_CODES[rejectionCode] || 'VIDEO_PROVIDER_CONFIRMED_REJECTION';
    return bananaSubmissionError(code, 'BananaAI rejected the request.', 'confirmed_rejected', { status, providerCode:rejectionCode });
  }
  const transportCode = String(error?.code || '').toUpperCase();
  const code = status >= 500
    ? 'VIDEO_PROVIDER_UNAVAILABLE'
    : ['ECONNABORTED', 'ETIMEDOUT'].includes(transportCode)
      ? 'VIDEO_PROVIDER_TIMEOUT'
      : ['ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH'].includes(transportCode)
        ? 'VIDEO_PROVIDER_NETWORK_ERROR'
        : 'VIDEO_PROVIDER_STATUS_UNKNOWN';
  return bananaSubmissionError(code, 'BananaAI submission result is ambiguous.', 'ambiguous', { status: status || null, transportCode: transportCode || null });
}

function createBananaAiVideoProvider({
  httpClient,
  baseUrl = 'https://bananaai.ir',
  apiKey,
  proxyUrl,
  forceIpv4 = true,
  resultAllowedHosts = [],
  resultAllowedPorts = [443],
  resultAllowedPathPrefixes = ['/'],
  allowTestLocalResult = false,
  dnsResolver,
  requestTimeoutMs = 10_000,
  statusTimeoutMs = 30_000,
  maxPromptLength,
  maxTextPromptLength = maxPromptLength == null ? 8000 : maxPromptLength,
  maxImagePromptLength = maxPromptLength == null ? 2000 : maxPromptLength,
  resultConnectTimeoutMs = 15_000,
  resultHeadersTimeoutMs = 30_000,
  resultIdleTimeoutMs = 90_000,
  resultTotalTimeoutMs = 0,
  resultResumeAttempts = 2,
  resultRangeChunkBytes = 256 * 1024,
  resultMaxBytes = 100 * 1024 * 1024,
  resultMaxRedirects = 0
}) {
  if (!httpClient || !['object', 'function'].includes(typeof httpClient)) throw new Error('BANANAAI_HTTP_CLIENT_REQUIRED');
  const configuredRoot = String(baseUrl || '').trim();
  const root = configuredRoot ? validateProviderBaseUrl(configuredRoot) : '';
  const proxy = createBananaProxyConfig(proxyUrl);
  const httpsAgent = new https.Agent({ keepAlive: true, ...(forceIpv4 ? { family: 4 } : {}) });
  const validator = createVideoResultUrlValidator({ allowedHosts: resultAllowedHosts, allowedPorts: resultAllowedPorts, allowedPathPrefixes: resultAllowedPathPrefixes, allowTestLocal: allowTestLocalResult, resolver: dnsResolver });
  const textPromptLimit = Number(maxTextPromptLength);
  const imagePromptLimit = Number(maxImagePromptLength);
  if (!Number.isSafeInteger(textPromptLimit) || textPromptLimit < 256 || !Number.isSafeInteger(imagePromptLimit) || imagePromptLimit < 256) throw new Error('BANANAAI_MAX_PROMPT_LENGTH_INVALID');
  const requestConfig = (timeout, idempotencyKey = null) => {
    const key = String(idempotencyKey || '').trim();
    return {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(key ? { 'Idempotency-Key': key.slice(0, 191) } : {})
      },
      timeout,
      maxRedirects: 0,
      httpsAgent,
      ...(proxy ? { proxy } : {}),
      transitional: { clarifyTimeoutError: true }
    };
  };

  function validateRequest(input) {
    if (!root || !String(apiKey || '').trim()) throw fail('VIDEO_PROVIDER_NOT_CONFIGURED', 'تنظیمات سرویس ساخت ویدیو کامل نیست.', 503);
    if (!resultAllowedHosts.length || !validator.allowedPathPrefixes.length) throw bananaSubmissionError('VIDEO_PROVIDER_RESULT_ALLOWLIST_MISSING', 'BananaAI result host/path contract is not configured.', 'not_submitted');
    if (!BANANAAI_MODEL_IDS.includes(String(input?.providerModelId || ''))) throw fail('VIDEO_PROVIDER_MODEL_INVALID', 'مدل سرویس ویدیو معتبر نیست.', 503);
    if (!CAPABILITIES.includes(input?.capability)) throw fail('VIDEO_PROVIDER_CAPABILITY_INVALID', 'قابلیت سرویس ویدیو معتبر نیست.', 409);
    if (input.capability === 'video.image_to_video' && input.providerModelId !== BANANAAI_IMAGE_TO_VIDEO_MODEL_ID) throw fail('VIDEO_PROVIDER_MODEL_INVALID', 'مسیر ساخت ویدیو از تصویر فقط برای مدل Grok پیکربندی شده است.', 503);
    if (!String(input?.prompt || '').trim()) throw fail('VIDEO_PROMPT_REQUIRED', 'متن درخواست الزامی است.');
    const promptLimit = input.capability === 'video.text_to_video' ? textPromptLimit : imagePromptLimit;
    if (String(input.prompt).length > promptLimit) throw bananaSubmissionError('VIDEO_GENERATION_COMPILED_PROMPT_TOO_LONG', SAFE_ERROR_MESSAGES.VIDEO_GENERATION_COMPILED_PROMPT_TOO_LONG, 'not_submitted', { promptLength: String(input.prompt).length, promptLimit });
    if (input.negativePrompt) throw fail('VIDEO_PROVIDER_CAPABILITY_UNSUPPORTED', 'Negative Prompt برای این سرویس مستند نشده است.', 409);
    if (input.capability === 'video.image_to_video' && !String(input.providerInputUrl || '').trim()) throw fail('VIDEO_INPUT_MEDIA_REQUIRED', 'تصویر ورودی الزامی است.');
    return input;
  }

  async function submit(input) {
    validateRequest(input);
    if (typeof httpClient.post !== 'function') throw bananaSubmissionError('VIDEO_PROVIDER_NOT_CONFIGURED', 'BananaAI HTTP client is not configured.', 'not_submitted');
    const payload = {
      model: String(input.providerModelId),
      prompt: String(input.prompt)
    };
    if (String(input.duration ?? '').trim()) payload.duration = Number(input.duration);
    if (input.resolution) payload.resolution = String(input.resolution);
    if (input.aspectRatio) payload.aspect_ratio = String(input.aspectRatio);
    if (input.generateAudio === true) payload.generate_audio = true;
    const endpoint = input.capability === 'video.image_to_video' ? '/api/v1/videos/image-to-video' : '/api/v1/videos/generations';
    if (input.capability === 'video.image_to_video') payload.image_urls = [String(input.providerInputUrl)];
    let response;
    try { response = await httpClient.post(`${root}${endpoint}`, payload, requestConfig(requestTimeoutMs, input.idempotencyKey)); }
    catch (error) { throw classifyBananaSubmissionError(error); }
    const providerJobId = String(response?.data?.id || response?.data?.taskId || '').trim();
    if (!response?.data || !providerJobId) {
      throw bananaSubmissionError('VIDEO_PROVIDER_STATUS_UNKNOWN', 'BananaAI returned a response without a task ID.', 'ambiguous', { status: Number(response?.status || 0) || null });
    }
    return { providerJobId, status: 'submitted', creditsReserved: Number.isFinite(Number(response.data.credits_reserved)) ? Number(response.data.credits_reserved) : null };
  }

  return {
    getProviderKey: () => 'bananaai',
    getAdapterVersion: () => '1.1.0-docs-2026-08-31',
    getCapabilities: () => [...CAPABILITIES],
    getMetadata: () => Object.freeze({ idempotency: 'SUPPORTED_24H', webhook: 'NOT_DOCUMENTED', cancel: 'NOT_DOCUMENTED', inputUpload: 'NOT_DOCUMENTED' }),
    validateRequest,
    estimateCost: () => null,
    submit,
    submitTextToVideo: (input) => submit({ ...input, capability: 'video.text_to_video' }),
    submitImageToVideo: (input) => submit({ ...input, capability: 'video.image_to_video' }),
    getJobStatus: async (taskId) => {
      if (!root || !String(apiKey || '').trim()) throw fail('VIDEO_PROVIDER_NOT_CONFIGURED', 'تنظیمات سرویس ساخت ویدیو کامل نیست.', 503);
      if (typeof httpClient.get !== 'function') throw fail('VIDEO_PROVIDER_NOT_CONFIGURED', 'تنظیمات سرویس ساخت ویدیو کامل نیست.', 503);
      try { return (await httpClient.get(`${root}/api/v1/tasks/${encodeURIComponent(taskId)}`, requestConfig(statusTimeoutMs))).data; }
      catch (error) {
        const status = Number(error?.response?.status || 0) || null;
        const code = status === 429 ? 'VIDEO_PROVIDER_RATE_LIMITED' : status >= 500 ? 'VIDEO_PROVIDER_UNAVAILABLE' : ['ECONNABORTED', 'ETIMEDOUT'].includes(error?.code) ? 'VIDEO_PROVIDER_TIMEOUT' : 'VIDEO_PROVIDER_POLL_FAILED';
        throw Object.assign(new Error('BananaAI polling failed.'), { code, retryable: true, safe: true, status, retryAfter: error?.response?.headers?.['retry-after'] || null });
      }
    },
    normalizeStatus: (value) => ({ pending: 'submitted', processing: 'processing', completed: 'storing', failed: 'failed' })[String(value?.status || value || '').toLowerCase()] || null,
    normalizeResult: (value) => {
      const item = value?.videos?.[0];
      const source = typeof item === 'string' ? item : item?.url || item?.source;
      return source ? { source: String(source), mimeType: item?.mime_type || item?.mimeType || null, filename: item?.filename || 'video.mp4', sizeBytes: Number.isSafeInteger(Number(item?.size_bytes)) ? Number(item.size_bytes) : null } : null;
    },
    fetchResultStream: async (descriptor, options = {}) => {
      if (!descriptor?.source) throw new VideoStorageError('VIDEO_RESULT_URL_INVALID');
      return fetchValidatedResultWithNode(String(descriptor.source), {
        validator,
        maxBytes: Number(options.maxBytes || resultMaxBytes),
        maxRedirects: Number(options.maxRedirects ?? resultMaxRedirects),
        connectTimeoutMs: resultConnectTimeoutMs,
        headersTimeoutMs: resultHeadersTimeoutMs,
        idleTimeoutMs: resultIdleTimeoutMs,
        totalTimeoutMs: resultTotalTimeoutMs,
        resumeAttempts: resultResumeAttempts,
        rangeChunkBytes: resultRangeChunkBytes,
        proxyUrl,
        forceIpv4,
        logger: options.logger,
        context: options.context
      });
    },
    normalizeCost: (value) => String(value?.status || '').toLowerCase() === 'completed' && value?.credits_deducted === true && Number.isFinite(Number(value?.credits_reserved))
      ? { credits: Number(value.credits_reserved), currency: 'credits' }
      : null,
    redact: (value) => String(value || '').replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]').replace(/\/api\/video-provider-input\/[^\s"']+/gi, '/api/video-provider-input/[REDACTED]'),
    sanitizeError: (error) => SAFE_ERROR_MESSAGES[error?.code] || 'سرویس ساخت ویدیو با خطا مواجه شد.'
  };
}

module.exports = { createBananaAiVideoProvider, classifyBananaSubmissionError, validErrorEnvelope, REJECTION_CODES, SAFE_ERROR_MESSAGES };
