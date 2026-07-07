const {
  GUEST_MESSAGE_LIMIT,
  getGuestIdFromUserId,
  normalizeGuestId
} = require('../../repositories/GuestRepository');
const { generateUserId } = require('../../repositories/helpers');
const {
  detectChatIntent,
  getSafeAlternativeMessage,
  isUnsafeImagePrompt
} = require('./intent.service');

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

const getPublicBaseUrl = (req) => {
  const configured = String(process.env.PUBLIC_APP_URL || process.env.BALE_WEBHOOK_PUBLIC_URL || '').replace(/\/+$/, '');
  if (configured) return configured;
  const protocol = String(req.headers?.['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.headers?.['x-forwarded-host'] || req.get?.('host') || '').split(',')[0].trim();
  return host ? `${protocol}://${host}` : '';
};

const toAbsoluteImageUrl = (req, value) => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const baseUrl = getPublicBaseUrl(req);
  if (!baseUrl) return '';
  return `${baseUrl}${raw.startsWith('/') ? raw : `/${raw}`}`;
};

const isPrivateImageProviderUrl = (value) => {
  const raw = String(value || '').trim();
  try {
    const url = new URL(raw, 'https://local.invalid');
    // TODO: replace this block with a short-lived signed /api/images/input/:token URL for provider-side image edit.
    return (
      url.pathname.startsWith('/api/images/result/') ||
      url.pathname.startsWith('/api/images/serve/') ||
      url.pathname.startsWith('/api/images/status/')
    );
  } catch (_error) {
    return true;
  }
};

const getImageInputUrls = (req, imageIds, history) => {
  const urls = [];
  let hasPrivateImage = false;
  for (const imageId of Array.isArray(imageIds) ? imageIds : []) {
    const normalized = typeof imageId === 'string' ? imageId.trim() : '';
    if (normalized) urls.push(toAbsoluteImageUrl(req, `/api/uploads/images/${encodeURIComponent(normalized)}`));
  }

  const recentWithImages = Array.isArray(history)
    ? [...history].reverse().find((item) => Array.isArray(item?.images) && item.images.length > 0)
    : null;
  for (const image of Array.isArray(recentWithImages?.images) ? recentWithImages.images : []) {
    const url = typeof image?.url === 'string' ? image.url : typeof image === 'string' ? image : '';
    if (!url) continue;
    if (isPrivateImageProviderUrl(url)) {
      hasPrivateImage = true;
      continue;
    }
    urls.push(toAbsoluteImageUrl(req, url));
  }

  return {
    urls: [...new Set(urls.filter(Boolean))].slice(0, 14),
    hasPrivateImage
  };
};

function createAiController({
  aiService,
  errorsRepository,
  guestsRepository,
  usersRepository,
  plansRepository,
  settingsRepository,
  imageGenerationController,
  imageGenerationService,
  jwt,
  jwtSecret
}) {
  const getGuestMessageLimit = async () => {
    if (!settingsRepository || typeof settingsRepository.get !== 'function') {
      return GUEST_MESSAGE_LIMIT;
    }
    const value = await settingsRepository.get('guest.message_limit');
    return Number.isFinite(Number(value)) ? Number(value) : GUEST_MESSAGE_LIMIT;
  };

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
      const { message, profile, history, conversationId, imageIds, clientMessageId } = req.body || {};
      const authContext = await getAuthenticatedUserId(req);
      if (authContext.invalid) {
        return res.status(401).json({ error: 'Invalid or expired token.' });
      }

      const authenticatedUserId = authContext.userId;
      if (authenticatedUserId) {
        req.user = { id: authenticatedUserId };
      }
      const isGuest = !authenticatedUserId;
      let effectiveProfile = profile;
      let limitStatus = null;

      if (authenticatedUserId) {
        effectiveProfile = {
          ...(profile && typeof profile === 'object' ? profile : {}),
          id: authenticatedUserId
        };
      }

      const intentResult = await detectChatIntent({
        message,
        hasAttachedImages: Array.isArray(imageIds) && imageIds.length > 0,
        hasRecentImage: Array.isArray(history) && history.some((item) => Array.isArray(item?.images) && item.images.length > 0),
        classify:
          aiService && typeof aiService.classifyIntent === 'function'
            ? (text) => aiService.classifyIntent(text, { requestId: res.locals.requestId })
            : null
      });

      if (intentResult.intent === 'image_generation' || intentResult.intent === 'image_edit') {
        const trimmedMessage = typeof message === 'string' ? message.trim() : '';
        const prompt = trimmedMessage.replace(/^\/imagine\s+/i, '').trim();
        const isEdit = intentResult.intent === 'image_edit';
        const persistFailure = async ({ userId, assistantText, errorCode }) => {
          if (!userId || !aiService || typeof aiService.persistImageChatTurn !== 'function') return [];
          return aiService.persistImageChatTurn({
            userId,
            conversationId,
            userMessage: trimmedMessage || 'درخواست تصویر',
            assistantText,
            intent: intentResult.intent,
            errorCode,
            requestId: res.locals.requestId,
            clientMessageId
          });
        };

        if (isEdit && !(imageGenerationService && typeof imageGenerationService.supportsImageEdit === 'function' && imageGenerationService.supportsImageEdit())) {
          const { userId } = await imageGenerationController.resolveUserContext(req, res);
          const assistantText = 'ویرایش تصویر در این provider فعلاً پشتیبانی نمی‌شود؛ ساخت تصویر جدید فعال است.';
          const messages = await persistFailure({ userId, assistantText, errorCode: 'IMAGE_EDIT_UNSUPPORTED' });
          return res.json({
            intent: 'image_edit',
            status: 'ERROR',
            unsupported: true,
            assistantText,
            messages
          });
        }

        if (isUnsafeImagePrompt(prompt)) {
          const { userId } = await imageGenerationController.resolveUserContext(req, res);
          const assistantText = getSafeAlternativeMessage();
          const messages = await persistFailure({ userId, assistantText, errorCode: 'UNSAFE_IMAGE_PROMPT' });
          return res.json({
            intent: intentResult.intent,
            status: 'ERROR',
            blocked: true,
            assistantText,
            messages
          });
        }

        try {
          const imageInput = isEdit ? getImageInputUrls(req, imageIds, history) : { urls: [], hasPrivateImage: false };
          if (isEdit && imageInput.urls.length === 0) {
            const { userId } = await imageGenerationController.resolveUserContext(req, res);
            const assistantText = imageInput.hasPrivateImage
              ? 'برای ویرایش تصویر، فایل باید به صورت قابل دسترسی برای سرویس تصویر آماده شود.'
              : 'برای ویرایش تصویر، اول یک تصویر مرجع بفرست یا روی تصویری که قبلاً ساخته شده ادامه بده.';
            const messages = await persistFailure({
              userId,
              assistantText,
              errorCode: imageInput.hasPrivateImage ? 'IMAGE_EDIT_REQUIRES_PUBLIC_URL' : 'IMAGE_EDIT_REQUIRES_IMAGE'
            });
            return res.json({
              intent: intentResult.intent,
              status: 'ERROR',
              assistantText,
              messages
            });
          }
          const enhancedPrompt =
            aiService && typeof aiService.enhanceImagePrompt === 'function'
              ? await aiService.enhanceImagePrompt(prompt, {
                  requestId: res.locals.requestId,
                  intent: intentResult.intent
                })
              : '';
          const task = await imageGenerationController.createImageTask(req, res, {
            prompt,
            enhancedPrompt,
            imageInput: imageInput.urls
          });
          const assistantText = 'باشه، دارم تصویرت رو می‌سازم...';
          const messages = await aiService.persistImageChatTurn({
            userId: task.userId,
            conversationId,
            userMessage: trimmedMessage || prompt,
            assistantText,
            taskId: task.taskId,
            status: task.status,
            intent: intentResult.intent,
            requestId: res.locals.requestId,
            clientMessageId
          });

          return res.status(202).json({
            intent: intentResult.intent,
            status: task.status,
            assistantText,
            taskId: task.taskId,
            messages
          });
        } catch (imageError) {
          const payload = imageError?.publicPayload || {};
          const assistantText =
            payload.message ||
            (payload.error === 'IMAGE_LIMIT_REACHED' || payload.error === 'IMAGE_GENERATION_DISABLED'
              ? 'محدودیت ساخت تصویر تمام شده است.'
              : 'ساخت تصویر انجام نشد. مشکل از سرویس تصویر بود، نه درخواست تو. دوباره امتحان کن.');
          const userId =
            imageError?.userId ||
            (await imageGenerationController.resolveUserContext(req, res).catch(() => ({ userId: '' }))).userId;
          const messages = await persistFailure({
            userId,
            assistantText,
            errorCode: payload.error || 'IMAGE_TASK_FAILED'
          });

          return res.json({
            intent: intentResult.intent,
            status: 'ERROR',
            assistantText,
            error: payload.error || 'IMAGE_TASK_FAILED',
            reason: payload.reason || null,
            messages
          });
        }
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
        const guestMessageLimit = await getGuestMessageLimit();
        const currentCount = await guestsRepository.getCurrentCount({ guestId, ipAddress });
        if (currentCount >= guestMessageLimit) {
          return res.status(403).json({
            error: 'GUEST_LIMIT_REACHED',
            message: 'برای ادامه گفتگو، لطفاً با کمک والد گفتگوها را ذخیره کنید.',
            limit: guestMessageLimit,
            usage: currentCount,
            remaining: 0,
            nextAction: 'guardian_signup'
          });
        }

        const guestUserId = await guestsRepository.ensureGuestUser(guestId);
        limitStatus = 'guest_allowed';
        effectiveProfile = {
          ...(profile && typeof profile === 'object' ? profile : {}),
          id: guestUserId,
          name: 'مهمان',
          age: Number(profile?.age || 0) || 0,
          phone: undefined
        };
        guestContext = { guestId, ipAddress };
      } else if (plansRepository && typeof plansRepository.checkLimit === 'function') {
        const limitState = await plansRepository.checkLimit(authenticatedUserId, 'message');
        if (!limitState.allowed) {
          return res.status(402).json({
            error: 'MESSAGE_LIMIT_REACHED',
            message: 'سقف پیام روزانه پلن شما تمام شده است.',
            plan: limitState.plan?.id || null,
            limit: limitState.limit,
            usage: limitState.usage
          });
        }
        limitStatus = 'plan_allowed';
      }

      const result = await aiService.sendChatMessage({
        message,
        profile: effectiveProfile,
        history,
        conversationId,
        imageIds,
        requestId: res.locals.requestId,
        limitStatus
      });

      if (guestContext) {
        await guestsRepository.incrementCount(guestContext);
      } else if (authenticatedUserId && plansRepository && typeof plansRepository.incrementDailyUsage === 'function') {
        await plansRepository.incrementDailyUsage(authenticatedUserId, 'message', 1);
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
