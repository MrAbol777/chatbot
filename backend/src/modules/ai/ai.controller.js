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
const { publicVisionErrorMessage } = require('../image-understanding/image-understanding.controller');

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

const toDataImageUrl = (image) => {
  const mimeType = typeof image?.mimeType === 'string' ? image.mimeType.trim() : '';
  const base64 = typeof image?.base64 === 'string' ? image.base64.trim() : '';
  if (!mimeType || !base64 || !/^image\/(?:jpeg|jpg|png|webp)$/i.test(mimeType)) return '';
  return `data:${mimeType};base64,${base64}`;
};

const parseGeneratedImageTaskId = (value) => {
  const raw = String(value || '').trim();
  try {
    const url = new URL(raw, 'https://local.invalid');
    const match = url.pathname.match(/^\/api\/images\/(?:result|serve)\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  } catch (_error) {
    return '';
  }
};

const parseUploadedImageId = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, 'https://local.invalid');
    const match = url.pathname.match(/^\/api\/uploads\/images\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  } catch (_error) {
    return '';
  }
};

const getUploadedImageInputs = async (imageIds, uploadedImagesRepository) => {
  if (!uploadedImagesRepository || typeof uploadedImagesRepository.getByIds !== 'function') return [];
  const uniqueIds = [...new Set((Array.isArray(imageIds) ? imageIds : [])
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean))].slice(0, 5);
  if (uniqueIds.length === 0) return [];
  const images = await uploadedImagesRepository.getByIds(uniqueIds);
  return (Array.isArray(images) ? images : []).map(toDataImageUrl).filter(Boolean);
};

const getImageInputUrls = async (req, res, imageIds, history, imageGenerationController, uploadedImagesRepository) => {
  const urls = [];
  let hasPrivateImage = false;

  urls.push(...(await getUploadedImageInputs(imageIds, uploadedImagesRepository)));

  const recentImageMessages = Array.isArray(history)
    ? [...history].reverse().filter((item) => Array.isArray(item?.images) && item.images.length > 0)
    : [];
  for (const recentWithImages of recentImageMessages) {
    if (urls.length > 0) break;
    for (const image of Array.isArray(recentWithImages?.images) ? recentWithImages.images : []) {
      if (urls.length > 0) break;
      const url = typeof image?.url === 'string' ? image.url : typeof image === 'string' ? image : '';
      if (!url) continue;
      if (/^blob:/i.test(url)) continue;
      if (/^data:image\//i.test(url)) {
        urls.push(url);
        continue;
      }
      const uploadedImageId = parseUploadedImageId(url);
      if (uploadedImageId) {
        const uploadedInputs = await getUploadedImageInputs([uploadedImageId], uploadedImagesRepository);
        if (uploadedInputs.length > 0) {
          urls.push(...uploadedInputs);
        } else {
          hasPrivateImage = true;
        }
        continue;
      }
      const generatedTaskId = parseGeneratedImageTaskId(url);
      if (generatedTaskId) {
        const editableInput =
          imageGenerationController && typeof imageGenerationController.getEditableImageInput === 'function'
            ? await imageGenerationController.getEditableImageInput(req, res, generatedTaskId).catch(() => null)
            : null;
        if (editableInput?.dataUrl) {
          urls.push(editableInput.dataUrl);
        } else {
          hasPrivateImage = true;
        }
        continue;
      }
      urls.push(toAbsoluteImageUrl(req, url));
    }
  }

  return {
    urls: [...new Set(urls.filter(Boolean))].slice(0, 14),
    hasPrivateImage
  };
};

const getImageContextForRouting = (imageIds, history) => {
  const hasCurrentImageAttachment = Array.isArray(imageIds) && imageIds.some((item) => typeof item === 'string' && item.trim());
  let hasPreviousUploadedImage = false;
  let hasPreviousGeneratedImage = false;
  let lastImageKind = 'none';

  const recentImageMessages = Array.isArray(history)
    ? [...history].reverse().filter((item) => Array.isArray(item?.images) && item.images.length > 0)
    : [];
  for (const message of recentImageMessages) {
    for (const image of Array.isArray(message?.images) ? message.images : []) {
      const url = typeof image?.url === 'string' ? image.url : typeof image === 'string' ? image : '';
      if (!url) continue;
      if (parseGeneratedImageTaskId(url)) {
        hasPreviousGeneratedImage = true;
        if (lastImageKind === 'none') lastImageKind = 'generated';
      } else if (parseUploadedImageId(url) || /^data:image\//i.test(url)) {
        hasPreviousUploadedImage = true;
        if (lastImageKind === 'none') lastImageKind = 'uploaded';
      }
    }
    if (lastImageKind !== 'none') break;
  }

  return {
    hasCurrentImageAttachment,
    hasPreviousUploadedImage,
    hasPreviousGeneratedImage,
    lastImageKind: hasCurrentImageAttachment ? 'uploaded' : lastImageKind,
    locale: 'fa'
  };
};

function createAiController({
  aiService,
  errorsRepository,
  guestsRepository,
  usersRepository,
  plansRepository,
  settingsRepository,
  intentRouterService,
  imageGenerationController,
  imageGenerationService,
  imageUnderstandingService,
  uploadedImagesRepository,
  conversationMemoryService,
  conversationContextBuilder,
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
    let releaseTurnLock = null;

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

      if (
        conversationId &&
        conversationMemoryService &&
        conversationMemoryService.isValidConversationId?.(conversationId) &&
        conversationMemoryWriterService &&
        typeof conversationMemoryWriterService.acquireTurnLock === 'function'
      ) {
        releaseTurnLock = await conversationMemoryWriterService.acquireTurnLock(String(conversationId).trim());
      }

      const routeContext = getImageContextForRouting(imageIds, history);
      if (
        authenticatedUserId &&
        conversationMemoryService &&
        conversationMemoryService.isValidConversationId?.(conversationId) &&
        conversationContextBuilder &&
        typeof conversationContextBuilder.buildRouterContext === 'function'
      ) {
        const memoryDocument = await conversationMemoryService
          .readForConversation(conversationId, { userId: authenticatedUserId }, { createIfMissing: true })
          .catch(() => null);
        if (memoryDocument?.content) {
          const documentRouteContext = conversationContextBuilder.buildRouterContext(memoryDocument.content);
          routeContext.currentTopic = documentRouteContext.currentTopic;
          routeContext.activeReferences = documentRouteContext.activeReferences;
          routeContext.hasPreviousUploadedImage =
            routeContext.hasPreviousUploadedImage || documentRouteContext.hasPreviousUploadedImage;
          routeContext.hasPreviousGeneratedImage =
            routeContext.hasPreviousGeneratedImage || documentRouteContext.hasPreviousGeneratedImage;
          routeContext.lastImageKind = routeContext.hasCurrentImageAttachment
            ? 'uploaded'
            : documentRouteContext.hasPreviousGeneratedImage
              ? 'generated'
              : documentRouteContext.hasPreviousUploadedImage
                ? 'uploaded'
                : routeContext.lastImageKind;
        }
      }
      let intentResult = null;
      let routeResult = null;
      if (intentRouterService && typeof intentRouterService.route === 'function') {
        routeResult = await intentRouterService.route({
          userMessage: message,
          ...routeContext
        }).catch((error) => ({
          ok: false,
          status: 'router_exception',
          metadata: {
            source: 'heuristic_fallback',
            status: 'router_exception',
            errorType: error?.code || 'router_exception'
          },
          settings: { fallbackToHeuristic: true }
        }));
      }

      if (routeResult?.ok && routeResult.route) {
        intentResult = {
          intent: routeResult.route.intent,
          confidence: 'high',
          source: 'intent_router',
          route: routeResult.route,
          metadata: routeResult.metadata || null
        };
      } else if (!routeResult || routeResult.settings?.fallbackToHeuristic !== false || routeResult.metadata?.fallbackToHeuristic !== false) {
        const fallbackIntent = await detectChatIntent({
          message,
          hasAttachedImages: routeContext.hasCurrentImageAttachment,
          hasRecentImage: routeContext.hasPreviousUploadedImage || routeContext.hasPreviousGeneratedImage,
          classify: null
        });
        intentResult = {
          ...fallbackIntent,
          source: 'heuristic_fallback',
          metadata: routeResult?.metadata || null
        };
      } else {
        intentResult = {
          intent: 'chat',
          confidence: 'low',
          source: 'intent_router_failed_no_fallback',
          metadata: routeResult?.metadata || null
        };
      }

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
            messages,
            intentRouter: intentResult.metadata || null
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
            messages,
            intentRouter: intentResult.metadata || null
          });
        }

        try {
          const imageInput = isEdit
            ? await getImageInputUrls(req, res, imageIds, history, imageGenerationController, uploadedImagesRepository)
            : { urls: [], hasPrivateImage: false };
          if (isEdit && imageInput.urls.length === 0) {
            const { userId } = await imageGenerationController.resolveUserContext(req, res);
            const assistantText = 'برای ویرایش، اول یک تصویر بفرست یا یک تصویر بساز تا روی همان تغییر بدهم.';
            const messages = await persistFailure({
              userId,
              assistantText,
              errorCode: imageInput.hasPrivateImage ? 'IMAGE_EDIT_REQUIRES_PUBLIC_URL' : 'IMAGE_EDIT_REQUIRES_IMAGE'
            });
            return res.json({
              intent: intentResult.intent,
              status: 'ERROR',
              assistantText,
              messages,
              intentRouter: intentResult.metadata || null
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
            messages,
            intentRouter: intentResult.metadata || null
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
            messages,
            intentRouter: intentResult.metadata || null
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

      if (intentResult.intent === 'image_understanding') {
        try {
          const visionResult = await imageUnderstandingService.analyzeChatImages({
            req,
            res,
            message,
            imageIds,
            history,
            requestId: res.locals.requestId
          });
          const persisted = await aiService.persistVisionChatTurn({
            profile: effectiveProfile,
            conversationId,
            userMessage: typeof message === 'string' && message.trim() ? message.trim() : 'لطفاً محتوای عکس را توضیح بده.',
            assistantText: visionResult.answer,
            requestId: res.locals.requestId,
            clientMessageId,
            imageIds,
            diagnostics: visionResult.diagnostics,
            limitStatus
          });

          if (guestContext) {
            await guestsRepository.incrementCount(guestContext);
          } else if (authenticatedUserId && plansRepository && typeof plansRepository.incrementDailyUsage === 'function') {
            await plansRepository.incrementDailyUsage(authenticatedUserId, 'message', 1);
          }

          return res.json({
            intent: 'image_understanding',
            reply: visionResult.answer,
            messages: persisted.messages,
            diagnostics: visionResult.diagnostics,
            intentRouter: intentResult.metadata || null
          });
        } catch (visionError) {
          const assistantText = publicVisionErrorMessage(visionError);
          const statusCode =
            visionError?.code === 'IMAGE_NOT_FOUND' ? 404 :
            visionError?.code === 'UNSUPPORTED_IMAGE_FORMAT' ? 400 :
            visionError?.code === 'IMAGE_TOO_LARGE' ? 413 :
            visionError?.code === 'VISION_TIMEOUT' ? 504 :
            visionError?.code === 'API_KEY_MISSING' ? 500 :
            502;
          const persisted = await aiService.persistVisionChatTurn({
            profile: effectiveProfile,
            conversationId,
            userMessage: typeof message === 'string' && message.trim() ? message.trim() : 'لطفاً محتوای عکس را توضیح بده.',
            assistantText,
            requestId: res.locals.requestId,
            clientMessageId,
            imageIds,
            diagnostics: {
              status: 'error',
              errorCode: visionError?.code || 'VISION_ANALYZE_FAILED'
            },
            limitStatus
          }).catch(() => ({ messages: [] }));
          return res.json({
            intent: 'image_understanding',
            status: 'ERROR',
            assistantText,
            error: visionError?.code || 'VISION_ANALYZE_FAILED',
            statusCode,
            messages: persisted.messages,
            intentRouter: intentResult.metadata || null
          });
        }
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

      return res.json({
        ...result,
        intentRouter: intentResult.metadata || null
      });
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
    } finally {
      if (typeof releaseTurnLock === 'function') {
        releaseTurnLock();
      }
    }
  };

  return {
    postChat
  };
}

module.exports = { createAiController };
