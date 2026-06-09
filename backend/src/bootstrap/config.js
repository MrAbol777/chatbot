const path = require('path');

const normalizePort = (value, fallback = 3000) => {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed;
  }
  return fallback;
};

const normalizeBaseUrl = (value, fallback) => String(value || fallback).replace(/\/+$/, '');

function loadRuntimeConfig(env = process.env) {
  const port = normalizePort(env.PORT, 3000);
  const host = '0.0.0.0';
  const metisBaseUrl = normalizeBaseUrl(
    env.METIS_OPENAI_BASE_URL || env.OPENAI_BASE_URL,
    'https://api.metisai.ir/openai/v1'
  );
  const defaultModel = env.OPENAI_MODEL || 'gemini-2.5-flash';
  const metisApiKey =
    typeof (env.METIS_API_KEY || env.OPENAI_API_KEY) === 'string'
      ? (env.METIS_API_KEY || env.OPENAI_API_KEY).trim()
      : '';
  const defaultTimeoutMs = Number(env.GAPGPT_TIMEOUT_MS || 30000);
  const adminApiKey = typeof env.ADMIN_API_KEY === 'string' ? env.ADMIN_API_KEY.trim() : '';
  const adminJwtSecret = typeof env.ADMIN_JWT_SECRET === 'string' ? env.ADMIN_JWT_SECRET.trim() : 'danoa-admin-secret';
  const authJwtSecret = typeof env.AUTH_JWT_SECRET === 'string' ? env.AUTH_JWT_SECRET.trim() : adminJwtSecret;
  const adminCookieName = env.ADMIN_COOKIE_NAME || 'admin_token';

  const adminConfigPath = path.join(__dirname, '../../config.json');
  const systemPromptPath = path.join(__dirname, '../../system-prompt.txt');
  const frontendDistPath = path.join(__dirname, '../../../frontend/dist');

  return {
    port,
    host,
    metisBaseUrl,
    defaultModel,
    metisApiKey,
    defaultTimeoutMs,
    adminApiKey,
    adminJwtSecret,
    authJwtSecret,
    adminCookieName,
    adminConfigPath,
    systemPromptPath,
    frontendDistPath
  };
}

module.exports = {
  loadRuntimeConfig
};
