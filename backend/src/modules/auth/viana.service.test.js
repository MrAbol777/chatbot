const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const { loadVianaConfig } = require('./viana.config');
const { createVianaService } = require('./viana.service');

const discoveryUrl = 'https://vianaland.ir/.well-known/openid-configuration';
const baseConfig = {
  discoveryUrl,
  apiUrl: 'https://vianaland.ir/api/v1',
  clientId: 'development-client',
  clientSecret: 'server-only-secret',
  redirectUri: 'https://danoa.ir/api/auth/viana/callback',
  httpTimeoutMs: 1000
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function createFixture() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'viana-test-key'; jwk.use = 'sig'; jwk.alg = 'RS256';
  const discovery = {
    issuer: 'https://vianaland.ir',
    authorization_endpoint: 'https://vianaland.ir/oauth/continue',
    token_endpoint: 'https://vianaland.ir/api/v1/identity/token',
    userinfo_endpoint: 'https://vianaland.ir/api/v1/identity/userinfo',
    jwks_uri: 'https://vianaland.ir/api/v1/identity/jwks',
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic']
  };
  const sign = (claims) => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return `${header}.${payload}.${crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url')}`;
  };
  return { discovery, jwk, sign };
}

test('enabled production config requires Discovery and preserves Danoa callback', () => {
  const config = loadVianaConfig({
    NODE_ENV: 'production', VIANA_OAUTH_ENABLED: 'true', VIANA_ENVIRONMENT: 'production',
    VIANA_DISCOVERY_URL: discoveryUrl, VIANA_API_URL: 'https://vianaland.ir/api/v1',
    VIANA_CLIENT_ID: 'production-client', VIANA_CLIENT_SECRET: 'server-only-production-secret',
    VIANA_REDIRECT_URI: 'https://danoa.ir/api/auth/viana/callback', APP_ALLOWED_ORIGINS: 'https://danoa.ir'
  });
  assert.equal(config.discoveryUrl, discoveryUrl);
  assert.equal(config.redirectUri, 'https://danoa.ir/api/auth/viana/callback');
  assert.equal(config.httpTimeoutMs, 20_000);
  assert.deepEqual(config.allowedOrigins, ['https://danoa.ir']);
});

test('Confidential Web flow uses Discovery, PKCE + nonce, Basic token auth, JWKS, and student self', async () => {
  const fixture = createFixture(); const calls = []; let request;
  const now = () => new Date('2026-08-13T12:00:00Z');
  const service = createVianaService({ config: baseConfig, now, fetchImpl: async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (url === discoveryUrl) return json(fixture.discovery);
    if (url === fixture.discovery.token_endpoint) {
      const form = Object.fromEntries(init.body.entries());
      const token = fixture.sign({ iss: fixture.discovery.issuer, aud: baseConfig.clientId, nonce: request.nonce, exp: Math.floor(now().getTime() / 1000) + 300, iat: Math.floor(now().getTime() / 1000), sub: 'pairwise-subject' });
      return json({ access_token: 'opaque-user-token', id_token: token, token_type: 'Bearer', expires_in: 900, scope: 'openid profile student.self:read' });
    }
    if (url === fixture.discovery.jwks_uri) return json({ keys: [fixture.jwk] });
    if (url === 'https://vianaland.ir/api/v1/students/me') return json({ success: true, data: { id: 'pairwise-subject', firstName: 'دانش', lastName: 'آموز', dateOfBirth: '2010-01-01', grade: '8', gender: 'MALE' } });
    throw new Error(`unexpected URL ${url}`);
  }});
  request = await service.generateAuthorizationRequest();
  const authorization = new URL(request.authorizationUrl);
  assert.equal(authorization.origin + authorization.pathname, 'https://vianaland.ir/oauth/continue');
  assert.equal(authorization.searchParams.get('scope'), 'openid profile student.self:read');
  assert.equal(authorization.searchParams.get('nonce'), request.nonce);
  assert.match(request.codeVerifier, /^[A-Za-z0-9_-]{43,128}$/);
  const token = await service.exchangeCode({ code: 'single-use-code', codeVerifier: request.codeVerifier, nonce: request.nonce });
  assert.equal(token, 'opaque-user-token');
  const tokenCall = calls.find((call) => call.url === fixture.discovery.token_endpoint);
  assert.equal(tokenCall.init.headers.Authorization, `Basic ${Buffer.from(`${baseConfig.clientId}:${baseConfig.clientSecret}`).toString('base64')}`);
  assert.deepEqual(Object.fromEntries(tokenCall.init.body.entries()), { grant_type: 'authorization_code', code: 'single-use-code', redirect_uri: baseConfig.redirectUri, code_verifier: request.codeVerifier });
  assert.deepEqual(await service.fetchStudentSelf(token), { sub: 'pairwise-subject', firstName: 'دانش', lastName: 'آموز', dateOfBirth: '2010-01-01', grade: '8', gender: 'MALE' });
  await service.exchangeCode({ code: 'another-single-use-code', codeVerifier: request.codeVerifier, nonce: request.nonce });
  assert.equal(calls.filter((call) => call.url === fixture.discovery.jwks_uri).length, 1);
});

test('student self retries retryable upstream failures with bounded backoff', async () => {
  const waits = [];
  let attempts = 0;
  const service = createVianaService({
    config: baseConfig,
    wait: async (ms) => { waits.push(ms); },
    fetchImpl: async (url) => {
      assert.equal(url, 'https://vianaland.ir/api/v1/students/me');
      attempts += 1;
      if (attempts < 3) return json({ error: 'temporarily_unavailable' }, 502);
      return json({ data: { id: 'subject', firstName: 'دانش', lastName: 'آموز', dateOfBirth: '2010-01-01' } });
    }
  });

  const profile = await service.fetchStudentSelf('opaque-access-token');
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [400, 1000]);
  assert.equal(profile.sub, 'subject');
});

test('ID token with a wrong nonce is rejected before student data is requested', async () => {
  const fixture = createFixture(); const now = () => new Date('2026-08-13T12:00:00Z'); let studentCalled = false;
  const service = createVianaService({ config: baseConfig, now, fetchImpl: async (url) => {
    if (url === discoveryUrl) return json(fixture.discovery);
    if (url === fixture.discovery.token_endpoint) return json({ access_token: 'opaque', token_type: 'Bearer', id_token: fixture.sign({ iss: fixture.discovery.issuer, aud: baseConfig.clientId, nonce: 'wrong', exp: Math.floor(now().getTime() / 1000) + 60, iat: Math.floor(now().getTime() / 1000) }) });
    if (url === fixture.discovery.jwks_uri) return json({ keys: [fixture.jwk] });
    studentCalled = true; return json({});
  }});
  await assert.rejects(service.exchangeCode({ code: 'code', codeVerifier: 'verifier', nonce: 'expected' }), (error) => error.code === 'VIANA_ID_TOKEN_INVALID');
  assert.equal(studentCalled, false);
});
