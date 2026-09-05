'use strict';

const dns = require('node:dns');
const https = require('node:https');
const FormData = require('form-data');
const { imageToImageError } = require('../image-to-image.errors');
const {
  createPinnedLookup,
  createVideoResultUrlValidator
} = require('../../video-generation/storage/video-result-url-validator');

const MIME_BY_EXTENSION = Object.freeze({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' });

function createMetisImageToImageProvider({
  httpClient,
  baseUrl = 'https://api.metisai.ir',
  apiKey,
  model = 'nano-banana',
  resolution = '1K',
  outputFormat = 'jpg',
  pollTimeoutMs = 120_000,
  pollIntervalMs = 2_000,
  maxResultBytes = 10 * 1024 * 1024,
  allowedResultHosts = [],
  dnsResolver = dns.promises.lookup
}) {
  const rootUrl = String(baseUrl).replace(/\/+$/, '');
  const requestHeaders = () => ({ Authorization: `Bearer ${apiKey}` });
  const resultValidator = createVideoResultUrlValidator({
    allowedHosts: allowedResultHosts,
    allowedPorts: [443],
    allowedPathPrefixes: ['/'],
    resolver: dnsResolver
  });
  const safeError = (error, fallback) => imageToImageError(
    error?.response?.status === 401 ? 'IMAGE_TO_IMAGE_PROVIDER_AUTH_FAILED' : 'IMAGE_TO_IMAGE_PROVIDER_FAILED',
    error?.response?.status === 401 ? 'دسترسی سرویس تصویر برقرار نشد.' : fallback,
    502
  );
  const validateResult = async (value) => {
    try {
      return await resultValidator.validate(value);
    } catch (error) {
      throw imageToImageError('IMAGE_TO_IMAGE_RESULT_URL_REJECTED', 'آدرس خروجی سرویس تصویر معتبر نیست.', 502, { cause: error?.code || 'URL_REJECTED' });
    }
  };
  const upload = async (source, index) => {
    const form = new FormData();
    form.append('files', source.buffer, { filename: `image-to-image-${index + 1}.${source.extension}`, contentType: source.mimeType });
    const response = await httpClient.post(`${rootUrl}/api/v1/storage`, form, {
      headers: { ...requestHeaders(), ...form.getHeaders() }, timeout: 120_000, maxBodyLength: maxResultBytes + 1024 * 1024
    });
    const url = response?.data?.files?.[0]?.url;
    if (!url) throw imageToImageError('IMAGE_TO_IMAGE_PROVIDER_UPLOAD_FAILED', 'سرویس تصویر آدرس ورودی را برنگرداند.', 502);
    return String(url);
  };
  return {
    key: 'metis',
    async submit({ prompt, aspectRatio, sources }) {
      if (!apiKey) throw imageToImageError('IMAGE_TO_IMAGE_PROVIDER_NOT_CONFIGURED', 'کلید سرویس تصویر تنظیم نشده است.', 503);
      try {
        const imageInput = [];
        for (let index = 0; index < sources.length; index += 1) imageInput.push(await upload(sources[index], index));
        const response = await httpClient.post(`${rootUrl}/api/v2/generate`, {
          model: { name: 'google', model }, operation: 'Imagine',
          args: { prompt, image_input: imageInput.length === 1 ? imageInput[0] : imageInput, aspect_ratio: aspectRatio, resolution, output_format: outputFormat, safety_filter_level: 'block_only_high' }
        }, { headers: { ...requestHeaders(), 'Content-Type': 'application/json' }, timeout: 120_000 });
        const taskId = response?.data?.id;
        if (!taskId) throw imageToImageError('IMAGE_TO_IMAGE_PROVIDER_RESPONSE_INVALID', 'سرویس تصویر شناسهٔ کار را برنگرداند.', 502);
        return { taskId: String(taskId) };
      } catch (error) { if (error?.code?.startsWith('IMAGE_TO_IMAGE_')) throw error; throw safeError(error, 'ارسال درخواست ویرایش تصویر ناموفق بود.'); }
    },
    async poll({ taskId }) {
      try {
        const response = await httpClient.get(`${rootUrl}/api/v2/generate/${encodeURIComponent(taskId)}`, { headers: requestHeaders(), timeout: 30_000 });
        const status = String(response?.data?.status || '').toUpperCase();
        if (status === 'COMPLETED') {
          const url = response?.data?.generations?.[0]?.url || response?.data?.generations?.[0]?.content;
          if (!url) throw imageToImageError('IMAGE_TO_IMAGE_PROVIDER_EMPTY_RESULT', 'سرویس تصویر خروجی معتبر نداد.', 502);
          return { state: 'completed', resultUrl: String(url) };
        }
        if (status === 'ERROR' || status === 'FAILED') return { state: 'failed', errorCode: 'IMAGE_TO_IMAGE_PROVIDER_REJECTED' };
        return { state: 'pending' };
      } catch (error) { if (error?.code?.startsWith('IMAGE_TO_IMAGE_')) throw error; throw safeError(error, 'دریافت وضعیت ویرایش تصویر ناموفق بود.'); }
    },
    async download({ resultUrl }) {
      try {
        const validated = await validateResult(resultUrl);
        const response = await httpClient.get(validated.url.toString(), {
          responseType: 'arraybuffer',
          timeout: 120_000,
          maxContentLength: maxResultBytes,
          maxBodyLength: maxResultBytes,
          maxRedirects: 0,
          httpsAgent: new https.Agent({
            keepAlive: true,
            lookup: createPinnedLookup(validated.records)
          })
        });
        const mimeType = String(response?.headers?.['content-type'] || 'image/png').split(';')[0].trim().toLowerCase();
        const buffer = Buffer.from(response?.data || []);
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) throw imageToImageError('IMAGE_TO_IMAGE_RESULT_INVALID', 'خروجی سرویس تصویر فرمت معتبر ندارد.', 502);
        if (!buffer.length || buffer.length > maxResultBytes) throw imageToImageError('IMAGE_TO_IMAGE_RESULT_INVALID', 'حجم خروجی سرویس تصویر معتبر نیست.', 502);
        return { buffer, mimeType: ['image/jpeg', 'image/png', 'image/webp'].includes(mimeType) ? mimeType : 'image/png' };
      } catch (error) { if (error?.code?.startsWith('IMAGE_TO_IMAGE_')) throw error; throw safeError(error, 'دانلود خروجی ویرایش تصویر ناموفق بود.'); }
    },
    getPollConfig: () => ({ pollTimeoutMs, pollIntervalMs })
  };
}

module.exports = { createMetisImageToImageProvider };
