const path = require('path');
const DEFAULTS = Object.freeze({ maxBytes: 100 * 1024 * 1024, timeoutMs: 60_000, maxRedirects: 0, tempMaxAgeMinutes: 60, maxAttempts: 4, retryBaseDelayMs: 10_000, retryMaxDelayMs: 300_000 });
function positive(value, name) { const n = Number(value); if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${name} must be a positive safe integer.`); return n; }
function ports(value) {
  const configured = String(value || '443').split(',').map((item) => Number(item.trim())).filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);
  if (!configured.length) throw new Error('VIDEO_RESULT_ALLOWED_PORTS must contain at least one valid port.');
  return Object.freeze([...new Set(configured)]);
}
function hosts(value) {
  return Object.freeze([...new Set(String(value || '').split(',').map((item) => item.trim().toLowerCase().replace(/\.+$/, '')).filter(Boolean))]);
}
function pathPrefixes(value) {
  const values = String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!values.length || values.some((item) => !item.startsWith('/') || item.includes('..') || /[?#\\]/.test(item))) throw new Error('VIDEO_RESULT_ALLOWED_PATH_PREFIXES must contain safe absolute paths.');
  return Object.freeze([...new Set(values.map((item) => item.endsWith('/') ? item : `${item}/`))]);
}
function loadVideoStorageConfig(env = process.env) {
  const root = path.resolve(String(env.VIDEO_STORAGE_ROOT || path.join(__dirname, '../../../../storage/videos')));
  const temporaryRoot = path.resolve(String(env.VIDEO_STORAGE_TEMP_ROOT || path.join(root, '.tmp')));
  const redirects = Number(env.VIDEO_RESULT_MAX_REDIRECTS ?? DEFAULTS.maxRedirects);
  if (!Number.isSafeInteger(redirects) || redirects !== 0) throw new Error('VIDEO_RESULT_MAX_REDIRECTS must be 0.');
  const config = { root, temporaryRoot, maxBytes: positive(env.VIDEO_MAX_FILE_SIZE_BYTES || env.VIDEO_RESULT_MAX_BYTES || DEFAULTS.maxBytes, 'VIDEO_MAX_FILE_SIZE_BYTES'), timeoutMs: positive(env.METIS_DOWNLOAD_TIMEOUT_MS || env.VIDEO_RESULT_DOWNLOAD_TIMEOUT_MS || DEFAULTS.timeoutMs, 'METIS_DOWNLOAD_TIMEOUT_MS'), maxRedirects: redirects, tempMaxAgeMinutes: positive(env.VIDEO_STORAGE_TEMP_MAX_AGE_MINUTES || DEFAULTS.tempMaxAgeMinutes, 'VIDEO_STORAGE_TEMP_MAX_AGE_MINUTES'), maxAttempts: positive(env.VIDEO_STORAGE_MAX_ATTEMPTS || DEFAULTS.maxAttempts, 'VIDEO_STORAGE_MAX_ATTEMPTS'), retryBaseDelayMs: positive(env.VIDEO_STORAGE_RETRY_BASE_DELAY_MS || DEFAULTS.retryBaseDelayMs, 'VIDEO_STORAGE_RETRY_BASE_DELAY_MS'), retryMaxDelayMs: positive(env.VIDEO_STORAGE_RETRY_MAX_DELAY_MS || DEFAULTS.retryMaxDelayMs, 'VIDEO_STORAGE_RETRY_MAX_DELAY_MS') };
  config.allowedHosts = hosts(env.VIDEO_RESULT_ALLOWED_HOSTS || env.METIS_VIDEO_RESULT_ALLOWED_HOSTS);
  config.allowedPorts = ports(env.VIDEO_RESULT_ALLOWED_PORTS);
  config.allowedPathPrefixes = pathPrefixes(env.VIDEO_RESULT_ALLOWED_PATH_PREFIXES || env.METIS_VIDEO_RESULT_ALLOWED_PATH_PREFIXES || '/');
  if (config.maxBytes > 2 * 1024 * 1024 * 1024) throw new Error('VIDEO_RESULT_MAX_BYTES must not exceed 2GiB.');
  if (config.retryMaxDelayMs < config.retryBaseDelayMs) throw new Error('VIDEO_STORAGE_RETRY_MAX_DELAY_MS must be >= VIDEO_STORAGE_RETRY_BASE_DELAY_MS.');
  return Object.freeze(config);
}
module.exports = { DEFAULTS, loadVideoStorageConfig };
