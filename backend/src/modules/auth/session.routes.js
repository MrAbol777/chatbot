const express = require('express');
const jwt = require('jsonwebtoken');
const { noStore } = require('./viana.routes');

function createSessionRouter({ config, principalResolver, sessionRepository, jwtSecret }) {
  const router = express.Router();
  const secure = process.env.NODE_ENV === 'production';
  const clearSessionCookie = (res) =>
    res.clearCookie(config.sessionCookieName, { httpOnly: true, secure, sameSite: 'lax', path: '/api' });
  const consumeNotice = (req, res) => {
    const raw = String(req.cookies?.[config.noticeCookieName] || '');
    res.clearCookie(config.noticeCookieName, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/api/auth/session'
    });
    if (!raw) return null;
    try {
      const payload = jwt.verify(raw, jwtSecret);
      return payload?.purpose === 'viana-auth-notice' && typeof payload?.status === 'string' ? payload.status : null;
    } catch {
      return null;
    }
  };

  router.get('/api/auth/session', async (req, res, next) => {
    noStore(res);
    try {
      const authNotice = consumeNotice(req, res);
      const resolution = await principalResolver.resolve(req);
      if (resolution.error) {
        if (resolution.error === 'INVALID_SESSION_CREDENTIAL') clearSessionCookie(res);
        return res.status(resolution.statusCode || 401).json({ authenticated: false, error: resolution.error, ...(authNotice ? { authNotice } : {}) });
      }
      if (!resolution.principal) {
        return res.json({ authenticated: false, ...(authNotice ? { authNotice } : {}) });
      }
      return res.json({
        authenticated: true,
        provider: resolution.principal.provider,
        authMethods: resolution.principal.authMethods,
        userId: resolution.principal.userId,
        profile: resolution.principal.profile,
        ...(resolution.session ? { csrfToken: resolution.session.csrfToken } : {}),
        ...(authNotice ? { authNotice } : {})
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/api/auth/logout', async (req, res, next) => {
    noStore(res);
    try {
      const resolution = await principalResolver.resolve(req);
      if (resolution.error) {
        return res.status(resolution.statusCode || 401).json({ error: resolution.error });
      }
      const rawSession = String(req.cookies?.[config.sessionCookieName] || '');
      const cookieSessionRevoked = await sessionRepository.revoke(rawSession);
      clearSessionCookie(res);
      return res.json({
        cookieSessionRevoked,
        bearerRevoked: false,
        vianaGlobalLogout: false
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createSessionRouter };
