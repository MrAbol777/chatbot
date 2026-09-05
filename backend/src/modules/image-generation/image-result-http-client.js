'use strict';

const splitList = (value) => String(value || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);

const hostnameOf = (value) => {
  try {
    return new URL(String(value || '')).hostname.toLowerCase();
  } catch {
    return '';
  }
};

function createImageResultHttpClient({ httpClient, imageConfig = {}, env = process.env }) {
  if (!httpClient || typeof httpClient.get !== 'function' || typeof httpClient.post !== 'function') {
    throw new Error('Image HTTP client requires get and post methods');
  }

  const configuredHosts = splitList(
    env.IMAGE_RESULT_ALLOWED_HOSTS || env.IMAGE_TO_IMAGE_RESULT_ALLOWED_HOSTS || ''
  );
  const baseHost = hostnameOf(imageConfig.baseUrl);
  const allowedHosts = new Set([baseHost, ...configuredHosts].filter(Boolean));

  const validateResultUrl = (value) => {
    let parsed;
    try {
      parsed = new URL(String(value || ''));
    } catch {
      const error = new Error('Image result URL is invalid');
      error.code = 'IMAGE_RESULT_URL_REJECTED';
      throw error;
    }

    const host = parsed.hostname.toLowerCase();
    const port = parsed.port || '443';
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      port !== '443' ||
      !allowedHosts.has(host)
    ) {
      const error = new Error('Image result URL is not in the configured allowlist');
      error.code = 'IMAGE_RESULT_URL_REJECTED';
      throw error;
    }
    return parsed.toString();
  };

  return {
    post: (...args) => httpClient.post(...args),
    get: (url, config = {}) => {
      if (config?.responseType === 'arraybuffer') {
        const safeUrl = validateResultUrl(url);
        return httpClient.get(safeUrl, {
          ...config,
          // Never let an allowlisted CDN/provider redirect the backend to a
          // second unchecked destination (including localhost/private IPs).
          maxRedirects: 0
        });
      }
      return httpClient.get(url, config);
    },
    validateResultUrl,
    allowedHosts: () => [...allowedHosts]
  };
}

module.exports = { createImageResultHttpClient };
