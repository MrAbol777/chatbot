'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const { randomUUID } = require('crypto');
const { createVideoInputMediaRepository } = require('./video-input-media.repository');
const { createVideoInputMediaStorage } = require('./video-input-media.storage');
const { createVideoProviderInputGateway } = require('./video-provider-input.gateway');
const { validateVideoInputImage } = require('./video-input-media.validator');

function createVideoInputMediaModule({ db, env = process.env }) {
  const maxBytes = Number(env.VIDEO_INPUT_MAX_BYTES || 5 * 1024 * 1024);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > 25 * 1024 * 1024) throw new Error('VIDEO_INPUT_MAX_BYTES is invalid.');
  const repository = createVideoInputMediaRepository(db);
  const storage = createVideoInputMediaStorage({ root: env.VIDEO_INPUT_STORAGE_ROOT || path.join(__dirname, '../../../../storage/video-inputs') });
  const gateway = createVideoProviderInputGateway({ secret: env.VIDEO_PROVIDER_INPUT_SIGNING_SECRET, publicBaseUrl: env.VIDEO_PROVIDER_INPUT_PUBLIC_BASE_URL, ttlSeconds: Number(env.VIDEO_PROVIDER_INPUT_TTL_SECONDS || 300) });
  const upload = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: maxBytes } }).single('file');
  const publicRouter = express.Router();

  const uploadHandler = async (req, res) => {
    let stored = null;
    try {
      const userId = String(req.user?.id || '');
      if (!userId || !req.file) return res.status(400).json({ error: 'VIDEO_INPUT_MEDIA_REQUIRED' });
      const validated = validateVideoInputImage(req.file.buffer, req.file.mimetype, maxBytes);
      stored = await storage.store({ buffer: req.file.buffer, mimeType: validated.mimeType });
      const id = randomUUID();
      await repository.create({ id, userId, storageKey: stored.storageKey, originalFilename: String(req.file.originalname || '').slice(0, 255) || null, mimeType: validated.mimeType, sizeBytes: stored.sizeBytes, sha256: stored.sha256, expiresAt: new Date(Date.now() + Number(env.VIDEO_INPUT_RETENTION_MINUTES || 60) * 60_000) });
      return res.status(201).json({ mediaId: id, mimeType: validated.mimeType, sizeBytes: stored.sizeBytes });
    } catch (error) {
      if (stored?.storageKey) await storage.remove(stored.storageKey).catch(() => {});
      return res.status(error.status || 400).json({ error: error.code || 'VIDEO_INPUT_MEDIA_UPLOAD_FAILED' });
    }
  };

  publicRouter.get('/:opaqueToken/:filename?', async (req, res) => {
    try {
      const claims = gateway.verify(req.params.opaqueToken);
      if (claims.filename && req.params.filename !== claims.filename) return res.status(404).end();
      const media = await repository.getForProvider(claims);
      if (!media) return res.status(404).end();
      res.set({ 'Content-Type': media.mime_type, 'Content-Length': String(media.size_bytes), 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `inline; filename="${claims.filename || 'input.jpg'}"` });
      const stream = storage.createReadStream(media.storage_key);
      stream.once('error', () => { if (!res.headersSent) res.status(404); res.end(); });
      stream.pipe(res);
    } catch (_) { return res.status(404).end(); }
  });

  return { upload, uploadHandler, publicRouter, gateway, repository, storage };
}

module.exports = { createVideoInputMediaModule };
