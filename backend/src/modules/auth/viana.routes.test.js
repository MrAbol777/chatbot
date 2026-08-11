const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createVianaRouter } = require('./viana.routes');
const { createSessionRouter } = require('./session.routes');

const config = {
  enabled: true,
  environmentKey: 'development',
  providerLabel: 'Viana',
  clientId: 'development-client',
  postLoginPath: '/',
  sessionAbsoluteTimeoutSeconds: 2592000,
  sessionCookieName: 'danoa_auth_session',
  flowCookieName: 'danoa_viana_flow',
  noticeCookieName: 'danoa_viana_notice'
};

const routeHandler = (router, method, path) => {
  const layer = router.stack.find(
    (entry) => entry.route?.path === path && entry.route.methods?.[method.toLowerCase()]
  );
  assert.ok(layer, `missing ${method} ${path}`);
  return layer.route.stack.at(-1).handle;
};

const responseRecorder = () => {
  const output = {
    statusCode: 200,
    body: null,
    cookies: [],
    cleared: [],
    headers: {},
    redirect: null
  };
  return {
    output,
    locals: { requestId: 'safe-correlation-id' },
    setHeader(name, value) {
      output.headers[name.toLowerCase()] = value;
    },
    status(code) {
      output.statusCode = code;
      return this;
    },
    json(body) {
      output.body = body;
      return this;
    },
    cookie(name, value, options) {
      output.cookies.push({ name, value, options });
      return this;
    },
    clearCookie(name, options) {
      output.cleared.push({ name, options });
      return this;
    },
    redirect(code, location) {
      output.statusCode = code;
      output.redirect = location;
      return this;
    }
  };
};

const createRouter = (overrides = {}) =>
  createVianaRouter({
    config,
    jwtSecret: 'route-test-secret',
    logger: { error() {} },
    vianaService: {
      generateAuthorizationRequest: () => ({
        state: 'state-one',
        codeVerifier: 'verifier-one',
        authorizationUrl:
          'http://localhost:3000/oauth/continue?response_type=code&client_id=development-client&redirect_uri=http%3A%2F%2Flocalhost%3A5173%2Fapi%2Fauth%2Fviana%2Fcallback&state=state-one&code_challenge=challenge&code_challenge_method=S256&scope=profile'
      }),
      exchangeCode: async () => 'opaque-viana-access-token',
      fetchUserInfo: async () => ({
        sub: 'subject',
        firstName: 'First',
        lastName: 'Last',
        dateOfBirth: '2010-01-01',
        grade: null,
        gender: null
      }),
      prepareLocalProfile: () => ({ displayName: 'First Last', age: 16 })
    },
    vianaRepository: {
      saveFlow: async () => {},
      consumeFlow: async () => ({ valid: true, codeVerifier: 'verifier-one' }),
      findOrCreateIdentity: async () => ({ userId: 'local-user', isNewUser: true })
    },
    sessionRepository: {
      create: async () => ({ rawToken: 'local-session', csrfToken: 'csrf' })
    },
    ...overrides
  });

test('start persists browser-bound state and redirects with no-store without touching OTP Bearer', async () => {
  let saved = null;
  const router = createRouter({
    vianaRepository: {
      saveFlow: async (value) => {
        saved = value;
      },
      consumeFlow: async () => ({ valid: false }),
      findOrCreateIdentity: async () => {
        throw new Error('not called');
      }
    }
  });
  const handler = routeHandler(router, 'GET', '/api/auth/viana/start');
  const req = {
    cookies: {},
    headers: { authorization: 'Bearer existing-otp-token' },
    query: {}
  };
  const res = responseRecorder();
  await handler(req, res, assert.fail);

  assert.equal(res.output.statusCode, 303);
  assert.equal(new URL(res.output.redirect).pathname, '/oauth/continue');
  assert.equal(res.output.headers['cache-control'], 'no-store');
  assert.equal(saved.state, 'state-one');
  assert.equal(saved.codeVerifier, 'verifier-one');
  assert.equal(saved.environmentKey, 'development');
  assert.ok(saved.browserBinding);
  assert.equal(res.output.cleared.length, 0);
});

test('callback validates state before trusting an OAuth error and always redirects cleanly', async () => {
  let exchangeCalls = 0;
  const router = createRouter({
    vianaService: {
      exchangeCode: async () => {
        exchangeCalls += 1;
      }
    },
    vianaRepository: {
      consumeFlow: async () => ({ valid: false, reason: 'unknown_or_replayed' })
    }
  });
  const handler = routeHandler(router, 'GET', '/api/auth/viana/callback');
  const res = responseRecorder();
  await handler(
    {
      cookies: { danoa_viana_flow: 'binding' },
      query: { state: 'attacker-state', error: 'access_denied', code: 'must-not-run' }
    },
    res
  );
  assert.equal(exchangeCalls, 0);
  assert.equal(res.output.redirect, '/');
  assert.equal(res.output.statusCode, 303);
  assert.equal(res.output.headers['referrer-policy'], 'no-referrer');
  assert.ok(!res.output.redirect.includes('?'));
});

test('valid consent denial creates no session and does not clear an existing OTP credential', async () => {
  let sessionCreates = 0;
  const router = createRouter({
    sessionRepository: {
      create: async () => {
        sessionCreates += 1;
      }
    }
  });
  const handler = routeHandler(router, 'GET', '/api/auth/viana/callback');
  const res = responseRecorder();
  await handler(
    {
      cookies: { danoa_viana_flow: 'binding' },
      headers: { authorization: 'Bearer existing-otp-token' },
      query: { state: 'valid-state', error: 'access_denied' }
    },
    res
  );
  assert.equal(sessionCreates, 0);
  assert.equal(res.output.redirect, '/');
  assert.equal(res.output.cleared.length, 0);
});

test('successful callback maps identity, creates only a Danoa session, and never persists or returns access token', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const observed = { identity: null, session: null };
  const router = createRouter({
    vianaRepository: {
      consumeFlow: async () => ({ valid: true, codeVerifier: 'verifier-one' }),
      findOrCreateIdentity: async (value) => {
        observed.identity = value;
        return { userId: 'local-user', isNewUser: true };
      }
    },
    sessionRepository: {
      create: async (value) => {
        observed.session = value;
        return { rawToken: 'local-session', csrfToken: 'csrf' };
      }
    }
  });
  const handler = routeHandler(router, 'GET', '/api/auth/viana/callback');
  const res = responseRecorder();
  await handler(
    {
      cookies: { danoa_viana_flow: 'binding', danoa_auth_session: 'previous-session' },
      query: { state: 'valid-state', code: 'single-use-code' }
    },
    res
  );

  assert.equal(res.output.redirect, '/');
  assert.deepEqual(observed.session, {
    userId: 'local-user',
    provider: 'viana',
    previousRawToken: 'previous-session'
  });
  assert.equal(observed.identity.clientId, 'development-client');
  assert.equal(observed.identity.environmentKey, 'development');
  assert.equal(JSON.stringify(observed).includes('opaque-viana-access-token'), false);
  const sessionCookie = res.output.cookies.find((item) => item.name === 'danoa_auth_session');
  assert.equal(sessionCookie.value, 'local-session');
  assert.equal(sessionCookie.options.httpOnly, true);
  assert.equal(sessionCookie.options.secure, true);
  assert.equal(sessionCookie.options.sameSite, 'lax');
  assert.equal(sessionCookie.options.path, '/api');
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
});

test('local logout is idempotent and explicitly does not revoke Bearer or globally log out Viana', async () => {
  const router = createSessionRouter({
    config,
    jwtSecret: 'route-test-secret',
    principalResolver: { resolve: async () => ({ principal: null, error: null }) },
    sessionRepository: { revoke: async () => false }
  });
  const handler = routeHandler(router, 'POST', '/api/auth/logout');
  const res = responseRecorder();
  await handler({ cookies: {}, headers: {} }, res, assert.fail);
  assert.deepEqual(res.output.body, {
    cookieSessionRevoked: false,
    bearerRevoked: false,
    vianaGlobalLogout: false
  });
  assert.equal(res.output.cleared[0].name, 'danoa_auth_session');
});
