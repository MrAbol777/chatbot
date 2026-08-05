const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const { loadVianaConfig } = require('./viana.config');
const { createVianaService, validateStudent } = require('./viana.service');

const discovery = {
  issuer: 'https://vianaland.ir',
  authorization_endpoint: 'https://vianaland.ir/oauth/continue',
  token_endpoint: 'https://vianaland.ir/api/v1/identity/token',
  userinfo_endpoint: 'https://vianaland.ir/api/v1/identity/userinfo',
  scopes_supported: ['openid', 'profile', 'student.self:read', 'students.contact:read', 'students.sensitive:read'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['client_secret_basic']
};
const config = {
  discoveryUrl: 'https://vianaland.ir/.well-known/openid-configuration',
  studentSelfUrl: 'https://vianaland.ir/api/v1/students/me',
  clientId: 'production-client', clientSecret: 'server-only-secret',
  redirectUri: 'https://danoa.ir/api/auth/viana/callback', httpTimeoutMs: 1000
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const student = { id: 'subject', firstName: 'دانش‌آموز', lastName: 'نمونه', grade: 'NINE', dateOfBirth: '2010-01-01', studentPhone: '09120000000', guardianPhone: '09120000001', points: 42 };

test('disabled configuration has safe defaults and enabled production uses Discovery plus the exact Danoa callback', () => {
  assert.equal(loadVianaConfig({ NODE_ENV: 'development', VIANA_OAUTH_ENABLED: 'false' }).enabled, false);
  const value = loadVianaConfig({
    NODE_ENV: 'production', VIANA_OAUTH_ENABLED: 'true', VIANA_ENVIRONMENT: 'production',
    VIANA_DISCOVERY_URL: config.discoveryUrl, VIANA_API_URL: 'https://vianaland.ir/api/v1',
    VIANA_CLIENT_ID: config.clientId, VIANA_CLIENT_SECRET: config.clientSecret, VIANA_REDIRECT_URI: config.redirectUri,
    APP_ALLOWED_ORIGINS: 'https://danoa.ir'
  });
  assert.equal(value.discoveryUrl, config.discoveryUrl);
  assert.equal(value.studentSelfUrl, 'https://vianaland.ir/api/v1/students/me');
  assert.equal(value.redirectUri, config.redirectUri);
  assert.throws(() => loadVianaConfig({ ...process.env, NODE_ENV: 'production', VIANA_OAUTH_ENABLED: 'true', VIANA_DISCOVERY_URL: config.discoveryUrl, VIANA_API_URL: 'http://vianaland.ir/api/v1', VIANA_CLIENT_ID: 'x', VIANA_CLIENT_SECRET: 'y', VIANA_REDIRECT_URI: config.redirectUri }), /must use HTTPS/);
});

test('authorization request reads Discovery and contains state, nonce and S256 PKCE', async () => {
  const service = createVianaService({ config, fetchImpl: async () => json(discovery) });
  const request = await service.generateAuthorizationRequest();
  const url = new URL(request.authorizationUrl);
  assert.equal(url.origin + url.pathname, 'https://vianaland.ir/oauth/continue');
  assert.equal(url.searchParams.get('scope'), 'openid profile student.self:read students.contact:read students.sensitive:read');
  assert.equal(url.searchParams.get('nonce'), request.nonce);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), crypto.createHash('sha256').update(request.codeVerifier).digest('base64url'));
});

test('code exchange uses client_secret_basic, never puts the secret in the form, and returns only an access token', async () => {
  const calls = [];
  const service = createVianaService({
    config,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return url === config.discoveryUrl ? json(discovery) : json({ access_token: 'opaque-token', token_type: 'Bearer', expires_in: 3600, scope: 'openid profile student.self:read students.contact:read students.sensitive:read' });
    }
  });
  assert.equal(await service.exchangeCode({ code: 'one-time-code', codeVerifier: 'verifier' }), 'opaque-token');
  const tokenCall = calls.at(-1);
  assert.equal(tokenCall.init.headers.Authorization, `Basic ${Buffer.from('production-client:server-only-secret').toString('base64')}`);
  assert.deepEqual(Object.fromEntries(tokenCall.init.body.entries()), { grant_type: 'authorization_code', code: 'one-time-code', redirect_uri: config.redirectUri, code_verifier: 'verifier' });
});

test('current student is read only through the user token and validates the approved fields', async () => {
  const calls = [];
  const service = createVianaService({
    config,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url === config.discoveryUrl) return json(discovery);
      return json({ success: true, data: student });
    }
  });
  assert.deepEqual(await service.fetchCurrentStudent('user-token'), { ...student, gender: null });
  assert.equal(calls.at(-1).url, config.studentSelfUrl);
  assert.equal(calls.at(-1).init.headers.Authorization, 'Bearer user-token');
  assert.throws(() => validateStudent({ ...student, points: 1.5 }), /points is invalid/);
});

test('userinfo retries one safe GET after rate limiting and exposes only the subject', async () => {
  let userInfoCalls = 0;
  const service = createVianaService({
    config, wait: async () => {},
    fetchImpl: async (url) => {
      if (url === config.discoveryUrl) return json(discovery);
      userInfoCalls += 1;
      return userInfoCalls === 1 ? json({ error: 'rate_limited' }, 429) : json({ sub: 'subject', name: 'ignored' });
    }
  });
  assert.deepEqual(await service.fetchUserInfo('user-token'), { sub: 'subject' });
  assert.equal(userInfoCalls, 2);
});

test('malformed discovery and network response content never leak into errors', async () => {
  const service = createVianaService({ config, fetchImpl: async () => new Response('<secret-token>', { status: 502 }) });
  await assert.rejects(service.generateAuthorizationRequest(), (error) => error.code === 'VIANA_RESPONSE_MALFORMED' && !error.message.includes('secret-token'));
});
