'use strict';

const http = require('http');
const https = require('https');
const { fail } = require('../video-generation.errors');
const { VideoStorageError } = require('../storage/video-storage.errors');
const { createVideoResultUrlValidator, createPinnedLookup } = require('../storage/video-result-url-validator');

const CAPABILITIES = Object.freeze(['video.image_to_video_multi']);
const PROVIDER_MODEL_ID = 'x-ai/grok-imagine-video';
const PROVIDER_KEY = 'openrouter';
const ALLOWED_DURATIONS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
const ALLOWED_RESOLUTIONS = Object.freeze(['480p', '720p']);
const ALLOWED_ASPECT_RATIOS = Object.freeze(['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3']);
const MIN_REFERENCES = 2;
const MAX_REFERENCES = 7;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const RESOLUTION_RATES = Object.freeze({ '480p': 0.05, '720p': 0.07 });
const REFERENCE_RATE = 0.002;

function asSafeContentLength(value, maxBytes) {
  if (value === undefined) return null;
  if (!/^\d+$/.test(String(value).trim())) throw new VideoStorageError('VIDEO_RESULT_TOO_LARGE');
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length > maxBytes) throw new VideoStorageError('VIDEO_RESULT_TOO_LARGE');
  return length;
}

function responseMimeType(response) {
  const raw = response.headers?.['content-type'];
  if (Array.isArray(raw) || !raw) throw new VideoStorageError('VIDEO_RESULT_INVALID_MIME');
  const type = String(raw).split(';')[0].trim().toLowerCase();
  if (!['video/mp4', 'video/webm'].includes(type)) throw new VideoStorageError('VIDEO_RESULT_INVALID_MIME');
  return type;
}

function openRouterSubmissionError(code, message, outcome, details = {}) {
  return Object.assign(new Error(message), { code, safe: true, submissionOutcome: outcome, details });
}

function classifyOpenRouterSubmissionError(error) {
  const status = Number(error?.response?.status || 0);
  const body = error?.response?.data;
  if (status === 400 || status === 401 || status === 403) return openRouterSubmissionError('VIDEO_PROVIDER_CONFIRMED_REJECTION', 'OpenRouter rejected the request.', 'confirmed_rejected', { status });
  if (status === 429) return openRouterSubmissionError('VIDEO_PROVIDER_STATUS_UNKNOWN', 'OpenRouter 429 response cannot prove whether a job was accepted.', 'ambiguous', { status });
  if (status >= 500 && status <= 599) return openRouterSubmissionError('VIDEO_PROVIDER_STATUS_UNKNOWN', 'OpenRouter submission result is ambiguous.', 'ambiguous', { status: status || null });
  if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT' || error?.code === 'ECONNRESET') return openRouterSubmissionError('VIDEO_PROVIDER_STATUS_UNKNOWN', 'OpenRouter submission result is ambiguous.', 'ambiguous', { status: status || null });
  return openRouterSubmissionError('VIDEO_PROVIDER_STATUS_UNKNOWN', 'OpenRouter submission result is ambiguous.', 'ambiguous', { status: status || null });
}

function requestAuthenticatedResult(plan, apiKey, { timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const client = plan.url.protocol === 'https:' ? https : http;
    const request = client.request({
      protocol: plan.url.protocol,
      hostname: plan.hostname,
      port: plan.port,
      path: `${plan.url.pathname}${plan.url.search}`,
      method: 'GET',
      headers: { Accept: 'video/mp4, video/webm', 'Accept-Encoding': 'identity', Authorization: `Bearer ${apiKey}` },
      lookup: createPinnedLookup(plan.records),
      servername: plan.hostname
    }, (response) => resolve(response));
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error('Video result download timed out.'), { code: 'ETIMEDOUT' })));
    request.once('error', (error) => reject(error));
    request.end();
  });
}

async function fetchOpenRouterResult(source, apiKey, { validator, timeoutMs, maxBytes, maxRedirects }) {
  let current = await validator.validate(source);
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    let response;
    try { response = await requestAuthenticatedResult(current, apiKey, { timeoutMs, maxBytes }); }
    catch (error) {
      if (error?.code === 'ETIMEDOUT') throw new VideoStorageError('VIDEO_RESULT_DOWNLOAD_TIMEOUT', undefined, { retryable: true });
      if (error?.code === 'VIDEO_RESULT_DNS_REBIND_BLOCKED') throw new VideoStorageError('VIDEO_RESULT_DNS_REBIND_BLOCKED');
      throw new VideoStorageError('VIDEO_RESULT_STREAM_INTERRUPTED', undefined, { retryable: true });
    }
    if (REDIRECT_STATUSES.has(response.statusCode)) {
      const location = response.headers.location;
      response.resume();
      if (!location || Array.isArray(location)) throw new VideoStorageError('VIDEO_RESULT_REDIRECT_BLOCKED');
      if (redirects >= maxRedirects) throw new VideoStorageError('VIDEO_RESULT_TOO_MANY_REDIRECTS');
      try { current = await validator.validate(location, { base: current.url }); }
      catch (error) {
        if (error instanceof VideoStorageError && error.code === 'VIDEO_RESULT_TOO_MANY_REDIRECTS') throw error;
        throw new VideoStorageError(error?.code === 'VIDEO_RESULT_PRIVATE_ADDRESS_BLOCKED' ? 'VIDEO_RESULT_PRIVATE_ADDRESS_BLOCKED' : 'VIDEO_RESULT_REDIRECT_BLOCKED');
      }
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      response.resume();
      if (response.statusCode >= 500 || response.statusCode === 429) throw new VideoStorageError('VIDEO_RESULT_PROVIDER_TEMPORARY', undefined, { retryable: true });
      throw new VideoStorageError('VIDEO_RESULT_PROVIDER_NOT_FOUND');
    }
    const length = asSafeContentLength(response.headers['content-length'], maxBytes);
    const mimeType = responseMimeType(response);
    return { stream: response, mimeType, finalUrl: current.url, contentLength: length };
  }
  throw new VideoStorageError('VIDEO_RESULT_TOO_MANY_REDIRECTS');
}

function createOpenRouterVideoProvider({
  httpClient,
  baseUrl = 'https://openrouter.ai',
  apiKey,
  resultAllowedHosts = [],
  resultAllowedPorts = [443],
  resultAllowedPathPrefixes = ['/'],
  allowTestLocalResult = false,
  dnsResolver,
  requestTimeoutMs = 120_000,
  statusTimeoutMs = 30_000,
  resultTimeoutMs = 60_000,
  resultMaxBytes = 100 * 1024 * 1024,
  resultMaxRedirects = 0,
  maxPromptLength = 2000
}) {
  if (!httpClient || !['object', 'function'].includes(typeof httpClient)) throw new Error('OPENROUTER_HTTP_CLIENT_REQUIRED');
  const configuredRoot = String(baseUrl || '').trim();
  const root = configuredRoot ? (() => { const u = new URL(configuredRoot); return `${u.protocol}//${u.host}`; })() : '';
  const validator = createVideoResultUrlValidator({ allowedHosts: resultAllowedHosts, allowedPorts: resultAllowedPorts, allowedPathPrefixes: resultAllowedPathPrefixes, allowTestLocal: allowTestLocalResult, resolver: dnsResolver });
  const promptLimit = Number(maxPromptLength);
  if (!Number.isSafeInteger(promptLimit) || promptLimit < 256) throw new Error('OPENROUTER_MAX_PROMPT_LENGTH_INVALID');
  const requestConfig = (timeout) => ({ headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout, maxRedirects: 0 });

  function validateRequest(input) {
    if (!root || !String(apiKey || '').trim()) throw fail('VIDEO_PROVIDER_NOT_CONFIGURED', 'تنظیمات سرویس ساخت ویدیو کامل نیست.', 503);
    if (!resultAllowedHosts.length || !validator.allowedPathPrefixes.length) throw openRouterSubmissionError('VIDEO_PROVIDER_RESULT_ALLOWLIST_MISSING', 'OpenRouter result host/path contract is not configured.', 'not_submitted');
    if (String(input?.providerModelId || '') !== PROVIDER_MODEL_ID) throw fail('VIDEO_PROVIDER_MODEL_INVALID', 'مدل سرویس ویدیو معتبر نیست.', 503);
    if (!CAPABILITIES.includes(input?.capability)) throw fail('VIDEO_PROVIDER_CAPABILITY_INVALID', 'قابلیت سرویس ویدیو معتبر نیست.', 409);
    if (!String(input?.prompt || '').trim()) throw fail('VIDEO_PROMPT_REQUIRED', 'متن درخواست الزامی است.');
    if (String(input.prompt).length > promptLimit) throw openRouterSubmissionError('VIDEO_GENERATION_COMPILED_PROMPT_TOO_LONG', 'متن نهایی درخواست از سقف مدل ویدیو بیشتر است.', 'not_submitted', { promptLength: String(input.prompt).length, promptLimit });
    const refs = input?.inputReferences;
    if (!Array.isArray(refs) || refs.length < MIN_REFERENCES || refs.length > MAX_REFERENCES) throw openRouterSubmissionError('VIDEO_PROVIDER_INVALID_INPUT_REFERENCES', `OpenRouter requires ${MIN_REFERENCES}–${MAX_REFERENCES} input references.`, 'not_submitted', { referenceCount: Array.isArray(refs) ? refs.length : 0 });
    for (const ref of refs) {
      if (!ref || typeof ref !== 'object' || !String(ref.url || '').trim().startsWith('https://')) throw openRouterSubmissionError('VIDEO_PROVIDER_INVALID_INPUT_REFERENCES', 'Every input reference must have a non-empty HTTPS URL.', 'not_submitted');
    }
    const duration = Number(input.duration);
    if (!Number.isInteger(duration) || !ALLOWED_DURATIONS.includes(duration)) throw openRouterSubmissionError('VIDEO_PROVIDER_INVALID_DURATION', 'مدت انتخاب‌شده برای سرویس ویدیو معتبر نیست.', 'not_submitted');
    if (!ALLOWED_RESOLUTIONS.includes(String(input.resolution || ''))) throw openRouterSubmissionError('VIDEO_PROVIDER_INVALID_RESOLUTION', 'رزولوشن سرویس ویدیو معتبر نیست.', 'not_submitted');
    if (!ALLOWED_ASPECT_RATIOS.includes(String(input.aspectRatio || ''))) throw openRouterSubmissionError('VIDEO_PROVIDER_INVALID_ASPECT_RATIO', 'نسبت تصویر انتخاب‌شده برای سرویس ویدیو معتبر نیست.', 'not_submitted');
    return input;
  }

  async function submit(input) {
    validateRequest(input);
    if (typeof httpClient.post !== 'function') throw openRouterSubmissionError('VIDEO_PROVIDER_NOT_CONFIGURED', 'OpenRouter HTTP client is not configured.', 'not_submitted');
    const payload = {
      model: PROVIDER_MODEL_ID,
      prompt: String(input.prompt).trim(),
      duration: Number(input.duration),
      resolution: String(input.resolution),
      aspect_ratio: String(input.aspectRatio),
      generate_audio: input.generateAudio === true,
      input_references: input.inputReferences.map((ref) => ({
        type: 'image_url',
        image_url: { url: String(ref.url) }
      }))
    };
    let response;
    try { response = await httpClient.post(`${root}/api/v1/videos`, payload, requestConfig(requestTimeoutMs)); }
    catch (error) { throw classifyOpenRouterSubmissionError(error); }
    if (!response?.data || !String(response.data.id || '').trim()) {
      throw openRouterSubmissionError('VIDEO_PROVIDER_STATUS_UNKNOWN', 'OpenRouter returned a response without a job ID.', 'ambiguous', { status: Number(response?.status || 0) || null });
    }
    return { providerJobId: String(response.data.id), status: 'submitted', pollingUrl: String(response.data.polling_url || '').trim() || null };
  }

  return {
    getProviderKey: () => PROVIDER_KEY,
    getAdapterVersion: () => '1.0.0-docs-2026-08-06',
    getCapabilities: () => [...CAPABILITIES],
    getMetadata: () => Object.freeze({ idempotency: 'NOT_DOCUMENTED', webhook: 'NOT_DOCUMENTED', cancel: 'NOT_DOCUMENTED', inputUpload: 'NOT_DOCUMENTED' }),
    validateRequest,
    estimateCost: (input) => {
      const duration = Number(input?.duration || 0);
      const resolution = String(input?.resolution || '480p');
      const referenceCount = Number(input?.referenceCount || (Array.isArray(input?.inputReferences) ? input.inputReferences.length : 0));
      const rate = RESOLUTION_RATES[resolution] || RESOLUTION_RATES['480p'];
      const total = duration * rate + referenceCount * REFERENCE_RATE;
      return { estimate: Math.round(total * 10000) / 10000, currency: 'USD', breakdown: { durationCost: Math.round(duration * rate * 10000) / 10000, referenceCost: Math.round(referenceCount * REFERENCE_RATE * 10000) / 10000 } };
    },
    submit,
    submitTextToVideo: submit,
    submitImageToVideo: submit,
    getJobStatus: async (jobId) => {
      if (!root || !String(apiKey || '').trim()) throw fail('VIDEO_PROVIDER_NOT_CONFIGURED', 'تنظیمات سرویس ساخت ویدیو کامل نیست.', 503);
      if (typeof httpClient.get !== 'function') throw fail('VIDEO_PROVIDER_NOT_CONFIGURED', 'تنظیمات سرویس ساخت ویدیو کامل نیست.', 503);
      try { return (await httpClient.get(`${root}/api/v1/videos/${encodeURIComponent(jobId)}`, requestConfig(statusTimeoutMs))).data; }
      catch (error) { throw Object.assign(new Error('OpenRouter polling failed.'), { code: 'VIDEO_PROVIDER_POLL_FAILED', retryable: true, safe: true, status: Number(error?.response?.status || 0) || null }); }
    },
    normalizeStatus: (value) => ({ pending: 'submitted', in_progress: 'processing', completed: 'storing', failed: 'failed', cancelled: 'cancelled', expired: 'expired' })[String(value?.status || value || '').toLowerCase()] || null,
    normalizeResult: (value) => {
      const unsignedUrl = Array.isArray(value?.unsigned_urls) && value.unsigned_urls.length ? String(value.unsigned_urls[0]) : null;
      const jobId = String(value?.id || '').trim();
      const authenticatedPath = jobId ? `/api/v1/videos/${encodeURIComponent(jobId)}/content?index=0` : null;
      const source = unsignedUrl || authenticatedPath || null;
      if (!source) return null;
      return { source: String(source), mimeType: value?.mime_type || null, filename: 'video.mp4', sizeBytes: Number.isSafeInteger(Number(value?.size_bytes)) ? Number(value.size_bytes) : null };
    },
    fetchResultStream: async (descriptor) => {
      if (!descriptor?.source) throw new VideoStorageError('VIDEO_RESULT_URL_INVALID');
      if (!String(apiKey || '').trim()) throw new VideoStorageError('VIDEO_RESULT_STREAM_INTERRUPTED');
      const source = String(descriptor.source);
      const url = source.startsWith('/') ? `${root}${source}` : source;
      return fetchOpenRouterResult(url, String(apiKey), { validator, timeoutMs: resultTimeoutMs, maxBytes: resultMaxBytes, maxRedirects: resultMaxRedirects });
    },
    normalizeCost: (value) => {
      if (!value || typeof value !== 'object') return null;
      if (typeof value.usage === 'object' && value.usage !== null && Number.isFinite(Number(value.usage.cost))) return { minor: Number(value.usage.cost), currency: 'USD' };
      return null;
    },
    redact: (value) => String(value || '')
      .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
      .replace(/\/api\/video-provider-input\/[^\s"']+/gi, '/api/video-provider-input/[REDACTED]')
      .replace(/"url"\s*:\s*"https:\/\/[^"]+"/gi, '"url":"[REDACTED]"')
      .replace(/"image_url"\s*:\s*\{[^}]*"url"\s*:\s*"https:\/\/[^"]+"[^}]*\}/gi, '"image_url":{"url":"[REDACTED]"}')
      .replace(/"input_references"\s*:\s*\[[^\]]*\]/gi, '"input_references":"[REDACTED]"')
      .replace(/"unsigned_urls"\s*:\s*\[[^\]]*\]/gi, '"unsigned_urls":"[REDACTED]"')
      .replace(/"source"\s*:\s*"https:\/\/[^"]+"/gi, '"source":"[REDACTED]"'),
    sanitizeError: () => 'سرویس ساخت ویدیو با خطا مواجه شد.'
  };
}

module.exports = { createOpenRouterVideoProvider, classifyOpenRouterSubmissionError, CAPABILITIES, PROVIDER_MODEL_ID };
