const http = require('http');
const https = require('https');
const { fail } = require('../video-generation.errors');
const { VideoStorageError } = require('../storage/video-storage.errors');
const { createVideoResultUrlValidator, createPinnedLookup } = require('../storage/video-result-url-validator');

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

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

function requestValidatedResult(plan, { timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const client = plan.url.protocol === 'https:' ? https : http;
    const request = client.request({
      protocol: plan.url.protocol,
      hostname: plan.hostname,
      port: plan.port,
      path: `${plan.url.pathname}${plan.url.search}`,
      method: 'GET',
      headers: { Accept: 'video/mp4, video/webm', 'Accept-Encoding': 'identity' },
      lookup: createPinnedLookup(plan.records),
      servername: plan.hostname
    }, (response) => resolve(response));
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error('Video result download timed out.'), { code: 'ETIMEDOUT' })));
    request.once('error', (error) => reject(error));
    request.end();
  });
}

async function fetchValidatedResult(source, { validator, timeoutMs, maxBytes, maxRedirects }) {
  let current = await validator.validate(source);
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    let response;
    try { response = await requestValidatedResult(current, { timeoutMs, maxBytes }); }
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

function validateMetisBaseUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch (_) { throw fail('VIDEO_PROVIDER_NOT_CONFIGURED', 'تنظیمات سرویس ساخت ویدیو کامل نیست.', 503); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) throw fail('VIDEO_PROVIDER_NOT_CONFIGURED', 'تنظیمات سرویس ساخت ویدیو کامل نیست.', 503);
  return url.origin;
}

function mapMetisError(error) {
  const status = Number(error?.response?.status || 0);
  if (status === 401 || status === 403) return Object.assign(new Error('Metis authentication failed.'), { code: 'VIDEO_PROVIDER_AUTH_FAILED', safe: true });
  if (status === 429) return Object.assign(new Error('Metis rate limit.'), { code: 'VIDEO_PROVIDER_RATE_LIMITED', retryable: true, safe: true });
  if (status >= 500 && status <= 599) return Object.assign(new Error('Metis upstream failure.'), { code: 'VIDEO_PROVIDER_UNAVAILABLE', retryable: true, safe: true });
  if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT') return Object.assign(new Error('Metis request timed out.'), { code: 'VIDEO_PROVIDER_TIMEOUT', retryable: true, safe: true });
  return error;
}

function createMetisVideoProvider({ httpClient, baseUrl, apiKey, resultAllowedHosts = [], resultAllowedPorts = [443], resultAllowedPathPrefixes = ['/'], allowTestLocalResult = false, dnsResolver, requestTimeoutMs = 120_000, statusTimeoutMs = 30_000, resultTimeoutMs = 60_000, resultMaxBytes = 100 * 1024 * 1024, resultMaxRedirects = 0 }) {
  const configuredRoot = String(baseUrl || '').trim();
  const root = configuredRoot ? validateMetisBaseUrl(configuredRoot) : '';
  const headers = () => ({ Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' });
  // The provider API is asynchronous, so a redirect is never needed for either
  // endpoint.  Disabling it makes every outbound HTTP request explicit.
  const requestConfig = (timeout) => ({ headers: headers(), timeout, maxRedirects: 0 });
  const validator = createVideoResultUrlValidator({ allowedHosts: resultAllowedHosts, allowedPorts: resultAllowedPorts, allowedPathPrefixes: resultAllowedPathPrefixes, allowTestLocal: allowTestLocalResult, resolver: dnsResolver });
  const submit = async (input) => {
    if (!root || !apiKey) throw fail('VIDEO_PROVIDER_NOT_CONFIGURED', 'تنظیمات سرویس ساخت ویدیو کامل نیست.', 503);
    if (!['5', '10'].includes(String(input.duration))) throw fail('VIDEO_PROVIDER_INVALID_DURATION', 'مدت انتخاب‌شده برای سرویس ویدیو معتبر نیست.');
    if (!['16:9', '9:16', '1:1'].includes(String(input.aspectRatio))) throw fail('VIDEO_PROVIDER_INVALID_ASPECT_RATIO', 'نسبت تصویر انتخاب‌شده برای سرویس ویدیو معتبر نیست.');
    if (input.mode && input.mode !== 'text-to-video') throw fail('VIDEO_PROVIDER_IMAGE_INPUT_DISABLED', 'ورودی تصویر برای این مدل غیرفعال است.', 409);
    if (input.providerOperation !== 'Video Generation') throw fail('VIDEO_PROVIDER_OPERATION_INVALID', 'عملیات سرویس ویدیو معتبر نیست.', 503);
    if (!input.upstreamVendor || !input.providerModelId) throw fail('VIDEO_PROVIDER_MODEL_INVALID', 'مدل سرویس ویدیو معتبر نیست.', 503);
    const args = { prompt: String(input.prompt || ''), duration: Number(input.duration), aspect_ratio: String(input.aspectRatio) };
    if (input.negativePrompt) args.negative_prompt = String(input.negativePrompt);
    const payload = { model: { name: String(input.upstreamVendor), model: String(input.providerModelId) }, operation: input.providerOperation, args };
    let response;
    try { response = await httpClient.post(`${root}/api/v2/generate`, payload, requestConfig(requestTimeoutMs)); }
    catch (error) { throw mapMetisError(error); }
    if (!response?.data?.id) throw fail('VIDEO_PROVIDER_INVALID_RESPONSE', 'پاسخ سرویس ساخت ویدیو معتبر نیست.', 502);
    return { providerJobId: String(response.data.id), status: 'submitted' };
  };
  return {
    submitTextToVideo: submit, submitImageToVideo: submit,
    getJobStatus: async (id) => {
      if (!root || !apiKey) throw fail('VIDEO_PROVIDER_NOT_CONFIGURED', 'تنظیمات سرویس ساخت ویدیو کامل نیست.', 503);
      try { return (await httpClient.get(`${root}/api/v2/generate/${encodeURIComponent(id)}`, requestConfig(statusTimeoutMs))).data; }
      catch (error) { throw mapMetisError(error); }
    },
    normalizeStatus: (value) => ({ QUEUE: 'queued', WAITING: 'submitted', RUNNING: 'processing', COMPLETED: 'storing', ERROR: 'failed', CANCELLED: 'cancelled' })[String(value?.status || value || '').toUpperCase()] || null,
    normalizeResult: (value) => { const item = value?.generations?.[0] || value?.result; const source = item?.url || item?.source; return source ? { source: String(source), mimeType: item?.mime_type || item?.mimeType || null, filename: item?.filename || 'video.mp4', sizeBytes: Number.isSafeInteger(Number(item?.size_bytes)) ? Number(item.size_bytes) : null } : null; },
    fetchResultStream: async (descriptor) => {
      if (!descriptor?.source) throw new VideoStorageError('VIDEO_RESULT_URL_INVALID');
      return fetchValidatedResult(String(descriptor.source), { validator, timeoutMs: resultTimeoutMs, maxBytes: resultMaxBytes, maxRedirects: resultMaxRedirects });
    },
    normalizeCost: (value) => value?.cost ? { minor: Number(value.cost.minor), currency: String(value.cost.currency || '') } : null,
    sanitizeError: () => 'سرویس ساخت ویدیو با خطا مواجه شد.'
  };
}

module.exports = { createMetisVideoProvider, fetchValidatedResult, requestValidatedResult, validateMetisBaseUrl, mapMetisError };
