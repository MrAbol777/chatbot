const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function getBearerToken(req) {
  const header = typeof req.headers?.authorization === 'string' ? req.headers.authorization : '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function splitOrigins(value) {
  return String(value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function getDefaultAllowedOrigins(env = process.env) {
  const isProduction = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
  const defaults = isProduction
    ? ['https://danoa.ir', 'https://www.danoa.ir']
    : [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:3000',
        'http://127.0.0.1:3000'
      ];
  return [...new Set([
    ...defaults,
    ...splitOrigins(env.CORS_ORIGIN),
    ...splitOrigins(env.APP_ALLOWED_ORIGINS)
  ])];
}

function csrfErrorForRequest({ req, session, sessionRepository, allowedOrigins }) {
  if (!session || !UNSAFE_METHODS.has(String(req.method || '').toUpperCase())) return null;
  const origin = typeof req.headers?.origin === 'string' ? req.headers.origin.trim() : '';
  const allowlist = allowedOrigins instanceof Set ? allowedOrigins : new Set(allowedOrigins || []);
  if (!origin || !allowlist.has(origin)) return 'CSRF_ORIGIN_REJECTED';
  const csrfToken = typeof req.headers?.['x-csrf-token'] === 'string'
    ? req.headers['x-csrf-token'].trim()
    : '';
  if (!sessionRepository.validateCsrf(session, csrfToken)) return 'CSRF_TOKEN_INVALID';
  return null;
}

function createPrincipalResolver({
  jwt,
  jwtSecret,
  usersRepository,
  sessionRepository,
  sessionCookieName,
  allowedOrigins = getDefaultAllowedOrigins(process.env)
}) {
  const csrfAllowedOrigins = new Set(allowedOrigins || []);

  const resolveBearer = async (rawToken) => {
    if (!rawToken) return null;
    try {
      const payload = jwt.verify(rawToken, jwtSecret);
      const userId = String(payload?.sub || '').trim();
      if (!userId) return null;
      const user = await usersRepository.findUserById(userId);
      if (!user || user.is_banned) return null;
      return {
        userId,
        provider: 'otp',
        profile: {
          id: userId,
          name: user.name,
          age: Number(user.age || 0),
          ...(user.phone ? { phone: user.phone } : {})
        }
      };
    } catch {
      return null;
    }
  };

  const resolveBase = async (req, { touchSession = true } = {}) => {
    if (req.authResolution) return req.authResolution;
    const rawBearer = getBearerToken(req);
    const rawSession = String(req.cookies?.[sessionCookieName] || '').trim();
    const [bearer, session] = await Promise.all([
      resolveBearer(rawBearer),
      sessionRepository.resolve(rawSession, { touch: touchSession })
    ]);

    let error = null;
    if (rawBearer && !bearer) error = 'INVALID_BEARER_CREDENTIAL';
    if (rawSession && !session) error = error || 'INVALID_SESSION_CREDENTIAL';
    if (bearer && session && bearer.userId !== session.userId) error = 'AUTHENTICATION_AMBIGUITY';

    const selected = session || bearer;
    const result = {
      error,
      supplied: { bearer: Boolean(rawBearer), session: Boolean(rawSession) },
      rawSession,
      bearer,
      session,
      principal: selected
        ? {
            userId: selected.userId,
            provider: selected.provider,
            profile: selected.profile,
            authMethods: [session ? 'session' : null, bearer ? 'bearer' : null].filter(Boolean)
          }
        : null
    };
    req.authResolution = result;
    if (result.principal && !result.error) {
      req.user = { id: result.principal.userId };
      req.authPrincipal = result.principal;
    }
    return result;
  };

  const resolve = async (req, { touchSession = true, enforceCsrf = true } = {}) => {
    const base = await resolveBase(req, { touchSession });
    if (!enforceCsrf || base.error || !base.supplied.session || !base.session) {
      return { ...base, statusCode: base.error ? 401 : 200 };
    }
    const csrfError = csrfErrorForRequest({
      req,
      session: base.session,
      sessionRepository,
      allowedOrigins: csrfAllowedOrigins
    });
    if (!csrfError) return { ...base, statusCode: 200 };
    return { ...base, error: csrfError, statusCode: 403 };
  };

  return {
    resolve,
    csrfAllowedOrigins: () => [...csrfAllowedOrigins]
  };
}

function createRequirePrincipal(principalResolver) {
  return async (req, res, next) => {
    try {
      const resolution = await principalResolver.resolve(req);
      if (resolution.error) {
        return res.status(resolution.statusCode || 401).json({ success: false, error: resolution.error });
      }
      if (!resolution.principal) {
        return res.status(401).json({
          success: false,
          error: 'AUTHENTICATION_REQUIRED',
          message: 'برای استفاده از این بخش وارد حساب کاربری شوید.'
        });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

function createCookieCsrfProtection({
  principalResolver,
  sessionRepository,
  allowedOrigins,
  shouldProtectRequest = () => true
}) {
  const allowlist = new Set(allowedOrigins);
  return async (req, res, next) => {
    if (!UNSAFE_METHODS.has(String(req.method || '').toUpperCase())) return next();
    if (!shouldProtectRequest(req)) return next();
    try {
      const resolution = await principalResolver.resolve(req, { enforceCsrf: false });
      if (!resolution.supplied.session) return next();
      if (resolution.error) return res.status(401).json({ error: resolution.error });
      if (!resolution.session) return res.status(401).json({ error: 'INVALID_SESSION_CREDENTIAL' });

      const csrfError = csrfErrorForRequest({
        req,
        session: resolution.session,
        sessionRepository,
        allowedOrigins: allowlist
      });
      if (csrfError) return res.status(403).json({ error: csrfError });
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  UNSAFE_METHODS,
  createCookieCsrfProtection,
  createPrincipalResolver,
  createRequirePrincipal,
  csrfErrorForRequest,
  getBearerToken,
  getDefaultAllowedOrigins
};
