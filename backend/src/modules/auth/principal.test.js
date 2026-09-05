const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  createCookieCsrfProtection,
  createPrincipalResolver
} = require('./principal');

const users = new Map([
  ['otp-user', { user_id: 'otp-user', name: 'OTP', age: 16, phone: '09120000000', is_banned: 0 }],
  ['shared-user', { user_id: 'shared-user', name: 'Shared', age: 15, phone: '09121111111', is_banned: 0 }]
]);

const createResolver = () =>
  createPrincipalResolver({
    jwt: {
      verify(token) {
        if (token === 'otp-token') return { sub: 'otp-user' };
        if (token === 'shared-token') return { sub: 'shared-user' };
        throw new Error('invalid');
      }
    },
    jwtSecret: 'test-secret',
    usersRepository: {
      findUserById: async (id) => users.get(id) || null
    },
    sessionRepository: {
      resolve: async (token) => {
        if (token === 'viana-token') {
          return {
            userId: 'viana-user',
            provider: 'viana',
            csrfTokenHash: 'csrf-hash',
            profile: { id: 'viana-user', name: 'Viana', age: 14 }
          };
        }
        if (token === 'shared-session') {
          return {
            userId: 'shared-user',
            provider: 'viana',
            csrfTokenHash: 'csrf-hash',
            profile: { id: 'shared-user', name: 'Shared', age: 15 }
          };
        }
        return null;
      },
      validateCsrf: (_session, token) => token === 'stable-csrf'
    },
    sessionCookieName: 'danoa_auth_session',
    allowedOrigins: ['http://localhost:5173']
  });

const request = ({ bearer = '', session = '', method = 'GET', origin = '', csrf = '', path = '/api/chat' } = {}) => ({
  method,
  path,
  headers: {
    ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    ...(origin ? { origin } : {}),
    ...(csrf ? { 'x-csrf-token': csrf } : {})
  },
  cookies: session ? { danoa_auth_session: session } : {}
});

test('valid cookie and Bearer for different users are rejected as ambiguous', async () => {
  const result = await createResolver().resolve(request({ bearer: 'otp-token', session: 'viana-token' }));
  assert.equal(result.error, 'AUTHENTICATION_AMBIGUITY');
  assert.equal(result.principal.userId, 'viana-user');
});

test('valid cookie and Bearer for the same user are accepted with both auth methods', async () => {
  const result = await createResolver().resolve(request({ bearer: 'shared-token', session: 'shared-session' }));
  assert.equal(result.error, null);
  assert.equal(result.principal.userId, 'shared-user');
  assert.deepEqual(result.principal.authMethods, ['session', 'bearer']);
});

test('an invalid supplied credential is not ignored beside a valid credential', async () => {
  const invalidBearer = await createResolver().resolve(request({ bearer: 'bad', session: 'viana-token' }));
  assert.equal(invalidBearer.error, 'INVALID_BEARER_CREDENTIAL');
  const invalidCookie = await createResolver().resolve(request({ bearer: 'otp-token', session: 'bad' }));
  assert.equal(invalidCookie.error, 'INVALID_SESSION_CREDENTIAL');
});

test('principal resolver enforces CSRF on session-authenticated mutations', async () => {
  const resolver = createResolver();
  const missingOrigin = await resolver.resolve(request({
    session: 'viana-token',
    method: 'POST',
    csrf: 'stable-csrf'
  }));
  assert.equal(missingOrigin.error, 'CSRF_ORIGIN_REJECTED');
  assert.equal(missingOrigin.statusCode, 403);

  const accepted = await resolver.resolve(request({
    session: 'viana-token',
    method: 'POST',
    origin: 'http://localhost:5173',
    csrf: 'stable-csrf'
  }));
  assert.equal(accepted.error, null);
  assert.equal(accepted.statusCode, 200);
});

test('Bearer-only mutations stay exempt from CSRF in the principal resolver', async () => {
  const result = await createResolver().resolve(request({ bearer: 'otp-token', method: 'POST' }));
  assert.equal(result.error, null);
  assert.equal(result.principal.userId, 'otp-user');
});

test('cookie-authenticated mutations require exact Origin and stable CSRF token', async () => {
  const resolver = createResolver();
  const middleware = createCookieCsrfProtection({
    principalResolver: resolver,
    sessionRepository: {
      validateCsrf: (_session, token) => token === 'stable-csrf'
    },
    allowedOrigins: ['http://localhost:5173']
  });
  const invoke = async (req) => {
    const output = { statusCode: 200, body: null, next: false };
    const res = {
      status(code) {
        output.statusCode = code;
        return this;
      },
      json(body) {
        output.body = body;
        return this;
      }
    };
    await middleware(req, res, () => {
      output.next = true;
    });
    return output;
  };

  const missingOrigin = await invoke(request({ session: 'viana-token', method: 'POST', csrf: 'stable-csrf' }));
  assert.equal(missingOrigin.statusCode, 403);
  assert.equal(missingOrigin.body.error, 'CSRF_ORIGIN_REJECTED');

  const badToken = await invoke(request({
    session: 'viana-token',
    method: 'POST',
    origin: 'http://localhost:5173',
    csrf: 'wrong'
  }));
  assert.equal(badToken.statusCode, 403);
  assert.equal(badToken.body.error, 'CSRF_TOKEN_INVALID');

  const accepted = await invoke(request({
    session: 'viana-token',
    method: 'POST',
    origin: 'http://localhost:5173',
    csrf: 'stable-csrf'
  }));
  assert.equal(accepted.next, true);
});

test('Bearer-only mutation is exempt from CSRF and public OTP routes can be excluded', async () => {
  const middleware = createCookieCsrfProtection({
    principalResolver: createResolver(),
    sessionRepository: { validateCsrf: () => false },
    allowedOrigins: ['http://localhost:5173'],
    shouldProtectRequest: (req) => req.path === '/api/chat'
  });
  let continued = false;
  await middleware(request({ bearer: 'otp-token', method: 'POST' }), {}, () => {
    continued = true;
  });
  assert.equal(continued, true);

  continued = false;
  await middleware(request({ session: 'viana-token', method: 'POST', path: '/api/auth/phone-status' }), {}, () => {
    continued = true;
  });
  assert.equal(continued, true);
});
