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
const STREAM_CONTENT_TYPE = 'application/x-ndjson';
const STREAM_ID_PATTERN = /^[0-9a-zA-Z][0-9a-zA-Z._:-]{7,63}$/;

// The chat surface can only answer in text or analyze supplied images. Image
// creation and editing are intentionally available only through Image Studio.
const normalizeIntentForChat = (intent) => (
  intent === 'image_understanding' ? 'image_understanding' : 'chat'
);
const IMAGE_NOUN_PATTERN = /(?:عکس|تصویر|نقاشی|پوستر|بنر|والپیپر|image|photo|picture|poster)/i;
const IMAGE_CREATE_PATTERN = /(?:بساز(?:ی|ید)?|بکش(?:ی|ید)?|بزن(?:ی|ید)?|طراحی\s*(?:کن|کنید)|تولید\s*(?:کن|کنم|کنید)|درست\s*(?:کن|کنید)|خلق\s*(?:کن|کنید)|make|generate|create|draw|render|paint)/i;
const IMAGE_EDIT_PATTERN = /(?:ادیت|ویرایش|تغییر|عوض|جایگزین|حذف|پاک|اضافه|بذار|بزار|قرار\s*(?:بده|ده)|ترمیم|بهبود|واضح|کارتونی|پس\s*زمینه|رنگ(?:ش)?|موهاش|لباسش|نورش|قرمز|آبی|سبز|زرد|مشکی|سفید|بلندتر|کوتاهتر|background|edit|change|replace|remove|add|enhance|restore|recolor|transform|stylize)/i;

const isImageStudioRequest = (message, imageContext = {}) => {
  const text = String(message || '').trim();
  if (!text) return false;
  if (/^\/imagine\s+\S/i.test(text)) return true;

  const hasImageNoun = IMAGE_NOUN_PATTERN.test(text);
  const hasAttachedOrPreviousImage = Boolean(
    imageContext.hasCurrentImageAttachment ||
    imageContext.hasPreviousUploadedImage ||
    imageContext.hasPreviousGeneratedImage
  );
  return (
    (hasImageNoun && IMAGE_CREATE_PATTERN.test(text)) ||
    (IMAGE_EDIT_PATTERN.test(text) && (hasImageNoun || hasAttachedOrPreviousImage))
  );
};
const MAX_IMAGE_EDIT_INPUTS = 4;

const wantsStreamingResponse = (req) =>
  String(req.headers?.accept || '').toLowerCase().includes(STREAM_CONTENT_TYPE);

const writeStreamEvent = (res, event) => {
  if (res.destroyed || res.writableEnded) return false;
  res.write(`${JSON.stringify(event)}\n`);
  if (typeof res.flush === 'function') res.flush();
  return true;
};

const openStreamResponse = (res) => {
  res.status(200);
  res.setHeader('Content-Type', `${STREAM_CONTENT_TYPE}; charset=utf-8`);
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
};

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
    .filter(Boolean))].slice(0, MAX_IMAGE_EDIT_INPUTS);
  if (uniqueIds.length === 0) return [];
  const images = await uploadedImagesRepository.getByIds(uniqueIds);
  return (Array.isArray(images) ? images : []).map(toDataImageUrl).filter(Boolean);
};

const getImageInputUrls = async (req, res, imageIds, history, imageGenerationController, uploadedImagesRepository) => {
  const urls = [];
  let hasPrivateImage = false;

  urls.push(...(await getUploadedImageInputs(imageIds, uploadedImagesRepository)));

  const recentWithImages = urls.length === 0 && Array.isArray(history)
    ? [...history].reverse().find((item) => Array.isArray(item?.images) && item.images.length > 0)
    : null;
  if (recentWithImages) {
    for (const image of Array.isArray(recentWithImages.images) ? recentWithImages.images : []) {
      if (urls.length >= MAX_IMAGE_EDIT_INPUTS) break;
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
    urls: [...new Set(urls.filter(Boolean))].slice(0, MAX_IMAGE_EDIT_INPUTS),
    hasPrivateImage
  };
};

const getImageContextForRouting = (imageIds, history) => {
  const hasCurrentImageAttachment = Array.isArray(imageIds) && imageIds.some((item) => typeof item === 'string' && item.trim());
  const previousUserMessage = Array.isArray(history)
    ? [...history].reverse().map((item) => {
        const role = String(item?.role || item?.sender || '').toLowerCase();
        if (role !== 'user') return '';
        return String(item?.content || item?.text || item?.message || '').trim();
      }).find(Boolean) || ''
    : '';
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
    previousUserMessage: previousUserMessage.slice(0, 1000),
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
  chatTurnsRepository,
  settingsRepository,
  intentRouterService,
  imageGenerationController,
  imageGenerationService,
  imageUnderstandingService,
  uploadedImagesRepository,
  conversationMemoryService,
  conversationContextBuilder,
  conversationMemoryWriterService,
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
      const { message, profile, history, conversationId, imageIds, clientMessageId, turnId, attemptId } = req.body || {};
      const wantsStream = wantsStreamingResponse(req);
      let guestLimitPayload = null;
      let planLimitPayload = null;
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
      const shouldRedirectToImageStudio = isImageStudioRequest(message, routeContext);
      if (!shouldRedirectToImageStudio && intentRouterService && typeof intentRouterService.route === 'function') {
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

      if (shouldRedirectToImageStudio) {
        intentResult = {
          intent: 'chat',
          confidence: 'high',
          source: 'image_studio_redirect',
          metadata: { source: 'image_studio_redirect' }
        };
      } else if (routeResult?.ok && routeResult.route) {
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

      intentResult = {
        ...intentResult,
        intent: normalizeIntentForChat(intentResult.intent)
      };

      if (intentResult.intent === 'image_generation' || intentResult.intent === 'image_edit') {
        const trimmedMessage = typeof message === 'string' ? message.trim() : '';
        const prompt = trimmedMessage.replace(/^\/imagine\s+/i, '').trim();
        const isEdit = intentResult.intent === 'image_edit';
        const requestedImageCount = new Set(
          (Array.isArray(imageIds) ? imageIds : [])
            .map((item) => (typeof item === 'string' ? item.trim() : ''))
            .filter(Boolean)
        ).size;
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

        if (isEdit && requestedImageCount > MAX_IMAGE_EDIT_INPUTS) {
          const { userId } = await imageGenerationController.resolveUserContext(req, res);
          const assistantText = `برای هر ویرایش حداکثر ${MAX_IMAGE_EDIT_INPUTS} تصویر مرجع بفرست. تصویر اول، سوژه اصلی محسوب می‌شود.`;
          const messages = await persistFailure({ userId, assistantText, errorCode: 'IMAGE_EDIT_TOO_MANY_INPUTS' });
          return res.status(400).json({
            intent: 'image_edit',
            status: 'ERROR',
            error: 'IMAGE_EDIT_TOO_MANY_INPUTS',
            maxImages: MAX_IMAGE_EDIT_INPUTS,
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
            imageInput: imageInput.urls,
            conversationId
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
        if (currentCount >= guestMessageLimit && !wantsStream) {
          return res.status(403).json({
            error: 'GUEST_LIMIT_REACHED',
            message: 'برای ادامه گفتگو، لطفاً با کمک والد گفتگوها را ذخیره کنید.',
            limit: guestMessageLimit,
            usage: currentCount,
            remaining: 0,
            nextAction: 'guardian_signup'
          });
        }
        if (currentCount >= guestMessageLimit) {
          guestLimitPayload = {
            error: 'GUEST_LIMIT_REACHED',
            message: 'برای ادامه گفتگو، لطفاً با کمک والد گفتگوها را ذخیره کنید.',
            limit: guestMessageLimit,
            usage: currentCount,
            remaining: 0,
            nextAction: 'guardian_signup'
          };
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
        if (!limitState.allowed && !wantsStream) {
          return res.status(402).json({
            error: 'MESSAGE_LIMIT_REACHED',
            message: 'سقف پیام روزانه پلن شما تمام شده است.',
            plan: limitState.plan?.id || null,
            limit: limitState.limit,
            usage: limitState.usage
          });
        }
        if (!limitState.allowed) {
          planLimitPayload = {
            error: 'MESSAGE_LIMIT_REACHED',
            message: 'سقف پیام روزانه پلن شما تمام شده است.',
            plan: limitState.plan?.id || null,
            limit: limitState.limit,
            usage: limitState.usage
          };
        }
        limitStatus = 'plan_allowed';
      }

      if (wantsStream) {
        if (!chatTurnsRepository) return res.status(500).json({ error: 'CHAT_STREAM_NOT_CONFIGURED' });
        if (!STREAM_ID_PATTERN.test(String(turnId || '')) || !STREAM_ID_PATTERN.test(String(attemptId || ''))) {
          return res.status(400).json({ error: 'INVALID_STREAM_IDS', message: 'turnId و attemptId معتبر نیستند.' });
        }
        const ownerId = String(authenticatedUserId || effectiveProfile?.id || '').trim();
        const existingTurn = await chatTurnsRepository.getTurn(turnId);
        if (existingTurn && String(existingTurn.user_id) !== ownerId) {
          return res.status(409).json({ error: 'TURN_ID_CONFLICT' });
        }
        if (!existingTurn && guestLimitPayload) return res.status(403).json(guestLimitPayload);
        if (!existingTurn && planLimitPayload) return res.status(402).json(planLimitPayload);
        if (existingTurn?.status === 'streaming') {
          return res.status(409).json({ error: 'TURN_IN_PROGRESS', message: 'این پاسخ هنوز در حال تولید است.' });
        }

        const normalizedUserMessage = typeof message === 'string' && message.trim()
          ? message.trim()
          : intentResult.intent === 'image_understanding'
            ? 'لطفاً محتوای عکس را توضیح بده.'
            : '📷 عکس ارسال شد';
        const { turn } = await chatTurnsRepository.beginTurn({
          turnId,
          userId: ownerId,
          conversationId,
          clientMessageId,
          userMessage: normalizedUserMessage,
          intent: intentResult.intent
        });
        await chatTurnsRepository.beginAttempt({ attemptId, turnId });
        openStreamResponse(res);

        if (turn.status === 'completed') {
          writeStreamEvent(res, {
            type: 'meta',
            status: 'streaming',
            turnId,
            attemptId,
            intent: turn.intent,
            imageStudioRedirect: shouldRedirectToImageStudio,
            replay: true
          });
          writeStreamEvent(res, { type: 'delta', turnId, attemptId, delta: String(turn.reply || '') });
          await chatTurnsRepository.finishAttempt({ attemptId, status: 'completed' });
          writeStreamEvent(res, {
            type: 'done',
            status: 'completed',
            turnId,
            attemptId,
            intent: turn.intent,
            reply: String(turn.reply || ''),
            conversationId: turn.conversation_id,
            imageStudioRedirect: shouldRedirectToImageStudio,
            replay: true
          });
          return res.end();
        }

        const providerAbort = new AbortController();
        const abortOnDisconnect = () => {
          if (!res.writableEnded) providerAbort.abort();
        };
        res.once('close', abortOnDisconnect);
        if (res.destroyed) providerAbort.abort();
        writeStreamEvent(res, {
          type: 'meta',
          status: 'streaming',
          turnId,
          attemptId,
          intent: intentResult.intent,
          imageStudioRedirect: shouldRedirectToImageStudio
        });

        try {
          let streamResult;
          if (intentResult.intent === 'image_understanding') {
            streamResult = await imageUnderstandingService.streamAnalyzeChatImages({
              req,
              res,
              message: normalizedUserMessage,
              imageIds,
              history,
              requestId: res.locals.requestId,
              signal: providerAbort.signal,
              onDelta: async (delta) => {
                if (!writeStreamEvent(res, { type: 'delta', turnId, attemptId, delta })) providerAbort.abort();
              }
            });
            await aiService.persistVisionChatTurn({
              profile: effectiveProfile,
              conversationId,
              userMessage: normalizedUserMessage,
              assistantText: streamResult.answer,
              requestId: res.locals.requestId,
              clientMessageId,
              imageIds,
              diagnostics: streamResult.diagnostics,
              limitStatus,
              turnId
            });
            streamResult = { ...streamResult, reply: streamResult.answer };
          } else {
            streamResult = await aiService.streamChatMessage({
              message,
              profile: effectiveProfile,
              history,
              conversationId,
              imageIds,
              requestId: res.locals.requestId,
              limitStatus,
              turnId,
              signal: providerAbort.signal,
              onDelta: async (delta) => {
                if (!writeStreamEvent(res, { type: 'delta', turnId, attemptId, delta })) providerAbort.abort();
              }
            });
          }

          await chatTurnsRepository.markTurn({
            turnId,
            status: 'completed',
            reply: streamResult.reply,
            model: streamResult.model,
            tokenUsage: streamResult.tokenUsage
          });
          await chatTurnsRepository.finishAttempt({ attemptId, status: 'completed' });
          if (await chatTurnsRepository.claimQuota(turnId)) {
            try {
              if (guestContext) await guestsRepository.incrementCount(guestContext);
              else if (authenticatedUserId && plansRepository?.incrementDailyUsage) {
                await plansRepository.incrementDailyUsage(authenticatedUserId, 'message', 1);
              }
            } catch (quotaError) {
              await errorsRepository.logError('stream_quota_increment_failed', '/api/chat', null, String(quotaError?.message || quotaError));
            }
          }
          writeStreamEvent(res, {
            type: 'done',
            status: 'completed',
            turnId,
            attemptId,
            intent: intentResult.intent,
            reply: streamResult.reply,
            conversationId: streamResult.conversationId || conversationId,
            imageStudioRedirect: shouldRedirectToImageStudio
          });
          return res.end();
        } catch (streamError) {
          const cancelled = providerAbort.signal.aborted || streamError?.name === 'AbortError' || streamError?.code === 'PROVIDER_REQUEST_ABORTED';
          const status = cancelled ? 'cancelled' : 'failed';
          const errorCode = cancelled ? 'CANCELLED' : String(streamError?.code || 'STREAM_FAILED');
          if (!cancelled) {
            await errorsRepository.logError(
              'chat_stream_failed',
              '/api/chat',
              Number(streamError?.details?.status) || null,
              JSON.stringify({
                turnId,
                attemptId,
                code: errorCode,
                name: streamError?.name || null,
                message: streamError instanceof Error ? streamError.message : String(streamError || ''),
                details: streamError?.details || null
              })
            ).catch(() => undefined);
          }
          await chatTurnsRepository.finishAttempt({ attemptId, status, errorCode }).catch(() => undefined);
          await chatTurnsRepository.markTurn({ turnId, status, errorCode }).catch(() => undefined);
          if (!res.destroyed && !res.writableEnded) {
            writeStreamEvent(res, {
              type: status === 'cancelled' ? 'cancelled' : 'error',
              status,
              turnId,
              attemptId,
              error: errorCode,
              message: cancelled ? 'پاسخ متوقف شد.' : 'ارتباط با مدل قطع شد. برای تلاش مجدد روی دکمه بزن.',
              retryable: !cancelled
            });
            res.end();
          }
          return undefined;
        } finally {
          res.removeListener('close', abortOnDisconnect);
        }
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
          const userVisionPrompt =
            typeof message === 'string' && message.trim() ? message.trim() : 'لطفاً محتوای عکس را توضیح بده.';
          const composedResult = await aiService.composeVisionChatReply({
            profile: effectiveProfile,
            conversationId,
            userMessage: userVisionPrompt,
            visionAnalysis: visionResult.answer,
            requestId: res.locals.requestId
          });
          const finalAssistantText = composedResult.reply;
          const persisted = await aiService.persistVisionChatTurn({
            profile: effectiveProfile,
            conversationId,
            userMessage: userVisionPrompt,
            assistantText: finalAssistantText,
            requestId: res.locals.requestId,
            clientMessageId,
            imageIds,
            diagnostics: {
              ...visionResult.diagnostics,
              visionModel: visionResult.model || visionResult.diagnostics?.model || null,
              chatModel: composedResult.model || null,
              chatResponseTimeMs: composedResult.responseTimeMs
            },
            limitStatus
          });

          if (guestContext) {
            await guestsRepository.incrementCount(guestContext);
          } else if (authenticatedUserId && plansRepository && typeof plansRepository.incrementDailyUsage === 'function') {
            await plansRepository.incrementDailyUsage(authenticatedUserId, 'message', 1);
          }

          return res.json({
            intent: 'image_understanding',
            reply: finalAssistantText,
            messages: persisted.messages,
            diagnostics: {
              ...visionResult.diagnostics,
              finalResponseModel: composedResult.model || null,
              pipeline: 'vision_then_chat'
            },
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
        imageStudioRedirect: shouldRedirectToImageStudio,
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

module.exports = { createAiController, isImageStudioRequest, normalizeIntentForChat };
