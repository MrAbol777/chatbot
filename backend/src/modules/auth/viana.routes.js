const express = require('express');
const jwt = require('jsonwebtoken');
const { randomToken } = require('./session.repository');

const noStore = (res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
};

function createVianaRouter({
  config,
  vianaService,
  vianaRepository,
  sessionRepository,
  jwtSecret,
  logger = console
}) {
  const router = express.Router();
  const secure = process.env.NODE_ENV === 'production';
  let flowCookieDomain = '';
  if (secure && config.redirectUri) {
    try {
      flowCookieDomain = new URL(config.redirectUri).hostname;
    } catch {
      // Runtime config validates this URL before the router is created.
    }
  }
  const sessionCookie = {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/api',
    maxAge: config.sessionAbsoluteTimeoutSeconds * 1000
  };
  const flowCookie = {
    httpOnly: true,
    secure,
    // Viana returns from a different site. Some mobile in-app browsers do not
    // treat that callback as a top-level Lax navigation, so preserve the
    // browser binding cookie explicitly for the OAuth callback only.
    sameSite: secure ? 'none' : 'lax',
    path: '/api/auth/viana',
    maxAge: 10 * 60 * 1000,
    ...(flowCookieDomain ? { domain: flowCookieDomain } : {})
  };
  const noticeCookie = {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/api/auth/session',
    maxAge: 5 * 60 * 1000
  };

  const setNotice = (res, status) => {
    const token = jwt.sign({ purpose: 'viana-auth-notice', status }, jwtSecret, { expiresIn: '5m' });
    res.cookie(config.noticeCookieName, token, noticeCookie);
  };

  router.get('/api/auth/viana/config', (_req, res) => {
    noStore(res);
    return res.json({ enabled: config.enabled, providerLabel: config.providerLabel });
  });

  router.get('/api/auth/viana/start', async (req, res, next) => {
    noStore(res);
    if (!config.enabled) return res.status(404).json({ error: 'VIANA_SIGNIN_DISABLED' });
    const startedAt = Date.now();
    try {
      const browserBinding =
        typeof req.cookies?.[config.flowCookieName] === 'string' &&
        /^[A-Za-z0-9_-]{32,128}$/.test(req.cookies[config.flowCookieName])
          ? req.cookies[config.flowCookieName]
          : randomToken();
      res.cookie(config.flowCookieName, browserBinding, flowCookie);
      const authorization = await vianaService.generateAuthorizationRequest();
      await vianaRepository.saveFlow({
        state: authorization.state,
        browserBinding,
        codeVerifier: authorization.codeVerifier,
        nonce: authorization.nonce,
        environmentKey: config.environmentKey
      });
      return res.redirect(303, authorization.authorizationUrl);
    } catch (error) {
      logger.error?.('[VIANA] start failed', {
        requestId: res.locals.requestId,
        phase: 'start',
        status: error?.status || 500,
        code: error?.code || 'UNEXPECTED_ERROR',
        upstreamStatus: error?.upstreamStatus || null,
        oauthError: error?.oauthError || null,
        durationMs: Date.now() - startedAt
      });
      return next(error);
    }
  });

  router.get('/api/auth/viana/callback', async (req, res) => {
    noStore(res);
    const startedAt = Date.now();
    const redirectHome = () => res.redirect(303, config.postLoginPath);
    if (!config.enabled) {
      setNotice(res, 'disabled');
      return redirectHome();
    }

    const state = typeof req.query?.state === 'string' ? req.query.state : '';
    const browserBinding = String(req.cookies?.[config.flowCookieName] || '');
    let phase = 'state';
    try {
      const pending = await vianaRepository.consumeFlow({
        state,
        browserBinding,
        environmentKey: config.environmentKey
      });
      if (!pending.valid) {
        logger.warn?.('[VIANA] callback flow rejected', {
          requestId: res.locals.requestId,
          phase,
          reason: pending.reason || 'unknown',
          durationMs: Date.now() - startedAt
        });
        setNotice(res, 'invalid_or_expired');
        return redirectHome();
      }

      if (typeof req.query?.error === 'string') {
        setNotice(res, req.query.error === 'access_denied' ? 'denied' : 'failed');
        return redirectHome();
      }
      const code = typeof req.query?.code === 'string' ? req.query.code : '';
      if (!code) {
        setNotice(res, 'invalid_or_expired');
        return redirectHome();
      }

      phase = 'token';
      let accessToken = await vianaService.exchangeCode({ code, codeVerifier: pending.codeVerifier, nonce: pending.nonce });
      phase = 'student_self';
      const profile = await vianaService.fetchStudentSelf(accessToken);
      accessToken = undefined;

      phase = 'identity';
      const localProfile = vianaService.prepareLocalProfile(profile);
      const identity = await vianaRepository.findOrCreateIdentity({
        clientId: config.clientId,
        environmentKey: config.environmentKey,
        profile,
        ...localProfile
      });

      phase = 'session';
      const previousRawToken = String(req.cookies?.[config.sessionCookieName] || '');
      const session = await sessionRepository.create({
        userId: identity.userId,
        provider: 'viana',
        previousRawToken
      });
      res.cookie(config.sessionCookieName, session.rawToken, sessionCookie);
      setNotice(res, 'success');
      return redirectHome();
    } catch (error) {
      logger.error?.('[VIANA] callback failed', {
        requestId: res.locals.requestId,
        phase,
        status: error?.status || 500,
        code: error?.code || 'UNEXPECTED_ERROR',
        upstreamStatus: error?.upstreamStatus || null,
        oauthError: error?.oauthError || null,
        durationMs: Date.now() - startedAt
      });
      setNotice(res, error?.retryable ? 'temporary_error' : 'failed');
      return redirectHome();
    }
  });

  return router;
}

module.exports = { createVianaRouter, noStore };
