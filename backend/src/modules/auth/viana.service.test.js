const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const { loadVianaConfig } = require('./viana.config');
const {
  createVianaService,
  validateUserInfo
} = require('./viana.service');

const baseConfig = {
  authorizationUrl: 'http://localhost:3000/oauth/continue',
  tokenUrl: 'http://localhost:3001/api/v1/oauth/token',
  userInfoUrl: 'http://localhost:3001/api/v1/oauth/userinfo',
  clientId: 'development-client',
  clientSecret: 'server-only-secret',
  redirectUri: 'http://localhost:5173/api/auth/viana/callback',
  httpTimeoutMs: 1000
};

const validUserInfo = {
  sub: 'stable-subject',
  firstName: 'دانش‌آموز',
  lastName: '<img src=x onerror=alert(1)>',
  dateOfBirth: '2010-01-01',
  grade: null,
  gender: null
};

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });

test('disabled config exposes no derived credentials and uses safe development defaults', () => {
  const config = loadVianaConfig({ NODE_ENV: 'development', VIANA_OAUTH_ENABLED: 'false' });
  assert.equal(config.enabled, false);
  assert.deepEqual(config.allowedOrigins, ['http://localhost:5173']);
  assert.equal(config.sessionIdleTimeoutSeconds, 86400);
  assert.equal(config.sessionAbsoluteTimeoutSeconds, 2592000);
  assert.equal(config.authorizationUrl, undefined);
});

test('enabled config fails fast when required server-side values are missing', () => {
  assert.throws(
    () => loadVianaConfig({ NODE_ENV: 'production', VIANA_OAUTH_ENABLED: 'true' }),
    /required values are missing/
  );
});

test('production config derives the exact public Viana endpoints and Danoa callback', () => {
  const config = loadVianaConfig({
    NODE_ENV: 'production',
    VIANA_OAUTH_ENABLED: 'true',
    VIANA_ENVIRONMENT: 'production',
    VIANA_FRONTEND_URL: 'https://vianaland.ir',
    VIANA_API_URL: 'https://vianaland.ir/api/v1',
    VIANA_CLIENT_ID: 'production-client',
    VIANA_CLIENT_SECRET: 'server-only-production-secret',
    VIANA_REDIRECT_URI: 'https://danoa.ir/api/auth/viana/callback',
    VIANA_POST_LOGIN_PATH: '/',
    APP_ALLOWED_ORIGINS: 'https://danoa.ir'
  });
  assert.equal(config.authorizationUrl, 'https://vianaland.ir/oauth/continue');
  assert.equal(config.tokenUrl, 'https://vianaland.ir/api/v1/oauth/token');
  assert.equal(config.userInfoUrl, 'https://vianaland.ir/api/v1/oauth/userinfo');
  assert.equal(config.redirectUri, 'https://danoa.ir/api/auth/viana/callback');
  assert.deepEqual(config.allowedOrigins, ['https://danoa.ir']);
  const authorization = new URL(
    createVianaService({ config }).generateAuthorizationRequest().authorizationUrl
  );
  assert.equal(authorization.origin + authorization.pathname, 'https://vianaland.ir/oauth/continue');
  assert.equal(
    authorization.searchParams.get('redirect_uri'),
    'https://danoa.ir/api/auth/viana/callback'
  );
  assert.equal(authorization.searchParams.get('scope'), 'profile');
});

test('production rejects an HTTP Viana base URL even with an HTTPS callback', () => {
  assert.throws(
    () =>
      loadVianaConfig({
        NODE_ENV: 'production',
        VIANA_OAUTH_ENABLED: 'true',
        VIANA_ENVIRONMENT: 'production',
        VIANA_FRONTEND_URL: 'http://localhost:3000',
        VIANA_API_URL: 'https://vianaland.ir/api/v1',
        VIANA_CLIENT_ID: 'production-client',
        VIANA_CLIENT_SECRET: 'server-only-production-secret',
        VIANA_REDIRECT_URI: 'https://danoa.ir/api/auth/viana/callback'
      }),
    /must use HTTPS in production/
  );
});

test('authorization request has exactly seven OAuth parameters and valid S256 PKCE', () => {
  const service = createVianaService({ config: baseConfig });
  const request = service.generateAuthorizationRequest();
  const url = new URL(request.authorizationUrl);
  assert.equal(url.origin + url.pathname, baseConfig.authorizationUrl);
  assert.deepEqual(
    [...url.searchParams.keys()].sort(),
    [
      'client_id',
      'code_challenge',
      'code_challenge_method',
      'redirect_uri',
      'response_type',
      'scope',
      'state'
    ]
  );
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), baseConfig.clientId);
  assert.equal(url.searchParams.get('redirect_uri'), baseConfig.redirectUri);
  assert.equal(url.searchParams.get('state'), request.state);
  assert.equal(url.searchParams.get('scope'), 'profile');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(
    url.searchParams.get('code_challenge'),
    crypto.createHash('sha256').update(request.codeVerifier).digest('base64url')
  );
  assert.match(request.codeVerifier, /^[A-Za-z0-9_-]{43,128}$/);
});

test('token exchange uses the documented form body and never retries a code', async () => {
  const calls = [];
  const service = createVianaService({
    config: baseConfig,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ error: 'temporarily_unavailable' }, 503);
    }
  });
  await assert.rejects(
    service.exchangeCode({ code: 'one-time-code', codeVerifier: 'verifier' }),
    (error) => error.code === 'VIANA_TOKEN_FAILED' && error.retryable
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, baseConfig.tokenUrl);
  assert.equal(calls[0].init.method, 'POST');
  const form = calls[0].init.body;
  assert.deepEqual(Object.fromEntries(form.entries()), {
    grant_type: 'authorization_code',
    client_id: baseConfig.clientId,
    client_secret: baseConfig.clientSecret,
    code: 'one-time-code',
    redirect_uri: baseConfig.redirectUri,
    code_verifier: 'verifier'
  });
});

test('token exchange maps 429, invalid client, callback/PKCE mismatch, and timeout without retry', async () => {
  const cases = [
    { status: 429, body: { error: 'rate_limited' }, expected: 'VIANA_TOKEN_FAILED' },
    { status: 401, body: { error: 'invalid_client' }, expected: 'VIANA_TOKEN_FAILED' },
    { status: 400, body: { error: 'invalid_grant' }, expected: 'VIANA_TOKEN_FAILED' }
  ];
  for (const item of cases) {
    let calls = 0;
    const service = createVianaService({
      config: baseConfig,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse(item.body, item.status);
      }
    });
    await assert.rejects(
      service.exchangeCode({ code: 'single-use-code', codeVerifier: 'verifier' }),
      (error) => error.code === item.expected && error.oauthError === item.body.error
    );
    assert.equal(calls, 1);
  }

  let timeoutCalls = 0;
  const timeoutService = createVianaService({
    config: baseConfig,
    fetchImpl: async () => {
      timeoutCalls += 1;
      const error = new Error('secret transport details');
      error.name = 'AbortError';
      throw error;
    }
  });
  await assert.rejects(
    timeoutService.exchangeCode({ code: 'single-use-code', codeVerifier: 'verifier' }),
    (error) => error.code === 'VIANA_TIMEOUT' && !error.message.includes('secret transport details')
  );
  assert.equal(timeoutCalls, 1);
});

test('successful token exchange returns only the opaque access-token value', async () => {
  const service = createVianaService({
    config: baseConfig,
    fetchImpl: async () =>
      jsonResponse({
        access_token: 'opaque-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'profile'
      })
  });
  assert.equal(
    await service.exchangeCode({ code: 'one-time-code', codeVerifier: 'verifier' }),
    'opaque-token'
  );
});

test('UserInfo retries one safe GET after 429 and validates nullable fields', async () => {
  let calls = 0;
  const service = createVianaService({
    config: baseConfig,
    wait: async () => {},
    fetchImpl: async (_url, init) => {
      calls += 1;
      assert.equal(init.method, 'GET');
      assert.equal(init.headers.Authorization, 'Bearer opaque-token');
      return calls === 1 ? jsonResponse({ error: 'rate_limited' }, 429) : jsonResponse(validUserInfo);
    }
  });
  assert.deepEqual(await service.fetchUserInfo('opaque-token'), validUserInfo);
  assert.equal(calls, 2);
});

test('UserInfo rejects extra keys, malformed dates, and invalid nullable types', () => {
  assert.throws(
    () => validateUserInfo({ ...validUserInfo, unexpected: true }),
    /unexpected response shape/
  );
  assert.throws(
    () => validateUserInfo({ ...validUserInfo, dateOfBirth: '2010-02-30' }),
    /calendar date/
  );
  assert.throws(
    () => validateUserInfo({ ...validUserInfo, grade: 10 }),
    /grade is invalid/
  );
  assert.throws(
    () => validateUserInfo({ ...validUserInfo, gender: 'OTHER' }),
    /gender is invalid/
  );
});

test('UserInfo malformed JSON and 5xx responses are reported without response contents', async () => {
  const malformed = createVianaService({
    config: baseConfig,
    fetchImpl: async () => new Response('<secret-token>', { status: 502 })
  });
  await assert.rejects(
    malformed.fetchUserInfo('opaque-token'),
    (error) => error.code === 'VIANA_RESPONSE_MALFORMED' && !error.message.includes('secret-token')
  );
});
