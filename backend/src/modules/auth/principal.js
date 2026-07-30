const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function getBearerToken(req) {
  const header = typeof req.headers?.authorization === 'string' ? req.headers.authorization : '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function createPrincipalResolver({ jwt, jwtSecret, usersRepository, sessionRepository, sessionCookieName }) {
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

  const resolve = async (req, { touchSession = true } = {}) => {
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

  return { resolve };
}

function createRequirePrincipal(principalResolver) {
  return async (req, res, next) => {
    try {
      const resolution = await principalResolver.resolve(req);
      if (resolution.error) {
        return res.status(401).json({ success: false, error: resolution.error });
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
      const resolution = await principalResolver.resolve(req);
      if (!resolution.supplied.session) return next();
      if (resolution.error) return res.status(401).json({ error: resolution.error });
      if (!resolution.session) return res.status(401).json({ error: 'INVALID_SESSION_CREDENTIAL' });

      const origin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
      if (!origin || !allowlist.has(origin)) {
        return res.status(403).json({ error: 'CSRF_ORIGIN_REJECTED' });
      }
      const csrfToken = typeof req.headers['x-csrf-token'] === 'string' ? req.headers['x-csrf-token'].trim() : '';
      if (!sessionRepository.validateCsrf(resolution.session, csrfToken)) {
        return res.status(403).json({ error: 'CSRF_TOKEN_INVALID' });
      }
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
  getBearerToken
};
