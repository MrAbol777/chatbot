const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { test } = require('node:test');
const express = require('express');

const { createAuthModule } = require('./auth.module');
const { createLocalDevelopmentRouter } = require('./local-development.routes');
const { createSessionRouter } = require('./session.routes');
const { createVianaRouter } = require('./viana.routes');

const vianaConfig = {
  enabled: false,
  environmentKey: 'test',
  providerLabel: 'Viana',
  clientId: 'test-client',
  postLoginPath: '/',
  sessionAbsoluteTimeoutSeconds: 3600,
  sessionCookieName: 'danoa_auth_session',
  flowCookieName: 'danoa_viana_flow',
  noticeCookieName: 'danoa_viana_notice'
};

async function withServer(app, run) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function request(baseUrl, method, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual'
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // The status assertion is the contract for endpoints with no response body.
  }
  return { response, json };
}

function createContractApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.cookies = {};
    next();
  });

  const authModule = createAuthModule({
    authRepository: {
      findUserByPhone: async () => null,
      checkAndRecordOtpRequest: async () => ({ allowed: true }),
      saveOtp: async () => ({ expiresIn: 120 }),
      verifyOtp: async () => ({ valid: false, reason: 'not_found' })
    },
    smsService: { generateOtp: () => '12345', sendVerificationCode: async () => ({ success: true }) },
    jwt: { sign: () => 'test-token', verify: () => ({}) },
    jwtSecret: 'test-secret',
    errorsRepository: { logError: async () => {} },
    logger: { log() {}, warn() {}, error() {} }
  });

  // Production-compatible root mount: auth.routes contains absolute public paths.
  app.use(authModule.router);
  app.use(createLocalDevelopmentRouter({
    enabled: true,
    usersRepository: { ensureUserExists: async () => 'local-user' },
    noaBillingService: { credit: async () => {} },
    jwt: { sign: () => 'local-development-token' },
    jwtSecret: 'test-secret',
    logger: { error() {} }
  }));
  app.use(createSessionRouter({
    config: vianaConfig,
    principalResolver: { resolve: async () => ({ principal: null }) },
    sessionRepository: { revoke: async () => false },
    jwtSecret: 'test-secret'
  }));
  app.use(createVianaRouter({
    config: vianaConfig,
    vianaService: {},
    vianaRepository: {},
    sessionRepository: {},
    jwtSecret: 'test-secret',
    logger: { error() {} }
  }));
  return app;
}

test('auth routers preserve the frontend public API contract without a double prefix', async () => {
  await withServer(createContractApp(), async (baseUrl) => {
    const invalidOtp = await request(baseUrl, 'POST', '/api/send-verification-code', {});
    assert.equal(invalidOtp.response.status, 400);
    assert.notEqual(invalidOtp.response.status, 404);

    for (const pathname of ['/api/auth/phone-status', '/api/verify-code', '/api/register-profile']) {
      const result = await request(baseUrl, 'POST', pathname, {});
      assert.equal(result.response.status, 400, `${pathname} must reach its handler`);
    }

    const session = await request(baseUrl, 'GET', '/api/auth/session');
    assert.equal(session.response.status, 200);
    assert.equal(session.json.authenticated, false);

    const logout = await request(baseUrl, 'POST', '/api/auth/logout');
    assert.equal(logout.response.status, 200);

    const vianaConfigResponse = await request(baseUrl, 'GET', '/api/auth/viana/config');
    assert.equal(vianaConfigResponse.response.status, 200);
    assert.equal(vianaConfigResponse.json.enabled, false);

    const vianaStart = await request(baseUrl, 'GET', '/api/auth/viana/start');
    assert.equal(vianaStart.response.status, 404);
    assert.equal(vianaStart.json.error, 'VIANA_SIGNIN_DISABLED');

    const vianaCallback = await request(baseUrl, 'GET', '/api/auth/viana/callback');
    assert.equal(vianaCallback.response.status, 303);

    const localSession = await request(baseUrl, 'POST', '/api/auth/local-session');
    assert.equal(localSession.response.status, 200);
    assert.equal(localSession.json.success, true);
  });
});

test('application composition mounts complete auth routes at root exactly once', () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, '../../app.js'), 'utf8');
  assert.match(appSource, /app\.use\(authModule\.router\);/);
  assert.doesNotMatch(appSource, /app\.use\('\/api\/auth', authModule\.router\);/);
  assert.match(appSource, /app\.use\(createLocalDevelopmentRouter\(\{/);
  assert.doesNotMatch(appSource, /app\.use\('\/api\/auth\/local', createLocalDevelopmentRouter/);
});
