const { parseDataImageUrl } = require('./image-understanding.service');

const publicVisionErrorMessage = (error) => {
  const code = error?.code || error?.message;
  if (code === 'VISION_DISABLED') return 'خواندن تصویر در حال حاضر غیرفعال است.';
  if (code === 'IMAGE_NOT_FOUND') return 'تصویر پیدا نشد. لطفاً دوباره عکس را بفرست.';
  if (code === 'UNSUPPORTED_IMAGE_FORMAT') return 'این فرمت تصویر پشتیبانی نمی‌شود. لطفاً jpg، png یا webp بفرست.';
  if (code === 'IMAGE_TOO_LARGE') return 'حجم تصویر زیاد است. لطفاً یک تصویر سبک‌تر بفرست.';
  if (code === 'VISION_TIMEOUT') return 'خواندن تصویر کمی طول کشید و کامل نشد. لطفاً یک عکس واضح‌تر یا سبک‌تر بفرست.';
  if (code === 'API_KEY_MISSING') return 'کلید سرویس خواندن تصویر تنظیم نشده است.';
  return 'الان نتوانستم تصویر را درست بخوانم. لطفاً دوباره امتحان کن.';
};

function createImageUnderstandingController({ imageUnderstandingService }) {
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
    try {
      const prompt = typeof req.body?.prompt === 'string'
        ? req.body.prompt
        : typeof req.body?.message === 'string' ? req.body.message : '';
      const images = await collectRequestImages(req, res);
      const result = await imageUnderstandingService.analyzeImages({
        userPrompt: prompt,
        images,
        requestId: res.locals.requestId,
        transport: req.body?.transport
      });
      return res.json({
        success: true,
        intent: 'image_understanding',
        reply: result.answer,
        diagnostics: result.diagnostics
      });
    } catch (error) {
      const status =
        error?.code === 'IMAGE_NOT_FOUND' ? 404 :
        error?.code === 'UNSUPPORTED_IMAGE_FORMAT' ? 400 :
        error?.code === 'IMAGE_TOO_LARGE' ? 413 :
        error?.code === 'VISION_TIMEOUT' ? 504 :
        error?.code === 'API_KEY_MISSING' ? 500 :
        502;
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
