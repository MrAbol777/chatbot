'use strict';

const dns = require('node:dns');
const https = require('node:https');
const {
  createPinnedLookup,
  createVideoResultUrlValidator
} = require('../video-generation/storage/video-result-url-validator');

const splitList = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean);

const hostnameOf = (value) => {
  try {
    return new URL(String(value || '')).hostname;
  } catch {
    return '';
  }
};

function createImageResultHttpClient({
  httpClient,
  imageConfig = {},
  env = process.env,
  dnsResolver = dns.promises.lookup
}) {
  if (!httpClient || typeof httpClient.get !== 'function' || typeof httpClient.post !== 'function') {
    throw new Error('Image HTTP client requires get and post methods');
  }

  const configuredHosts = splitList(
    env.IMAGE_RESULT_ALLOWED_HOSTS || env.IMAGE_TO_IMAGE_RESULT_ALLOWED_HOSTS || ''
  );
  const baseHost = hostnameOf(imageConfig.baseUrl);
  const allowedHosts = [...new Set([baseHost, ...configuredHosts].filter(Boolean))];
  const validator = createVideoResultUrlValidator({
    allowedHosts,
    allowedPorts: [443],
    allowedPathPrefixes: ['/'],
    resolver: dnsResolver
  });

  const reject = (cause) => {
    const error = new Error('Image result URL was rejected by the SSRF guard');
    error.code = 'IMAGE_RESULT_URL_REJECTED';
    error.cause = cause;
    return error;
  };

  const validateResultUrl = async (value) => {
    try {
      return await validator.validate(value);
    } catch (error) {
      throw reject(error);
    }
  };

  return {
    post: (...args) => httpClient.post(...args),
    get: async (url, config = {}) => {
      if (config?.responseType !== 'arraybuffer') {
        return httpClient.get(url, config);
      }

      const validated = await validateResultUrl(url);
      const httpsAgent = new https.Agent({
        keepAlive: true,
        lookup: createPinnedLookup(validated.records)
      });
      return httpClient.get(validated.url.toString(), {
        ...config,
        // Never let an allowlisted provider redirect the backend to a second,
        // unchecked destination. The lookup is pinned to the IPs validated
        // above so a DNS rebinding between validation and connect is blocked.
        maxRedirects: 0,
        httpsAgent
      });
    },
    validateResultUrl,
    allowedHosts: () => [...validator.allowedHosts]
  };
}

module.exports = { createImageResultHttpClient };
