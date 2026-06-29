const {
  GUEST_MESSAGE_LIMIT,
  getGuestIdFromUserId,
  normalizeGuestId
} = require('../../repositories/GuestRepository');
const { generateUserId } = require('../../repositories/helpers');

const GUEST_COOKIE_NAME = 'danoa_guest_id';

const getRequestIp = (req) => {
  const forwarded = typeof req.headers?.['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : '';
  return (forwarded.split(',')[0] || req.ip || req.socket?.remoteAddress || '').trim().slice(0, 64);
};

const getBearerToken = (req) => {
  const authHeader = typeof req.headers?.authorization === 'string' ? req.headers.authorization : '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
};

const setGuestCookie = (res, guestId) => {
  res.cookie(GUEST_COOKIE_NAME, guestId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 365 * 24 * 60 * 60 * 1000
  });
};

function createAiController({ aiService, errorsRepository, guestsRepository, usersRepository, jwt, jwtSecret }) {
  const getAuthenticatedUserId = async (req) => {
    const token = getBearerToken(req);
    if (!token || !jwtSecret || !jwt || typeof jwt.verify !== 'function') {
      return { userId: '', tokenProvided: Boolean(token), invalid: Boolean(token) };
    }

    try {
      const payload = jwt.verify(token, jwtSecret);
      const userId = typeof payload?.sub === 'string' || typeof payload?.sub === 'number' ? String(payload.sub).trim() : '';
      if (!userId) {
        return { userId: '', tokenProvided: true, invalid: true };
      }

      if (usersRepository && typeof usersRepository.findUserById === 'function') {
        const user = await usersRepository.findUserById(userId);
        if (!user) {
          return { userId: '', tokenProvided: true, invalid: true };
        }
      }

      return { userId, tokenProvided: true, invalid: false };
    } catch (_error) {
      return { userId: '', tokenProvided: true, invalid: true };
    }
  };

  const postChat = async (req, res) => {
    let guestContext = null;

    try {
      const { message, profile, history, conversationId, imageIds } = req.body || {};
      const authContext = await getAuthenticatedUserId(req);
      if (authContext.invalid) {
        return res.status(401).json({ error: 'Invalid or expired token.' });
      }

      const authenticatedUserId = authContext.userId;
      const isGuest = !authenticatedUserId;
      let effectiveProfile = profile;

      if (authenticatedUserId) {
        effectiveProfile = {
          ...(profile && typeof profile === 'object' ? profile : {}),
          id: authenticatedUserId
        };
      }

      if (isGuest) {
        if (!guestsRepository) {
          return res.status(500).json({ error: 'GUEST_LIMIT_NOT_CONFIGURED' });
        }

        const cookieGuestId = normalizeGuestId(req.cookies?.[GUEST_COOKIE_NAME]);
        const guestId = cookieGuestId || getGuestIdFromUserId(generateUserId({ isGuest: true }));
        if (!cookieGuestId) {
          setGuestCookie(res, guestId);
        }

        const ipAddress = getRequestIp(req);
        const currentCount = await guestsRepository.getCurrentCount({ guestId, ipAddress });
        if (currentCount >= GUEST_MESSAGE_LIMIT) {
          return res.status(403).json({
            error: 'GUEST_LIMIT_REACHED',
            limit: GUEST_MESSAGE_LIMIT
          });
        }

        const guestUserId = await guestsRepository.ensureGuestUser(guestId);
        effectiveProfile = {
          ...(profile && typeof profile === 'object' ? profile : {}),
          id: guestUserId,
          name: 'مهمان',
          age: Number(profile?.age || 0) || 0,
          phone: undefined
        };
        guestContext = { guestId, ipAddress };
      }

      const result = await aiService.sendChatMessage({
        message,
        profile: effectiveProfile,
        history,
        conversationId,
        imageIds,
        requestId: res.locals.requestId
      });

      if (guestContext) {
        await guestsRepository.incrementCount(guestContext);
      }

      return res.json(result);
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'API_KEY_MISSING') {
        await errorsRepository.logError('api_key_missing', '/api/chat', 500, 'METIS_API_KEY is missing');
        return res.status(500).json({ error: 'کلید API تنظیم نشده است.' });
      }

      if (error && typeof error === 'object' && error.code === 'INVALID_MESSAGE') {
        return res.status(400).json({ error: 'پیام معتبر ارسال نشده است.' });
      }

      if (error && typeof error === 'object' && error.code === 'INVALID_IMAGE') {
        return res.status(400).json({ error: 'تصویر معتبر ارسال نشده است.' });
      }

      if (error && typeof error === 'object' && error.code === 'IMAGE_NOT_FOUND') {
        return res.status(404).json({ error: 'تصویر ارسال شده پیدا نشد. لطفاً دوباره آپلود کن.' });
      }

      if (error && typeof error === 'object' && error.code === 'UPSTREAM_TIMEOUT') {
        await errorsRepository.logError('openai_timeout', '/api/chat', 504, 'Upstream timeout reached');
        return res.status(504).json({ error: 'زمان پاسخ مدل طولانی شد. لطفاً دوباره تلاش کن.' });
      }

      if (error && typeof error === 'object' && error.code === 'UPSTREAM_FETCH_FAILED') {
        await errorsRepository.logError('openai_fetch_failed', '/api/chat', 502, JSON.stringify(error.details || {}));
        return res.status(502).json({
          error: 'ارتباط با سرویس مدل برقرار نشد.',
          details: 'اتصال شبکه، DNS یا METIS_OPENAI_BASE_URL را بررسی کنید.'
        });
      }

      if (error && typeof error === 'object' && error.code === 'UPSTREAM_REQUEST_FAILED') {
        const status = Number(error?.details?.status);
        const safeStatus = Number.isInteger(status) && status >= 400 ? status : 502;
        await errorsRepository.logError('openai_upstream_error', '/api/chat', safeStatus, JSON.stringify(error.details || {}));
        return res.status(safeStatus).json({
          error: 'خطا از سرویس مدل دریافت شد.',
          details: error?.details?.details || 'unknown_upstream_error'
        });
      }

      if (error && typeof error === 'object' && error.code === 'EMPTY_UPSTREAM_REPLY') {
        await errorsRepository.logError('invalid_upstream_response', '/api/chat', 502, JSON.stringify(error.details || {}));
        return res.status(502).json({ error: 'پاسخ نامعتبر از مدل دریافت شد.' });
      }

      await errorsRepository.logError('unknown', '/api/chat', null, error instanceof Error ? error.stack || error.message : 'unknown_error');

      return res.status(500).json({
        error: 'مشکلی در سرور پیش آمد.',
        details: error instanceof Error ? error.message : 'unknown_error'
      });
    }
  };

  return {
    postChat
  };
}

module.exports = { createAiController };
