const express = require('express');

/**
 * Serves a chat upload only after the caller has been authenticated. Upload
 * identifiers are deliberately not treated as credentials: persisted chat
 * messages can contain their URL, so the access check must happen here.
 */
function createUploadsReadRouter({ requireAuthenticated, getUploadedImageById }) {
  if (typeof requireAuthenticated !== 'function') {
    throw new Error('requireAuthenticated is required');
  }
  if (typeof getUploadedImageById !== 'function') {
    throw new Error('getUploadedImageById is required');
  }

  const router = express.Router();
  router.get('/images/:imageId', requireAuthenticated, async (req, res, next) => {
    try {
      const userId = typeof req.user?.id === 'string' || typeof req.user?.id === 'number'
        ? String(req.user.id).trim()
        : '';
      const image = await getUploadedImageById(String(req.params.imageId || ''), userId);
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

  return router;
}

module.exports = { createUploadsReadRouter };
