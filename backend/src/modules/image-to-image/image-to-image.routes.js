'use strict';

const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { createRequirePrincipal } = require('../auth/principal');
const { createImageToImageRepository } = require('./image-to-image.repository');
const { createImageToImageStorage } = require('./image-to-image.storage');
const { createImageToImageService } = require('./image-to-image.service');
const { createMetisImageToImageProvider } = require('./providers/metis-image-to-image.provider');

function createImageToImageRouter({ db, httpClient, noaBillingService, principalResolver, config }) {
  const router = express.Router();
  const requirePrincipal = createRequirePrincipal(principalResolver);
  const upload = multer({ storage: multer.memoryStorage(), limits: { files: 4, fileSize: config.maxInputBytes }, fileFilter: (_req, file, callback) => callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) });
  const repository = createImageToImageRepository(db, { noaBillingService });
  const storage = createImageToImageStorage({ rootDirectory: config.storageDir, maxBytes: config.maxInputBytes });
  const provider = createMetisImageToImageProvider({ httpClient, baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, resolution: config.resolution, outputFormat: config.outputFormat, pollTimeoutMs: config.pollTimeoutMs, pollIntervalMs: config.pollIntervalSeconds * 1000, maxResultBytes: config.maxResultBytes, allowedResultHosts: config.resultAllowedHosts });
  const service = createImageToImageService({ repository, storage, noaBillingService, config });
  const limiter = rateLimit({ windowMs: 60_000, max: 8, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => String(req.user?.id || req.ip) });
  const sendError = (res, error) => res.status(error?.status || 500).json({ error: error?.code || 'IMAGE_TO_IMAGE_INTERNAL_ERROR', message: error?.status ? error.message : 'خطای داخلی در ویرایش تصویر.' });

  router.get('/options', requirePrincipal, async (_req, res) => { try { res.json(await service.options()); } catch (error) { sendError(res, error); } });
  router.use(requirePrincipal);
  router.post('/jobs', limiter, (req, res, next) => upload.array('images', 4)(req, res, (error) => error ? sendError(res, Object.assign(error, { status: error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, code: error.code || 'IMAGE_TO_IMAGE_UPLOAD_FAILED' })) : next()), async (req, res) => {
    try {
      const job = await service.submit({ userId: req.user.id, idempotencyKey: req.get('Idempotency-Key'), input: { prompt: req.body?.prompt, aspectRatio: req.body?.aspectRatio }, files: req.files || [] });
      res.status(job.status === 'queued' ? 202 : 200).json(job);
    } catch (error) { sendError(res, error); }
  });
  router.get('/jobs', async (req, res) => { try { res.json({ jobs: await service.list(req.user.id) }); } catch (error) { sendError(res, error); } });
  router.get('/jobs/:jobId', async (req, res) => { try { const job = await service.get(req.params.jobId, req.user.id); if (!job) return res.status(404).json({ error: 'IMAGE_TO_IMAGE_JOB_NOT_FOUND' }); return res.json(job); } catch (error) { return sendError(res, error); } });
  router.get('/jobs/:jobId/content', async (req, res) => {
    try {
      const job = await service.getContent(req.params.jobId, req.user.id);
      if (!job || job.status !== 'succeeded' || !job.result_storage_key) return res.status(404).json({ error: 'IMAGE_TO_IMAGE_RESULT_NOT_FOUND' });
      const buffer = await storage.read(job.result_storage_key);
      res.set('Content-Type', job.result_mime_type); res.set('Content-Length', String(buffer.length)); res.set('Cache-Control', 'private, no-store'); return res.send(buffer);
    } catch (error) { return sendError(res, error); }
  });
  return { router, repository, storage, provider, service };
}

module.exports = { createImageToImageRouter };
