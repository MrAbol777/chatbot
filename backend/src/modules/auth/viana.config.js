const DEFAULT_IDLE_TIMEOUT_SECONDS = 24 * 60 * 60;
const DEFAULT_ABSOLUTE_TIMEOUT_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_HTTP_TIMEOUT_MS = 20_000;

const trim = (value) => (typeof value === 'string' ? value.trim() : '');

function parsePositiveInteger(value, fallback, name) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function requireAbsoluteUrl(value, name) {
  const text = trim(value);
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`${name} must be an absolute URL.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
    throw new Error(`${name} must be an HTTP(S) URL without credentials or a fragment.`);
  }
  return parsed;
}

function normalizeOriginList(value, nodeEnv) {
  const fallback = nodeEnv === 'production' ? 'https://danoa.ir' : 'http://localhost:5173';
  const origins = trim(value || fallback)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const parsed = requireAbsoluteUrl(item, 'APP_ALLOWED_ORIGINS');
      if (parsed.origin !== item.replace(/\/$/, '')) {
        throw new Error('APP_ALLOWED_ORIGINS entries must be exact origins without paths.');
      }
      return parsed.origin;
    });
  return [...new Set(origins)];
}

function loadVianaConfig(env = process.env) {
  const nodeEnv = trim(env.NODE_ENV) || 'development';
  const enabled = trim(env.VIANA_OAUTH_ENABLED).toLowerCase() === 'true';
  const environmentKey = trim(env.VIANA_ENVIRONMENT) || (nodeEnv === 'production' ? 'production' : 'development');
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(environmentKey)) {
    throw new Error('VIANA_ENVIRONMENT must be an immutable lowercase environment key.');
  }

  const allowedOrigins = normalizeOriginList(env.APP_ALLOWED_ORIGINS, nodeEnv);
  const config = {
    enabled,
    environmentKey,
    providerLabel: 'Viana',
    discoveryUrl: trim(env.VIANA_DISCOVERY_URL),
    apiUrl: trim(env.VIANA_API_URL).replace(/\/+$/, ''),
    clientId: trim(env.VIANA_CLIENT_ID),
    clientSecret: trim(env.VIANA_CLIENT_SECRET),
    redirectUri: trim(env.VIANA_REDIRECT_URI),
    postLoginPath: trim(env.VIANA_POST_LOGIN_PATH) || '/',
    httpTimeoutMs: parsePositiveInteger(env.VIANA_HTTP_TIMEOUT_MS, DEFAULT_HTTP_TIMEOUT_MS, 'VIANA_HTTP_TIMEOUT_MS'),
    sessionIdleTimeoutSeconds: parsePositiveInteger(
      env.DANOA_SESSION_IDLE_TIMEOUT_SECONDS,
      DEFAULT_IDLE_TIMEOUT_SECONDS,
      'DANOA_SESSION_IDLE_TIMEOUT_SECONDS'
    ),
    sessionAbsoluteTimeoutSeconds: parsePositiveInteger(
      env.DANOA_SESSION_ABSOLUTE_TIMEOUT_SECONDS ?? env.DANOA_SESSION_TTL_SECONDS,
      DEFAULT_ABSOLUTE_TIMEOUT_SECONDS,
      'DANOA_SESSION_ABSOLUTE_TIMEOUT_SECONDS or DANOA_SESSION_TTL_SECONDS'
    ),
    allowedOrigins,
    sessionCookieName: 'danoa_auth_session',
    flowCookieName: 'danoa_viana_flow',
    noticeCookieName: 'danoa_viana_notice'
  };

  if (config.sessionIdleTimeoutSeconds >= config.sessionAbsoluteTimeoutSeconds) {
    throw new Error('DANOA_SESSION_IDLE_TIMEOUT_SECONDS must be shorter than the absolute timeout.');
  }
  if (!config.postLoginPath.startsWith('/') || config.postLoginPath.startsWith('//')) {
    throw new Error('VIANA_POST_LOGIN_PATH must be a local absolute path.');
  }

  if (!enabled) return config;

  const missing = [
    ['VIANA_DISCOVERY_URL', config.discoveryUrl],
    ['VIANA_API_URL', config.apiUrl],
    ['VIANA_CLIENT_ID', config.clientId],
    ['VIANA_CLIENT_SECRET', config.clientSecret],
    ['VIANA_REDIRECT_URI', config.redirectUri]
  ].filter(([, value]) => !value);
  if (missing.length > 0) {
    throw new Error(`Viana OAuth is enabled but required values are missing: ${missing.map(([name]) => name).join(', ')}`);
  }

  const discovery = requireAbsoluteUrl(config.discoveryUrl, 'VIANA_DISCOVERY_URL');
  const api = requireAbsoluteUrl(config.apiUrl, 'VIANA_API_URL');
  const redirect = requireAbsoluteUrl(config.redirectUri, 'VIANA_REDIRECT_URI');
  if (
    nodeEnv === 'production' &&
    [discovery, api, redirect].some((url) => url.protocol !== 'https:')
  ) {
    throw new Error('Viana frontend, API, and redirect URLs must use HTTPS in production.');
  }
  if (redirect.protocol === 'http:' && redirect.hostname !== 'localhost') {
    throw new Error('HTTP Viana callbacks are allowed only on localhost.');
  }

  return config;
}

module.exports = {
  DEFAULT_ABSOLUTE_TIMEOUT_SECONDS,
  DEFAULT_HTTP_TIMEOUT_MS,
  DEFAULT_IDLE_TIMEOUT_SECONDS,
  loadVianaConfig
};
