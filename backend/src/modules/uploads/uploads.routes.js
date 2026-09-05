const express = require('express');
const rateLimit = require('express-rate-limit');
const fs = require('fs-extra');
const { getDefaultUploadOwnershipRepository } = require('./upload-ownership.repository');
const { validateImageBuffer } = require('./image-file-security');

function createUploadRateLimiter({ windowMs = 60 * 1000, max = 20 } = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.user?.id || 'authenticated-user'),
    message: { error: 'تعداد آپلودها زیاد است. کمی بعد دوباره تلاش کنید.', code: 'UPLOAD_RATE_LIMITED' }
  });
}

async function readUploadedFileBuffer(file) {
  if (Buffer.isBuffer(file?.buffer)) return file.buffer;
  if (file?.path) return fs.readFile(file.path);
  const error = new Error('UPLOAD_CONTENT_UNAVAILABLE');
  error.code = 'UPLOAD_CONTENT_UNAVAILABLE';
  throw error;
}

async function removeUploadedFiles(files) {
  await Promise.all((Array.isArray(files) ? files : []).map((file) =>
    file?.path ? fs.remove(file.path).catch(() => undefined) : undefined
  ));
}

function createUploadsReadRouter({ requireAuthenticated, getUploadedImageById, ownershipRepository = null }) {
  if (typeof requireAuthenticated !== 'function') {
    throw new Error('requireAuthenticated is required');
  }
  if (typeof getUploadedImageById !== 'function') {
    throw new Error('getUploadedImageById is required');
  }

  const ownership = ownershipRepository || getDefaultUploadOwnershipRepository();
  const router = express.Router();
  const configuredRate = Number.parseInt(String(process.env.UPLOAD_IMAGE_RATE_LIMIT_PER_MINUTE || '20'), 10);
  const uploadLimiter = createUploadRateLimiter({ max: Number.isInteger(configuredRate) && configuredRate > 0 ? configuredRate : 20 });

  router.get('/images/:imageId', requireAuthenticated, async (req, res, next) => {
    try {
      const imageId = String(req.params.imageId || '');
      const userId = typeof req.user?.id === 'string' || typeof req.user?.id === 'number'
        ? String(req.user.id).trim()
        : '';
      if (!userId || !(await ownership.isOwnedBy(imageId, userId))) {
        return res.status(404).json({ error: 'تصویر پیدا نشد.', code: 'UPLOAD_NOT_FOUND' });
      }

      const image = await getUploadedImageById(imageId);
      if (!image) {
        return res.status(404).json({ error: 'تصویر پیدا نشد.', code: 'UPLOAD_NOT_FOUND' });
      }

      res.setHeader('Content-Type', image.mimeType);
      res.setHeader('Cache-Control', 'private, no-store');
      return res.send(Buffer.from(image.base64, 'base64'));
    } catch (error) {
      return next(error);
    }
  });

  router.use('/images', requireAuthenticated, (req, res, next) => {
    if (String(req.method || '').toUpperCase() !== 'POST') return next();
    return uploadLimiter(req, res, next);
  });

  router.use('/images', (req, res, next) => {
    if (String(req.method || '').toUpperCase() !== 'POST') return next();

    const originalJson = res.json.bind(res);
    res.json = (payload) => {
      const images = Array.isArray(payload?.images) ? payload.images : [];
      const imageIds = images.map((image) => image?.imageId).filter(Boolean);
      if (imageIds.length === 0) return originalJson(payload);

      const userId = typeof req.user?.id === 'string' || typeof req.user?.id === 'number'
        ? String(req.user.id).trim()
        : '';
      const files = Array.isArray(req.files) ? req.files : [];
      res.json = originalJson;

      void (async () => {
        try {
          if (!userId || files.length !== imageIds.length) {
            const error = new Error('UPLOAD_CONTENT_UNAVAILABLE');
            error.code = 'UPLOAD_CONTENT_UNAVAILABLE';
            throw error;
          }
          for (const file of files) {
            const buffer = await readUploadedFileBuffer(file);
            validateImageBuffer(buffer, file.mimetype);
          }
          await ownership.registerMany({ imageIds, userId });
          return originalJson(payload);
        } catch (error) {
          await removeUploadedFiles(files);
          if (res.headersSent) return undefined;
          if (error?.code === 'UNSUPPORTED_IMAGE_FORMAT') {
            res.status(400);
            return originalJson({ error: 'محتوای فایل تصویر معتبر نیست.', code: 'INVALID_IMAGE_CONTENT' });
          }
          res.status(500);
          return originalJson({ error: 'ذخیره امن تصویر انجام نشد.', code: 'UPLOAD_OWNERSHIP_PERSIST_FAILED' });
        }
      })();
      return res;
    };

    return next();
  });

  return router;
}

module.exports = {
  createUploadsReadRouter,
  createUploadRateLimiter,
  readUploadedFileBuffer
};
