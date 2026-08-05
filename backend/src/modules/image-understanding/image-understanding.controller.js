const { createHash, randomUUID } = require('crypto');
const { parseDataImageUrl } = require('./image-understanding.service');
const { NOA_ACTIONS } = require('../noa/noa.constants');

const publicVisionErrorMessage = (error) => {
  const code = error?.code || error?.message;
  if (code === 'VISION_DISABLED') return 'خواندن تصویر در حال حاضر غیرفعال است.';
  if (code === 'IMAGE_NOT_FOUND') return 'تصویر پیدا نشد. لطفاً دوباره عکس را بفرست.';
  if (code === 'UNSUPPORTED_IMAGE_FORMAT') return 'این فرمت تصویر پشتیبانی نمی‌شود. لطفاً jpg، png یا webp بفرست.';
  if (code === 'IMAGE_TOO_LARGE') return 'حجم تصویر زیاد است. لطفاً یک تصویر سبک‌تر بفرست.';
  if (code === 'VISION_TIMEOUT') return 'خواندن تصویر کمی طول کشید و کامل نشد. لطفاً یک عکس واضح‌تر یا سبک‌تر بفرست.';
  if (code === 'API_KEY_MISSING') return 'کلید سرویس خواندن تصویر تنظیم نشده است.';
  if (code === 'AUTHENTICATION_REQUIRED') return 'برای خواندن تصویر ابتدا وارد حساب کاربری شوید.';
  if (code === 'NOA_INSUFFICIENT_FUNDS') return 'موجودی نوآ برای خواندن تصویر کافی نیست.';
  if (code === 'NOA_BILLING_NOT_CONFIGURED') return 'سرویس پرداخت نوآ موقتاً در دسترس نیست.';
  return 'الان نتوانستم تصویر را درست بخوانم. لطفاً دوباره امتحان کن.';
};

function createImageUnderstandingController({
  imageUnderstandingService,
  noaBillingService,
  principalResolver
}) {
  const requireAuthenticatedUser = async (req) => {
    if (!principalResolver || typeof principalResolver.resolve !== 'function') {
      const error = new Error('NOA_AUTH_REQUIRED');
      error.code = 'NOA_AUTH_REQUIRED';
      error.statusCode = 503;
      throw error;
    }

    const resolution = await principalResolver.resolve(req);
    const userId = resolution?.principal?.userId ? String(resolution.principal.userId).trim() : '';
    if (resolution?.error || !userId) {
      const error = new Error(resolution?.error || 'AUTHENTICATION_REQUIRED');
      error.code = resolution?.error || 'AUTHENTICATION_REQUIRED';
      error.statusCode = 401;
      throw error;
    }
    return userId;
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

  const operationIdFor = (req, res) => {
    const headerValue = typeof req.get === 'function' ? req.get('Idempotency-Key') : req.headers?.['idempotency-key'];
    const candidate = headerValue || req.body?.idempotencyKey || res.locals?.requestId || randomUUID();
    return String(candidate).trim().slice(0, 191) || randomUUID();
  };

  const payloadHashFor = ({ userId, operationId, prompt, images }) => createHash('sha256')
    .update(JSON.stringify({
      actionKey: NOA_ACTIONS.IMAGE_UNDERSTANDING,
      userId,
      operationId,
      prompt: String(prompt || ''),
      images: images.map((image) => ({
        id: String(image.id || ''),
        mimeType: String(image.mimeType || ''),
        size: Number(image.size || image.buffer?.length || 0)
      }))
    }))
    .digest('hex');

  const collectRequestImages = async (req, res) => {
    const images = [];
    for (const file of Array.isArray(req.files) ? req.files : []) {
      images.push({
        id: file.originalname,
        source: 'upload',
        mimeType: file.mimetype,
        buffer: file.buffer,
        originalName: file.originalname
      });
    }

    const bodyImages = Array.isArray(req.body?.images) ? req.body.images : [];
    for (const item of bodyImages) {
      if (typeof item?.dataUrl === 'string') {
        const parsed = parseDataImageUrl(item.dataUrl);
        if (parsed) {
          images.push({
            id: item.id || 'data-url',
            source: 'inline',
            mimeType: parsed.mimeType,
            buffer: parsed.buffer,
            originalName: item.name || 'image'
          });
        }
      }
      if (typeof item?.base64 === 'string' && typeof item?.mimeType === 'string') {
        images.push({
          id: item.id || 'base64',
          source: 'inline',
          mimeType: item.mimeType,
          base64: item.base64,
          originalName: item.name || 'image'
        });
      }
    }

    if (images.length === 0) {
      const resolved = await imageUnderstandingService.resolveImagesForChat({
        req,
        res,
        imageIds: req.body?.imageIds,
        history: req.body?.history
      });
      images.push(...resolved);
    }

    return images;
  };

  const analyze = async (req, res) => {
    let reservation = null;
    let analysisCompleted = false;
    try {
      const userId = await requireAuthenticatedUser(req);
      const prompt = typeof req.body?.prompt === 'string'
        ? req.body.prompt
        : typeof req.body?.message === 'string' ? req.body.message : '';
      const images = await collectRequestImages(req, res);
      const operationId = operationIdFor(req, res);
      reservation = await requireNoaBillingService().reserve({
        userId,
        actionKey: NOA_ACTIONS.IMAGE_UNDERSTANDING,
        quantity: images.length,
        idempotencyKey: `image_analysis:${operationId}`,
        payloadHash: payloadHashFor({ userId, operationId, prompt, images }),
        referenceType: 'image_analysis',
        referenceId: operationId,
        expiresAt: new Date(Date.now() + (30 * 60 * 1000)),
        actorType: 'user',
        metadata: { imageCount: images.length, feature: 'image_analysis' }
      });
      if (reservation.status === 'captured' || reservation.status === 'released') {
        const error = new Error('NOA_RESERVATION_NOT_EXECUTABLE');
        error.code = 'NOA_RESERVATION_NOT_EXECUTABLE';
        error.statusCode = 409;
        throw error;
      }
      const result = await imageUnderstandingService.analyzeImages({
        userPrompt: prompt,
        images,
        requestId: res.locals.requestId,
        transport: req.body?.transport
      });
      analysisCompleted = true;
      await requireNoaBillingService().capture(reservation.reservationId, {
        actorType: 'user',
        metadata: { feature: 'image_analysis', imageCount: images.length, model: result.model || null }
      });
      return res.json({
        success: true,
        intent: 'image_understanding',
        reply: result.answer,
        diagnostics: result.diagnostics
      });
    } catch (error) {
      if (reservation?.reservationId && !analysisCompleted) {
        await requireNoaBillingService().release(reservation.reservationId, {
          reason: 'image_analysis_failed',
          actorType: 'system',
          metadata: { errorCode: error?.code || 'VISION_ANALYZE_FAILED' }
        }).catch(() => undefined);
      }
      const status = error?.statusCode || (
        error?.code === 'IMAGE_NOT_FOUND' ? 404 :
        error?.code === 'UNSUPPORTED_IMAGE_FORMAT' ? 400 :
        error?.code === 'IMAGE_TOO_LARGE' ? 413 :
        error?.code === 'VISION_TIMEOUT' ? 504 :
        error?.code === 'API_KEY_MISSING' ? 500 :
        502
      );
      return res.status(status).json({
        success: false,
        error: error?.code || 'VISION_ANALYZE_FAILED',
        message: publicVisionErrorMessage(error)
      });
    }
  };

  const dryRun = async (req, res) => {
    try {
      const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : '';
      const result = await imageUnderstandingService.makeDryRun({
        prompt,
        settingsOverride: req.body?.settings,
        transport: req.body?.transport
      });
      return res.json({
        success: true,
        mode: 'dry-run',
        model: result.model,
        transport: result.transport,
        endpoint: result.endpoint,
        adapter: result.adapter,
        requestBody: result.requestBody
      });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Dry-run خواندن تصویر ناموفق بود.' });
    }
  };

  return {
    analyze,
    dryRun,
    publicVisionErrorMessage
  };
}

module.exports = {
  createImageUnderstandingController,
  publicVisionErrorMessage
};
