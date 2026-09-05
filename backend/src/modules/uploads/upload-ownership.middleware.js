'use strict';

const { getDefaultUploadOwnershipRepository } = require('./upload-ownership.repository');

const UPLOAD_PATH_PATTERN = /^\/api\/uploads?\/images\/([^/?#]+)/i;

const decodeImageIdFromUrl = (value) => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  try {
    const parsed = new URL(raw, 'https://danoa.ir');
    const match = parsed.pathname.match(UPLOAD_PATH_PATTERN);
    return match ? decodeURIComponent(match[1]) : '';
  } catch {
    return '';
  }
};

const collectUploadImageIds = (body = {}) => {
  const ids = [];
  const push = (value) => {
    if (typeof value === 'string' || typeof value === 'number') ids.push(String(value).trim());
  };

  for (const imageId of Array.isArray(body.imageIds) ? body.imageIds : []) push(imageId);

  const history = Array.isArray(body.history) ? body.history : [];
  for (const item of history) {
    const urls = [item?.imageUrl, item?.resultUrl];
    if (Array.isArray(item?.images)) {
      for (const image of item.images) urls.push(typeof image === 'string' ? image : image?.url);
    }
    for (const url of urls) {
      const imageId = decodeImageIdFromUrl(url);
      if (imageId) push(imageId);
    }
  }

  return [...new Set(ids.filter(Boolean))];
};

function createUploadOwnershipGuard({ principalResolver, uploadedImagesRepository }) {
  const ownershipRepository = uploadedImagesRepository?.areOwnedBy
    ? uploadedImagesRepository
    : getDefaultUploadOwnershipRepository();

  return async (req, res, next) => {
    try {
      const imageIds = collectUploadImageIds(req.body || {});
      if (imageIds.length === 0) return next();
      if (!principalResolver?.resolve || !ownershipRepository?.areOwnedBy) {
        return res.status(503).json({ error: 'UPLOAD_OWNERSHIP_CHECK_UNAVAILABLE' });
      }

      const resolution = await principalResolver.resolve(req);
      const userId = resolution?.principal?.userId ? String(resolution.principal.userId).trim() : '';
      if (resolution?.error || !userId) {
        return res.status(401).json({ error: resolution?.error || 'AUTHENTICATION_REQUIRED' });
      }

      const allowed = await ownershipRepository.areOwnedBy(imageIds, userId);
      if (!allowed) {
        // Deliberately use 404 so callers cannot distinguish another user's
        // private upload from a nonexistent identifier.
        return res.status(404).json({ error: 'IMAGE_NOT_FOUND' });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  createUploadOwnershipGuard,
  collectUploadImageIds,
  decodeImageIdFromUrl
};
