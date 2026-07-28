'use strict';

const path = require('path');
const FormData = require('form-data');
const { createVideoResultUrlValidator } = require('../storage/video-result-url-validator');

const EXTENSION_BY_MIME = Object.freeze({
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
});

function inputError(code, message) {
  return Object.assign(new Error(message), {
    code,
    safe: true,
    submissionOutcome: 'not_submitted'
  });
}

function validateUploadBaseUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch (_) { throw inputError('VIDEO_INPUT_UPLOAD_NOT_CONFIGURED', 'Video input upload is not configured.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port || (url.pathname !== '/' && url.pathname !== '')) {
    throw inputError('VIDEO_INPUT_UPLOAD_NOT_CONFIGURED', 'Video input upload base URL is invalid.');
  }
  return url.origin;
}

function createMetisVideoProviderInputPublisher({
  httpClient,
  repository,
  storage,
  baseUrl,
  apiKey,
  allowedHosts = [],
  allowedPathPrefixes = [],
  maxBytes = 5 * 1024 * 1024,
  timeoutMs = 120_000,
  dnsResolver
}) {
  if (!httpClient || typeof httpClient.post !== 'function') throw new Error('VIDEO_INPUT_UPLOAD_HTTP_CLIENT_REQUIRED');
  if (!repository || typeof repository.getForSubmissionUpload !== 'function') throw new Error('VIDEO_INPUT_UPLOAD_REPOSITORY_REQUIRED');
  if (!storage || typeof storage.createReadStream !== 'function') throw new Error('VIDEO_INPUT_UPLOAD_STORAGE_REQUIRED');
  const root = validateUploadBaseUrl(baseUrl);
  const limit = Number(maxBytes);
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 25 * 1024 * 1024) throw new Error('VIDEO_INPUT_UPLOAD_MAX_BYTES_INVALID');
  const validator = createVideoResultUrlValidator({
    allowedHosts,
    allowedPorts: [443],
    allowedPathPrefixes,
    resolver: dnsResolver
  });

  return {
    async createUrl({ mediaId, jobId, attemptId, userId }) {
      if (!String(apiKey || '').trim() || !validator.allowedHosts.length || !validator.allowedPathPrefixes.length) {
        throw inputError('VIDEO_INPUT_UPLOAD_NOT_CONFIGURED', 'Video input upload is not configured.');
      }
      const media = await repository.getForSubmissionUpload({ mediaId, jobId, attemptId, userId });
      if (!media) throw inputError('VIDEO_INPUT_MEDIA_UNAVAILABLE', 'Video input image is unavailable.');
      const sizeBytes = Number(media.size_bytes);
      const mimeType = String(media.mime_type || '').toLowerCase();
      const extension = EXTENSION_BY_MIME[mimeType];
      if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > limit || !extension) {
        throw inputError('VIDEO_INPUT_MEDIA_INVALID', 'Video input image is invalid.');
      }

      const form = new FormData();
      form.append('files', storage.createReadStream(media.storage_key), {
        filename: `danoa-video-input-${String(media.id).slice(0, 12)}${extension}`,
        contentType: mimeType,
        knownLength: sizeBytes
      });

      let response;
      try {
        response = await httpClient.post(`${root}/api/v1/storage`, form, {
          headers: { Authorization: `Bearer ${String(apiKey).trim()}`, ...form.getHeaders() },
          timeout: Number(timeoutMs),
          maxRedirects: 0,
          maxContentLength: limit + 1024 * 1024,
          maxBodyLength: limit + 1024 * 1024
        });
      } catch (_) {
        throw inputError('VIDEO_INPUT_UPLOAD_FAILED', 'Video input image could not be published.');
      }

      const uploadedUrl = response?.data?.files?.[0]?.url;
      if (!String(uploadedUrl || '').trim()) throw inputError('VIDEO_INPUT_UPLOAD_INVALID_RESPONSE', 'Video input upload returned no URL.');
      try {
        const validated = await validator.validate(String(uploadedUrl));
        return validated.url.toString();
      } catch (_) {
        throw inputError('VIDEO_INPUT_UPLOAD_URL_REJECTED', 'Video input upload returned an untrusted URL.');
      }
    },
    redactPath: (value) => {
      try {
        const url = new URL(String(value || ''));
        return `${url.origin}${path.posix.dirname(url.pathname)}/[REDACTED]`;
      } catch (_) {
        return '[REDACTED]';
      }
    }
  };
}

module.exports = { createMetisVideoProviderInputPublisher, validateUploadBaseUrl };
