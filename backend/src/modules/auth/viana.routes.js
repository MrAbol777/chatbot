const express = require('express');
const jwt = require('jsonwebtoken');
const { normalizeGuestId } = require('../../repositories/GuestRepository');
const { randomToken } = require('./session.repository');

const noStore = (res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
};

function createVianaRouter({ config, vianaService, vianaRepository, sessionRepository, guestsRepository, authService, jwtSecret, logger = console }) {
  const router = express.Router();
  const secure = process.env.NODE_ENV === 'production';
  const sessionCookie = { httpOnly: true, secure, sameSite: 'lax', path: '/api', maxAge: config.sessionAbsoluteTimeoutSeconds * 1000 };
  const flowCookie = { httpOnly: true, secure, sameSite: 'lax', path: '/api/auth/viana', maxAge: 10 * 60 * 1000 };
  const linkCookie = { httpOnly: true, secure, sameSite: 'lax', path: '/api/auth/viana/link', maxAge: 10 * 60 * 1000 };
  const noticeCookie = { httpOnly: true, secure, sameSite: 'lax', path: '/api/auth/session', maxAge: 5 * 60 * 1000 };
  const clearLinkCookie = (res) => res.clearCookie(config.linkCookieName, { httpOnly: true, secure, sameSite: 'lax', path: '/api/auth/viana/link' });
  const setNotice = (res, status) => res.cookie(config.noticeCookieName, jwt.sign({ purpose: 'viana-auth-notice', status }, jwtSecret, { expiresIn: '5m' }), noticeCookie);
  const redirectHome = (res) => res.redirect(303, config.postLoginPath);
  const readPendingLink = async (req) => vianaRepository.getLinkRequest(String(req.cookies?.[config.linkCookieName] || ''));

  router.get('/api/auth/viana/config', (_req, res) => {
    noStore(res);
    return res.json({ enabled: config.enabled, providerLabel: config.providerLabel });
  });

  router.get('/api/auth/viana/start', async (req, res, next) => {
    noStore(res);
    if (!config.enabled) return res.status(404).json({ error: 'VIANA_SIGNIN_DISABLED' });
    try {
      const browserBinding = typeof req.cookies?.[config.flowCookieName] === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(req.cookies[config.flowCookieName]) ? req.cookies[config.flowCookieName] : randomToken();
      res.cookie(config.flowCookieName, browserBinding, flowCookie);
      const authorization = await vianaService.generateAuthorizationRequest();
      await vianaRepository.saveFlow({ state: authorization.state, browserBinding, codeVerifier: authorization.codeVerifier, nonce: authorization.nonce, environmentKey: config.environmentKey });
      return res.redirect(303, authorization.authorizationUrl);
    } catch (error) {
      logger.error?.('[VIANA] start failed', { requestId: res.locals.requestId, phase: 'start', status: error?.status || 500, code: error?.code || null });
      return next(error);
    }
  });

  router.get('/api/auth/viana/callback', async (req, res) => {
    noStore(res);
    if (!config.enabled) {
      setNotice(res, 'disabled');
      return redirectHome(res);
    }
    const state = typeof req.query?.state === 'string' ? req.query.state : '';
    const browserBinding = String(req.cookies?.[config.flowCookieName] || '');
    let phase = 'state';
    try {
      const pending = await vianaRepository.consumeFlow({ state, browserBinding, environmentKey: config.environmentKey });
      if (!pending.valid) {
        setNotice(res, 'invalid_or_expired');
        return redirectHome(res);
      }
      if (typeof req.query?.error === 'string') {
        setNotice(res, req.query.error === 'access_denied' ? 'denied' : 'failed');
        return redirectHome(res);
      }
      const code = typeof req.query?.code === 'string' ? req.query.code : '';
      if (!code) {
        setNotice(res, 'invalid_or_expired');
        return redirectHome(res);
      }
      phase = 'token';
      let accessToken = await vianaService.exchangeCode({ code, codeVerifier: pending.codeVerifier, nonce: pending.nonce });
      phase = 'userinfo';
      const userInfo = await vianaService.fetchUserInfo(accessToken);
      phase = 'student';
      const student = await vianaService.fetchCurrentStudent(accessToken);
      accessToken = undefined;
      const profile = { ...student, sub: userInfo.sub };
      const localProfile = vianaService.prepareLocalProfile(profile);
      phase = 'identity';
      const identity = await vianaRepository.resolveIdentity({ clientId: config.clientId, environmentKey: config.environmentKey, profile, ...localProfile });
      if (identity.kind === 'link_required') {
        const rawLinkToken = randomToken();
        await vianaRepository.createLinkRequest({ rawToken: rawLinkToken, clientId: config.clientId, environmentKey: config.environmentKey, profile, candidateUserId: identity.candidateUserId });
        res.cookie(config.linkCookieName, rawLinkToken, linkCookie);
        setNotice(res, 'link_confirmation_required');
        return redirectHome(res);
      }
      if (identity.kind === 'link_conflict') {
        setNotice(res, 'link_conflict');
        return redirectHome(res);
      }
      const guestId = normalizeGuestId(req.cookies?.danoa_guest_id);
      if (guestId) {
        await guestsRepository?.migrateGuestToUser?.({ guestId, userId: identity.userId });
        res.clearCookie('danoa_guest_id', { httpOnly: true, sameSite: 'lax', secure });
      }
      phase = 'session';
      const session = await sessionRepository.create({ userId: identity.userId, provider: 'viana', previousRawToken: String(req.cookies?.[config.sessionCookieName] || '') });
      res.cookie(config.sessionCookieName, session.rawToken, sessionCookie);
      setNotice(res, 'success');
      return redirectHome(res);
    } catch (error) {
      logger.error?.('[VIANA] callback failed', { requestId: res.locals.requestId, phase, status: error?.status || 500, code: error?.code || null });
      setNotice(res, error?.retryable ? 'temporary_error' : 'failed');
      return redirectHome(res);
    }
  });

  router.get('/api/auth/viana/link', async (req, res, next) => {
    noStore(res);
    try {
      return res.json({ pending: Boolean(config.enabled && await readPendingLink(req)) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/api/auth/viana/link/send-code', async (req, res, next) => {
    noStore(res);
    try {
      const pending = config.enabled ? await readPendingLink(req) : null;
      if (!pending?.phone || !authService) return res.status(410).json({ success: false, error: 'درخواست اتصال منقضی شده است. دوباره با ویانا وارد شوید.' });
      const result = await authService.sendVerificationCode({ phone: pending.phone, mode: 'viana_link' });
      if (result.statusCode === 429 && result.body?.retryAfterSeconds) res.setHeader('Retry-After', String(Math.ceil(result.body.retryAfterSeconds)));
      return res.status(result.statusCode).json(result.body);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/api/auth/viana/link/verify', async (req, res, next) => {
    noStore(res);
    try {
      const rawLinkToken = String(req.cookies?.[config.linkCookieName] || '');
      const pending = config.enabled ? await vianaRepository.getLinkRequest(rawLinkToken) : null;
      if (!pending?.phone || !authService) return res.status(410).json({ success: false, error: 'درخواست اتصال منقضی شده است. دوباره با ویانا وارد شوید.' });
      const verification = await authService.verifyExistingPhoneOwnership({ phone: pending.phone, code: req.body?.code, expectedUserId: pending.candidateUserId });
      if (!verification.body?.success) return res.status(verification.statusCode).json(verification.body);
      const linked = await vianaRepository.completeLinkRequest({ rawToken: rawLinkToken, environmentKey: config.environmentKey, clientId: config.clientId });
      if (!linked.valid) {
        clearLinkCookie(res);
        return res.status(409).json({ success: false, error: 'اتصال این حساب دیگر قابل انجام نیست. دوباره با ویانا وارد شوید.' });
      }
      const guestId = normalizeGuestId(req.cookies?.danoa_guest_id);
      if (guestId) {
        await guestsRepository?.migrateGuestToUser?.({ guestId, userId: linked.userId });
        res.clearCookie('danoa_guest_id', { httpOnly: true, sameSite: 'lax', secure });
      }
      const session = await sessionRepository.create({ userId: linked.userId, provider: 'viana', previousRawToken: String(req.cookies?.[config.sessionCookieName] || '') });
      res.cookie(config.sessionCookieName, session.rawToken, sessionCookie);
      clearLinkCookie(res);
      setNotice(res, 'success');
      return res.json({ success: true });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createVianaRouter, noStore };
