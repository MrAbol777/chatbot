const crypto = require('crypto');
const {
  detectChatIntent,
  getSafeAlternativeMessage,
  isUnsafeImagePrompt
} = require('./intent.service');
const { publicVisionErrorMessage } = require('../image-understanding/image-understanding.controller');
const { NOA_ACTIONS } = require('../noa/noa.constants');

const STREAM_CONTENT_TYPE = 'application/x-ndjson';
const STREAM_ID_PATTERN = /^[0-9a-zA-Z][0-9a-zA-Z._:-]{7,63}$/;
const NOA_CHAT_ACTION = NOA_ACTIONS.TEXT_CHAT;

// Final-action routes stay distinct so billing is applied exactly once by the
// module that actually performs the requested operation.
const normalizeIntentForChat = (intent) => (
  ['image_understanding', 'image_generation', 'image_edit', 'video_generation'].includes(intent)
    ? intent
    : 'chat'
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

const getBearerToken = (req) => {
  const authHeader = typeof req.headers?.authorization === 'string' ? req.headers.authorization : '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
};

const createPayloadHash = (value) =>
  crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

const normalizeOperationId = (value) =>
  (typeof value === 'string' ? value.trim() : '').slice(0, 191);

const createNonStreamTurnId = (turnId, clientMessageId) => {
  const explicitTurnId = normalizeOperationId(turnId);
  if (STREAM_ID_PATTERN.test(explicitTurnId)) return explicitTurnId;
  const clientId = normalizeOperationId(clientMessageId);
  if (!clientId) return '';
  return `msg-${crypto.createHash('sha256').update(clientId).digest('hex').slice(0, 48)}`;
};

const getNoaErrorPayload = (error) => {
  if (!error || typeof error !== 'object' || !String(error.code || '').startsWith('NOA_')) return null;
  return {
    error: String(error.code),
    message: error.code === 'NOA_INSUFFICIENT_FUNDS' || error.code === 'NOA_INSUFFICIENT_BALANCE'
      ? 'موجودی نوآ برای انجام این درخواست کافی نیست.'
      : 'پرداخت نوآ برای این درخواست انجام نشد.',
    ...(error.details && typeof error.details === 'object' ? error.details : {})
  };
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
  usersRepository,
  chatTurnsRepository,
  conversationsRepository,
  intentRouterService,
    inputOptimizerService,
    conversationTitleService,
  imageGenerationController,
  imageGenerationService,
  imageUnderstandingService,
  uploadedImagesRepository,
  conversationMemoryService,
  conversationContextBuilder,
  conversationMemoryWriterService,
  noaBillingService,
  jwt,
  jwtSecret,
  principalResolver
}) {
  const getAuthenticatedUserId = async (req) => {
    if (principalResolver && typeof principalResolver.resolve === 'function') {
      const resolution = await principalResolver.resolve(req);
      return {
        userId: resolution.principal?.userId || '',
        tokenProvided: resolution.supplied.bearer || resolution.supplied.session,
        invalid: Boolean(resolution.error),
        error: resolution.error
      };
    }
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

  const requireNoaBillingService = () => {
    if (
      !noaBillingService ||
      typeof noaBillingService.reserve !== 'function' ||
      typeof noaBillingService.capture !== 'function' ||
      typeof noaBillingService.release !== 'function'
    ) {
      const error = new Error('NOA_BILLING_NOT_CONFIGURED');
      error.code = 'NOA_BILLING_NOT_CONFIGURED';
      error.statusCode = 503;
      throw error;
    }
    return noaBillingService;
  };

  const reserveChatNoa = async ({
    userId,
    operationId,
    referenceId,
    message,
    conversationId,
    imageIds,
    intent
  }) => requireNoaBillingService().reserve({
    userId,
    actionKey: intent === 'image_understanding'
      ? NOA_ACTIONS.IMAGE_UNDERSTANDING
      : NOA_CHAT_ACTION,
    quantity: intent === 'image_understanding'
      ? Math.max(1, new Set((Array.isArray(imageIds) ? imageIds : []).map((item) => String(item || '').trim()).filter(Boolean)).size)
      : 1,
    idempotencyKey: `chat:${normalizeOperationId(operationId)}`,
    payloadHash: createPayloadHash({
      actionKey: intent === 'image_understanding'
        ? NOA_ACTIONS.IMAGE_UNDERSTANDING
        : NOA_CHAT_ACTION,
      userId,
      message: String(message || ''),
      conversationId: String(conversationId || 'default'),
      imageIds: Array.isArray(imageIds) ? imageIds.map((item) => String(item || '')) : [],
      intent
    }),
    referenceType: 'chat_turn',
    referenceId: normalizeOperationId(referenceId),
    expiresAt: new Date(Date.now() + (30 * 60 * 1000))
  });

  const captureChatNoa = (reservationId, metadata = {}) =>
    requireNoaBillingService().capture(reservationId, {
      actorType: 'user',
      metadata
    });

  const releaseChatNoa = (reservationId, reason, metadata = {}) =>
    requireNoaBillingService().release(reservationId, {
      reason,
      actorType: 'system',
      metadata
    });

  const postChat = async (req, res) => {
    let releaseTurnLock = null;
    let titleGenerationTask = null;
    let nonStreamReservation = null;
    let nonStreamOutputProduced = false;
    let nonStreamCaptured = false;
    let nonStreamTurnId = '';
    let preparedChatOperation = null;
    let streamPreflightReservation = null;
    let streamPreflightTurnId = '';
    let streamPreflightAttemptId = '';
    let streamPreflightSettled = false;

    try {
      const { message, profile, history, conversationId, imageIds, clientMessageId, turnId, attemptId } = req.body || {};
      const wantsStream = wantsStreamingResponse(req);
      const authContext = await getAuthenticatedUserId(req);
      if (authContext.invalid || !authContext.userId) {
        return res.status(401).json({
          error: authContext.error || 'AUTHENTICATION_REQUIRED',
          message: 'برای استفاده از هوش مصنوعی وارد حساب کاربری شوید.'
        });
      }

      const authenticatedUserId = authContext.userId;
      req.user = { id: authenticatedUserId };
      let effectiveProfile = profile;

      effectiveProfile = {
        ...(profile && typeof profile === 'object' ? profile : {}),
        id: authenticatedUserId
      };

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
      const rawMessage = typeof message === 'string' ? message.trim() : '';
      const preliminaryIntentResult = await detectChatIntent({
        message: rawMessage,
        hasAttachedImages: routeContext.hasCurrentImageAttachment,
        hasRecentImage: routeContext.hasPreviousUploadedImage || routeContext.hasPreviousGeneratedImage,
        classify: null
      });
      const preliminaryIntent = normalizeIntentForChat(preliminaryIntentResult.intent);
      const shouldRedirectToImageStudio =
        isImageStudioRequest(rawMessage, routeContext) ||
        preliminaryIntent === 'image_generation' ||
        preliminaryIntent === 'image_edit';
      if (!shouldRedirectToImageStudio) {
        if (!chatTurnsRepository) {
          return res.status(500).json({
            error: wantsStream ? 'CHAT_STREAM_NOT_CONFIGURED' : 'CHAT_TURN_STORE_NOT_CONFIGURED'
          });
        }

        const operationTurnId = wantsStream
          ? String(turnId || '').trim()
          : createNonStreamTurnId(turnId, clientMessageId);
        if (
          wantsStream &&
          (!STREAM_ID_PATTERN.test(operationTurnId) || !STREAM_ID_PATTERN.test(String(attemptId || '')))
        ) {
          return res.status(400).json({
            error: 'INVALID_STREAM_IDS',
            message: 'turnId و attemptId معتبر نیستند.'
          });
        }
        if (!operationTurnId) {
          return res.status(400).json({
            error: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'برای درخواست گفتگو turnId یا clientMessageId لازم است.'
          });
        }

        const normalizedUserMessage = rawMessage || (
          preliminaryIntent === 'image_understanding'
            ? 'لطفاً محتوای عکس را توضیح بده.'
            : '📷 عکس ارسال شد'
        );
        const existingTurn = await chatTurnsRepository.getTurn(operationTurnId);
        if (existingTurn && String(existingTurn.user_id) !== authenticatedUserId) {
          return res.status(409).json({ error: 'TURN_ID_CONFLICT' });
        }
        if (existingTurn?.status === 'completed') {
          const replayReply = String(existingTurn.reply || '');
          if (wantsStream) {
            openStreamResponse(res);
            writeStreamEvent(res, {
              type: 'meta',
              status: 'streaming',
              turnId: operationTurnId,
              attemptId,
              intent: existingTurn.intent,
              imageStudioRedirect: false,
              replay: true
            });
            writeStreamEvent(res, {
              type: 'delta',
              turnId: operationTurnId,
              attemptId,
              delta: replayReply
            });
            writeStreamEvent(res, {
              type: 'done',
              status: 'completed',
              turnId: operationTurnId,
              attemptId,
              intent: existingTurn.intent,
              reply: replayReply,
              conversationId: existingTurn.conversation_id,
              imageStudioRedirect: false,
              replay: true
            });
            return res.end();
          }
          return res.json({
            intent: existingTurn.intent,
            reply: replayReply,
            assistantText: replayReply,
            conversationId: existingTurn.conversation_id,
            messages: [],
            replay: true
          });
        }
        if (existingTurn?.status === 'streaming') {
          return res.status(409).json({
            error: 'TURN_IN_PROGRESS',
            message: 'این پاسخ هنوز در حال تولید است.'
          });
        }

        const isTerminalRetry = Boolean(
          existingTurn &&
          (existingTurn.status === 'failed' || existingTurn.status === 'cancelled')
        );
        if (isTerminalRetry && !STREAM_ID_PATTERN.test(String(attemptId || ''))) {
          return res.status(409).json({
            error: 'NEW_ATTEMPT_ID_REQUIRED',
            message: 'برای تلاش دوباره attemptId جدید لازم است.'
          });
        }

        const { turn: preparedTurn, created } = await chatTurnsRepository.beginTurn({
          turnId: operationTurnId,
          userId: authenticatedUserId,
          conversationId,
          clientMessageId,
          userMessage: normalizedUserMessage,
          intent: preliminaryIntent
        });
        if (!created) {
          const claimed = typeof chatTurnsRepository.claimTurnForExecution === 'function'
            ? await chatTurnsRepository.claimTurnForExecution(operationTurnId)
            : false;
          if (!claimed) {
            return res.status(409).json({
              error: 'TURN_IN_PROGRESS',
              message: 'این پاسخ هنوز در حال تولید است.'
            });
          }
        }

        if (wantsStream) {
          await chatTurnsRepository.beginAttempt({ attemptId, turnId: operationTurnId });
        }

        const billingOperationId = isTerminalRetry
          ? `${operationTurnId}:${attemptId}`
          : operationTurnId;
        const billingReferenceId = isTerminalRetry ? attemptId : operationTurnId;
        let reservation;
        try {
          reservation = await reserveChatNoa({
            userId: authenticatedUserId,
            operationId: billingOperationId,
            referenceId: billingReferenceId,
            message: normalizedUserMessage,
            conversationId,
            imageIds,
            intent: preliminaryIntent
          });
          if (reservation.status === 'captured' || reservation.status === 'released') {
            const error = new Error('NOA_RESERVATION_NOT_EXECUTABLE');
            error.code = 'NOA_RESERVATION_NOT_EXECUTABLE';
            error.statusCode = 409;
            throw error;
          }
          if (typeof chatTurnsRepository.setNoaReservation === 'function') {
            await chatTurnsRepository.setNoaReservation(operationTurnId, reservation.reservationId);
          }
        } catch (billingError) {
          if (wantsStream) {
            await chatTurnsRepository.finishAttempt({
              attemptId,
              status: 'failed',
              errorCode: String(billingError?.code || 'NOA_RESERVE_FAILED')
            }).catch(() => undefined);
          }
          await chatTurnsRepository.markTurn({
            turnId: operationTurnId,
            status: 'failed',
            errorCode: String(billingError?.code || 'NOA_RESERVE_FAILED')
          }).catch(() => undefined);
          throw billingError;
        }

        preparedChatOperation = {
          turn: preparedTurn,
          created,
          isTerminalRetry,
          turnId: operationTurnId,
          attemptId: wantsStream ? String(attemptId) : '',
          normalizedUserMessage,
          preliminaryIntent,
          reservation
        };
        if (wantsStream) {
          streamPreflightReservation = reservation;
          streamPreflightTurnId = operationTurnId;
          streamPreflightAttemptId = String(attemptId);
        } else {
          nonStreamTurnId = operationTurnId;
          nonStreamReservation = reservation;
        }
      }

      let optimizedInput = {
        originalText: rawMessage,
        optimizedTextEn: rawMessage,
        needsClarification: false,
        clarificationQuestionFa: null,
        status: 'skipped',
        fallbackUsed: false
      };
      if (
        !shouldRedirectToImageStudio &&
        rawMessage &&
        inputOptimizerService &&
        typeof inputOptimizerService.optimizeInput === 'function'
      ) {
        optimizedInput = await inputOptimizerService.optimizeInput({
          text: rawMessage,
          operationId: String(turnId || clientMessageId || res.locals.requestId),
          operationType: 'chat',
          conversationId,
          turnId,
          attemptId,
          userId: authenticatedUserId || null,
          signal: null,
          hasImages: routeContext.hasCurrentImageAttachment
        });
      }
      if (optimizedInput.needsClarification) {
        const clarificationText = optimizedInput.clarificationQuestionFa;
        const captured = await captureChatNoa(preparedChatOperation.reservation.reservationId, {
          turnId: preparedChatOperation.turnId,
          attemptId: preparedChatOperation.attemptId || null,
          output: 'clarification'
        });
        if (wantsStream) {
          streamPreflightSettled = captured.status === 'captured';
          await chatTurnsRepository.finishAttempt({
            attemptId: preparedChatOperation.attemptId,
            status: 'completed'
          });
        } else {
          nonStreamOutputProduced = true;
          nonStreamCaptured = captured.status === 'captured';
        }
        await chatTurnsRepository.markTurn({
          turnId: preparedChatOperation.turnId,
          status: 'completed',
          reply: clarificationText,
          model: null
        });
        const payload = {
          intent: 'clarification', status: 'CLARIFICATION_REQUIRED', needsClarification: true,
          assistantText: clarificationText, clarificationQuestionFa: clarificationText
        };
        if (wantsStream) {
          openStreamResponse(res);
          writeStreamEvent(res, { type: 'meta', status: 'clarification_required', turnId: turnId || null, attemptId: attemptId || null, intent: 'clarification' });
          writeStreamEvent(res, { type: 'done', status: 'clarification_required', turnId: turnId || null, attemptId: attemptId || null, intent: 'clarification', reply: clarificationText });
          return res.end();
        }
        return res.json(payload);
      }
      const optimizedMessage = optimizedInput.optimizedTextEn || rawMessage;
      let intentResult = null;
      let routeResult = null;
      if (!shouldRedirectToImageStudio && intentRouterService && typeof intentRouterService.route === 'function') {
        routeResult = await intentRouterService.route({
          userMessage: optimizedMessage,
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
        intentResult = await detectChatIntent({
          message: rawMessage,
          hasAttachedImages: routeContext.hasCurrentImageAttachment,
          hasRecentImage: routeContext.hasPreviousUploadedImage || routeContext.hasPreviousGeneratedImage,
          classify: null
        });
        intentResult.metadata = { source: 'deterministic_image_route' };
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
          message: rawMessage,
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
      if (
        preparedChatOperation &&
        chatTurnsRepository &&
        typeof chatTurnsRepository.setIntent === 'function'
      ) {
        await chatTurnsRepository.setIntent(preparedChatOperation.turnId, intentResult.intent);
      }

      if (intentResult.intent === 'image_generation' || intentResult.intent === 'image_edit') {
        const trimmedMessage = typeof message === 'string' ? message.trim() : '';
        const prompt = optimizedMessage.replace(/^\/imagine\s+/i, '').trim();
        const isEdit = intentResult.intent === 'image_edit';
        const finalActionOperationId = normalizeOperationId(turnId || clientMessageId);
        if (!finalActionOperationId) {
          return res.status(400).json({
            error: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'برای درخواست تصویر turnId یا clientMessageId لازم است.'
          });
        }
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
          const task = await imageGenerationController.createImageTask(req, res, {
            prompt,
            originalPrompt: trimmedMessage || rawMessage,
            optimizerResult: optimizedInput,
            enhancedPrompt: '',
            imageInput: imageInput.urls,
            conversationId,
            idempotencyKey: `chat-image:${finalActionOperationId}`
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
            (imageError?.code === 'NOA_INSUFFICIENT_FUNDS'
              ? 'موجودی نوآ برای ساخت تصویر کافی نیست.'
              : 'ساخت تصویر انجام نشد. مشکل از سرویس تصویر بود، نه درخواست تو. دوباره امتحان کن.');
          const userId =
            imageError?.userId ||
            (await imageGenerationController.resolveUserContext(req, res).catch(() => ({ userId: '' }))).userId;
          const messages = await persistFailure({
            userId,
            assistantText,
            errorCode: payload.error || 'IMAGE_TASK_FAILED'
          });

          return res.status(Number(imageError?.statusCode) || 500).json({
            intent: intentResult.intent,
            status: 'ERROR',
            assistantText,
            error: payload.error || imageError?.code || 'IMAGE_TASK_FAILED',
            reason: payload.reason || null,
            messages,
            intentRouter: intentResult.metadata || null
          });
        }
      }

      if (intentResult.intent === 'video_generation') {
        if (preparedChatOperation?.reservation) {
          await releaseChatNoa(
            preparedChatOperation.reservation.reservationId,
            'routed_to_video_studio',
            { turnId: preparedChatOperation.turnId }
          ).catch(() => undefined);
          if (wantsStream && preparedChatOperation.attemptId) {
            await chatTurnsRepository.finishAttempt({
              attemptId: preparedChatOperation.attemptId,
              status: 'cancelled',
              errorCode: 'VIDEO_FINAL_ACTION_ROUTE_REQUIRED'
            }).catch(() => undefined);
            streamPreflightSettled = true;
          }
          await chatTurnsRepository.markTurn({
            turnId: preparedChatOperation.turnId,
            status: 'cancelled',
            errorCode: 'VIDEO_FINAL_ACTION_ROUTE_REQUIRED'
          }).catch(() => undefined);
          nonStreamReservation = null;
        }
        return res.status(409).json({
          error: 'VIDEO_FINAL_ACTION_ROUTE_REQUIRED',
          message: 'برای ساخت ویدیو، درخواست را در استودیوی ویدیو تکمیل کن.',
          videoStudioRedirect: true
        });
      }

      const titleOwnerId = String(authenticatedUserId).trim();
      const queueTitleGeneration = async () => {
        if (
          titleGenerationTask ||
          !titleOwnerId ||
          !conversationId ||
          !conversationTitleService ||
          typeof conversationTitleService.queue !== 'function' ||
          (!rawMessage && !routeContext.hasCurrentImageAttachment) ||
          intentResult.intent === 'image_understanding'
        ) {
          return titleGenerationTask;
        }
        await conversationsRepository.ensureConversation(titleOwnerId, conversationId, { title: '', messages: [] }).catch(() => null);
        titleGenerationTask = conversationTitleService.queue({
          userId: titleOwnerId,
          conversationId,
          originalText: rawMessage,
          optimizedTextEn: optimizedInput.optimizedTextEn || '',
          intent: intentResult.intent,
          requestType: intentResult.intent,
          visionSummary: ''
        }).catch(() => ({ status: 'failed', title: null }));
        return titleGenerationTask;
      };

      if (wantsStream) {
        if (!preparedChatOperation?.reservation) {
          const error = new Error('CHAT_NOA_PREFLIGHT_MISSING');
          error.code = 'CHAT_NOA_PREFLIGHT_MISSING';
          error.statusCode = 503;
          throw error;
        }
        const normalizedUserMessage = preparedChatOperation.normalizedUserMessage;
        const streamReservation = preparedChatOperation.reservation;

        await queueTitleGeneration();
        let streamOutputProduced = false;
        let streamCaptured = false;
        const captureStreamOutput = async () => {
          streamOutputProduced = true;
          if (streamCaptured) return;
          const captured = await captureChatNoa(streamReservation.reservationId, {
            turnId,
            attemptId,
            output: 'partial_or_complete'
          });
          streamCaptured = captured.status === 'captured';
          streamPreflightSettled = streamCaptured;
        };
        const providerAbort = new AbortController();
        const abortOnDisconnect = () => {
          if (!res.writableEnded) providerAbort.abort();
        };
        req.once('aborted', abortOnDisconnect);
        req.once('close', () => {
          if (req.aborted) abortOnDisconnect();
        });
        res.once('error', abortOnDisconnect);
        res.once('close', abortOnDisconnect);
        const streamSocket = req.socket || res.socket;
        if (streamSocket) {
          streamSocket.once('close', abortOnDisconnect);
          streamSocket.once('error', abortOnDisconnect);
          if (streamSocket.destroyed) providerAbort.abort();
        }
        openStreamResponse(res);
        if (req.aborted || res.destroyed) providerAbort.abort();
        if (!writeStreamEvent(res, {
          type: 'meta',
          status: 'streaming',
          turnId,
          attemptId,
          intent: intentResult.intent,
          imageStudioRedirect: shouldRedirectToImageStudio
        })) providerAbort.abort();

        if (titleGenerationTask) {
          void titleGenerationTask.then((titleResult) => {
            if (titleResult?.title && !res.destroyed && !res.writableEnded) {
              writeStreamEvent(res, { type: 'title', conversationId, title: titleResult.title, titleStatus: titleResult.status });
            }
          });
        }

        try {
          let streamResult;
          if (intentResult.intent === 'image_understanding') {
            streamResult = await imageUnderstandingService.streamAnalyzeChatImages({
              req,
              res,
              message: optimizedMessage || normalizedUserMessage,
              imageIds,
              history,
              requestId: res.locals.requestId,
              signal: providerAbort.signal,
              onDelta: async (delta) => {
                if (String(delta || '').length > 0) await captureStreamOutput();
                if (!writeStreamEvent(res, { type: 'delta', turnId, attemptId, delta })) providerAbort.abort();
              }
            });
            if (!titleGenerationTask && titleOwnerId && conversationTitleService && typeof conversationTitleService.queue === 'function') {
              titleGenerationTask = conversationTitleService.queue({
                userId: titleOwnerId,
                conversationId,
                originalText: rawMessage,
                optimizedTextEn: optimizedInput.optimizedTextEn || '',
                intent: intentResult.intent,
                requestType: intentResult.intent,
                // This ephemeral summary is never persisted as conversation history or memory.
                visionSummary: String(streamResult.answer || '').slice(0, 600)
              }).catch(() => ({ status: 'failed', title: null }));
              void titleGenerationTask.then((titleResult) => {
                if (titleResult?.title && !res.destroyed && !res.writableEnded) {
                  writeStreamEvent(res, { type: 'title', conversationId, title: titleResult.title, titleStatus: titleResult.status });
                }
              });
            }
            await aiService.persistVisionChatTurn({
              profile: effectiveProfile,
              conversationId,
              userMessage: rawMessage || normalizedUserMessage,
              assistantText: streamResult.answer,
              requestId: res.locals.requestId,
              clientMessageId,
              imageIds,
              diagnostics: streamResult.diagnostics,
              turnId
            });
            streamResult = { ...streamResult, reply: streamResult.answer };
          } else {
            streamResult = await aiService.streamChatMessage({
              message: optimizedMessage || normalizedUserMessage,
              originalMessage: rawMessage || normalizedUserMessage,
              profile: effectiveProfile,
              history,
              conversationId,
              imageIds,
              requestId: res.locals.requestId,
              turnId,
              signal: providerAbort.signal,
              onDelta: async (delta) => {
                if (String(delta || '').length > 0) await captureStreamOutput();
                if (!writeStreamEvent(res, { type: 'delta', turnId, attemptId, delta })) providerAbort.abort();
              }
            });
          }

          if (providerAbort.signal.aborted || req.aborted || res.destroyed) {
            const abortError = new Error('PROVIDER_REQUEST_ABORTED');
            abortError.code = 'PROVIDER_REQUEST_ABORTED';
            throw abortError;
          }

          if (String(streamResult.reply || '').length > 0) {
            await captureStreamOutput();
          }
          if (!streamOutputProduced) {
            const emptyError = new Error('EMPTY_UPSTREAM_REPLY');
            emptyError.code = 'EMPTY_UPSTREAM_REPLY';
            throw emptyError;
          }
          await chatTurnsRepository.markTurn({
            turnId,
            status: 'completed',
            reply: streamResult.reply,
            model: streamResult.model,
            tokenUsage: streamResult.tokenUsage
          });
          await chatTurnsRepository.finishAttempt({ attemptId, status: 'completed' });
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
          if (streamOutputProduced) {
            await captureChatNoa(streamReservation.reservationId, {
              turnId,
              attemptId,
              output: 'partial',
              terminalStatus: status
            }).then((snapshot) => {
              streamPreflightSettled = snapshot.status === 'captured';
            }).catch(async (captureError) => {
              await errorsRepository.logError(
                'noa_stream_capture_failed',
                '/api/chat',
                null,
                String(captureError?.message || captureError)
              ).catch(() => undefined);
            });
          } else {
            await releaseChatNoa(streamReservation.reservationId, status, {
              turnId,
              attemptId,
              errorCode
            }).then((snapshot) => {
              streamPreflightSettled = snapshot.status === 'released';
            }).catch(async (releaseError) => {
              await errorsRepository.logError(
                'noa_stream_release_failed',
                '/api/chat',
                null,
                String(releaseError?.message || releaseError)
              ).catch(() => undefined);
            });
          }
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

      if (!preparedChatOperation?.reservation || !nonStreamReservation) {
        const error = new Error('CHAT_NOA_PREFLIGHT_MISSING');
        error.code = 'CHAT_NOA_PREFLIGHT_MISSING';
        error.statusCode = 503;
        throw error;
      }
      await queueTitleGeneration();

      if (intentResult.intent === 'image_understanding') {
        try {
          const visionResult = await imageUnderstandingService.analyzeChatImages({
            req,
            res,
            message: optimizedMessage || rawMessage,
            imageIds,
            history,
            requestId: res.locals.requestId
          });
          if (!titleGenerationTask && titleOwnerId && conversationTitleService && typeof conversationTitleService.queue === 'function') {
            titleGenerationTask = conversationTitleService.queue({
              userId: titleOwnerId,
              conversationId,
              originalText: rawMessage,
              optimizedTextEn: optimizedInput.optimizedTextEn || '',
              intent: intentResult.intent,
              requestType: intentResult.intent,
              visionSummary: String(visionResult.answer || '').slice(0, 600)
            }).catch(() => ({ status: 'failed', title: null }));
          }
          const userVisionPrompt =
            typeof message === 'string' && message.trim() ? message.trim() : 'لطفاً محتوای عکس را توضیح بده.';
          const composedResult = await aiService.composeVisionChatReply({
            profile: effectiveProfile,
            conversationId,
            userMessage: optimizedMessage || userVisionPrompt,
            visionAnalysis: visionResult.answer,
            requestId: res.locals.requestId
          });
          const finalAssistantText = composedResult.reply;
          nonStreamOutputProduced = String(finalAssistantText || '').length > 0;
          if (!nonStreamOutputProduced) {
            const emptyError = new Error('EMPTY_UPSTREAM_REPLY');
            emptyError.code = 'EMPTY_UPSTREAM_REPLY';
            throw emptyError;
          }
          const captured = await captureChatNoa(nonStreamReservation.reservationId, {
            turnId: nonStreamTurnId,
            output: 'complete',
            intent: 'image_understanding'
          });
          nonStreamCaptured = captured.status === 'captured';
          const persisted = await aiService.persistVisionChatTurn({
            profile: effectiveProfile,
            conversationId,
            userMessage: rawMessage || userVisionPrompt,
            assistantText: finalAssistantText,
            requestId: res.locals.requestId,
            clientMessageId,
            imageIds,
            diagnostics: {
              ...visionResult.diagnostics,
              visionModel: visionResult.model || visionResult.diagnostics?.model || null,
              chatModel: composedResult.model || null,
              chatResponseTimeMs: composedResult.responseTimeMs
            }
          });

          await chatTurnsRepository.markTurn({
            turnId: nonStreamTurnId,
            status: 'completed',
            reply: finalAssistantText,
            model: composedResult.model || visionResult.model || null
          });

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
            }
          }).catch(() => ({ messages: [] }));
          if (nonStreamReservation && !nonStreamOutputProduced) {
            await releaseChatNoa(nonStreamReservation.reservationId, 'vision_failed', {
              turnId: nonStreamTurnId,
              errorCode: visionError?.code || 'VISION_ANALYZE_FAILED'
            }).catch(() => undefined);
          }
          await chatTurnsRepository.markTurn({
            turnId: nonStreamTurnId,
            status: 'failed',
            errorCode: visionError?.code || 'VISION_ANALYZE_FAILED'
          }).catch(() => undefined);
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
        message: optimizedMessage || rawMessage,
        originalMessage: rawMessage,
        profile: effectiveProfile,
        history,
        conversationId,
        imageIds,
        requestId: res.locals.requestId
      });

      nonStreamOutputProduced = String(result?.reply || '').length > 0;
      if (!nonStreamOutputProduced) {
        const emptyError = new Error('EMPTY_UPSTREAM_REPLY');
        emptyError.code = 'EMPTY_UPSTREAM_REPLY';
        throw emptyError;
      }
      const captured = await captureChatNoa(nonStreamReservation.reservationId, {
        turnId: nonStreamTurnId,
        output: 'complete',
        intent: 'chat'
      });
      nonStreamCaptured = captured.status === 'captured';
      await chatTurnsRepository.markTurn({
        turnId: nonStreamTurnId,
        status: 'completed',
        reply: result?.reply || '',
        model: result?.model || null,
        tokenUsage: result?.tokenUsage || null
      });

      return res.json({
        ...result,
        imageStudioRedirect: shouldRedirectToImageStudio,
        intentRouter: intentResult.metadata || null
      });
    } catch (error) {
      if (streamPreflightReservation && !streamPreflightSettled) {
        await releaseChatNoa(streamPreflightReservation.reservationId, 'chat_preflight_failed', {
          turnId: streamPreflightTurnId,
          attemptId: streamPreflightAttemptId,
          errorCode: String(error?.code || 'CHAT_PREFLIGHT_FAILED')
        }).then((snapshot) => {
          streamPreflightSettled = snapshot.status === 'released';
        }).catch(async (releaseError) => {
          await errorsRepository.logError(
            'noa_chat_preflight_release_failed',
            '/api/chat',
            null,
            String(releaseError?.message || releaseError)
          ).catch(() => undefined);
        });
        if (chatTurnsRepository) {
          await chatTurnsRepository.finishAttempt({
            attemptId: streamPreflightAttemptId,
            status: 'failed',
            errorCode: String(error?.code || 'CHAT_PREFLIGHT_FAILED')
          }).catch(() => undefined);
          await chatTurnsRepository.markTurn({
            turnId: streamPreflightTurnId,
            status: 'failed',
            errorCode: String(error?.code || 'CHAT_PREFLIGHT_FAILED')
          }).catch(() => undefined);
        }
      }
      if (nonStreamReservation && !nonStreamCaptured) {
        if (nonStreamOutputProduced) {
          await captureChatNoa(nonStreamReservation.reservationId, {
            turnId: nonStreamTurnId,
            output: 'produced_before_failure',
            terminalStatus: 'failed'
          }).then((snapshot) => {
            nonStreamCaptured = snapshot.status === 'captured';
          }).catch(async (captureError) => {
            await errorsRepository.logError(
              'noa_chat_capture_failed',
              '/api/chat',
              null,
              String(captureError?.message || captureError)
            ).catch(() => undefined);
          });
        } else {
          await releaseChatNoa(nonStreamReservation.reservationId, 'chat_failed', {
            turnId: nonStreamTurnId,
            errorCode: String(error?.code || 'CHAT_FAILED')
          }).catch(async (releaseError) => {
            await errorsRepository.logError(
              'noa_chat_release_failed',
              '/api/chat',
              null,
              String(releaseError?.message || releaseError)
            ).catch(() => undefined);
          });
        }
        if (nonStreamTurnId && chatTurnsRepository) {
          await chatTurnsRepository.markTurn({
            turnId: nonStreamTurnId,
            status: 'failed',
            errorCode: String(error?.code || 'CHAT_FAILED')
          }).catch(() => undefined);
        }
      }

      const noaPayload = getNoaErrorPayload(error);
      if (noaPayload) {
        return res.status(Number(error?.statusCode || error?.status) || 500).json(noaPayload);
      }

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
