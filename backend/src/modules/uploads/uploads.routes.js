const express = require('express');
const fs = require('fs-extra');
const { getDefaultUploadOwnershipRepository } = require('./upload-ownership.repository');

/**
 * Serves a chat upload only after the caller has been authenticated. Upload
 * identifiers are deliberately not treated as credentials: persisted chat
 * messages can contain their URL, so the access check must happen here.
 */
function createUploadsReadRouter({ requireAuthenticated, getUploadedImageById, ownershipRepository = null }) {
  if (typeof requireAuthenticated !== 'function') {
    throw new Error('requireAuthenticated is required');
  }
  if (typeof getUploadedImageById !== 'function') {
    throw new Error('getUploadedImageById is required');
  }

  const ownership = ownershipRepository || getDefaultUploadOwnershipRepository();
  const router = express.Router();

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

  // This router is mounted before the actual multer POST handler in app.js.
  // Wrap the success response so ownership metadata is persisted before the
  // client receives an imageId. If persistence fails, remove the uploaded files
  // and fail closed instead of creating an ownerless private object.
  router.use('/images', requireAuthenticated, (req, res, next) => {
    if (String(req.method || '').toUpperCase() !== 'POST') return next();

    const originalJson = res.json.bind(res);
    res.json = (payload) => {
      const images = Array.isArray(payload?.images) ? payload.images : [];
      const imageIds = images.map((image) => image?.imageId).filter(Boolean);
      if (imageIds.length === 0) return originalJson(payload);

      const userId = typeof req.user?.id === 'string' || typeof req.user?.id === 'number'
        ? String(req.user.id).trim()
        : '';
      res.json = originalJson;

      void ownership.registerMany({ imageIds, userId })
        .then(() => originalJson(payload))
        .catch(async () => {
          const files = Array.isArray(req.files) ? req.files : [];
          await Promise.all(files.map((file) => file?.path ? fs.remove(file.path).catch(() => undefined) : undefined));
          if (!res.headersSent) {
            res.status(500);
            originalJson({ error: 'ذخیره امن تصویر انجام نشد.', code: 'UPLOAD_OWNERSHIP_PERSIST_FAILED' });
          }
        });
      return res;
    };

    return next();
  });

  return router;
}

module.exports = { createUploadsReadRouter };
