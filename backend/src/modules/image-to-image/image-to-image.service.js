'use strict';

const crypto = require('crypto');
const { randomUUID } = require('crypto');
const { EXTENSIONS } = require('./image-to-image.storage');
const { imageToImageError } = require('./image-to-image.errors');
const { validateSubmit } = require('./image-to-image.schemas');

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const dto = (job) => {
  if (!job) return null;
  const succeeded = job.status === 'succeeded' && job.result_storage_key;
  return { id: job.id, status: job.status, prompt: job.prompt, aspectRatio: job.aspect_ratio, inputCount: job.sources?.length || 0, safeErrorCode: job.safe_error_code || null, safeErrorMessage: job.safe_error_message || null, createdAt: job.created_at, updatedAt: job.updated_at, completedAt: job.completed_at || null, result: succeeded ? { contentUrl: `/api/image-to-image/jobs/${encodeURIComponent(job.id)}/content`, mimeType: job.result_mime_type, sizeBytes: Number(job.result_size_bytes) } : null };
};

function createImageToImageService({ repository, storage, noaBillingService, config }) {
  const actionKey = 'image_to_image';
  const isEnabled = () => Boolean(config?.enabled);
  const cleanupUncommittedJob = async (jobId) => {
    if (!storage || typeof storage.removeJob !== 'function') return;
    await storage.removeJob(jobId).catch(() => undefined);
  };

  return {
    options: async () => ({ enabled: isEnabled(), provider: 'metis', model: config.model, maxInputImages: 4, pricing: await noaBillingService.quote({ actionKey, quantity: '1' }) }),
    list: async (userId) => (await repository.listForUser(userId)).map(dto),
    get: async (id, userId) => dto(await repository.getForUser(id, userId)),
    getContent: async (id, userId) => repository.getForUser(id, userId),
    submit: async ({ userId, idempotencyKey, input, files }) => {
      if (!isEnabled()) throw imageToImageError('IMAGE_TO_IMAGE_DISABLED', 'ویرایش تصویر در حال حاضر فعال نیست.', 503);
      if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 191) throw imageToImageError('IMAGE_TO_IMAGE_IDEMPOTENCY_REQUIRED', 'کلید یکتای درخواست لازم است.');
      const data = validateSubmit({ ...input, files });
      const payloadHash = digest(JSON.stringify({ ...data, files: files.map((file) => digest(file.buffer)) }));
      const idempotencyHash = digest(idempotencyKey);
      const existing = await repository.findIdempotent(userId, idempotencyHash);
      if (existing) {
        if (existing.payload_hash !== payloadHash) throw imageToImageError('IMAGE_TO_IMAGE_IDEMPOTENCY_CONFLICT', 'این کلید قبلاً برای درخواست دیگری استفاده شده است.', 409);
        return dto(existing);
      }

      const id = randomUUID();
      const sources = [];
      try {
        for (let index = 0; index < files.length; index += 1) {
          const saved = await storage.saveInput(id, index + 1, files[index]);
          sources.push({ key: saved.key, mimeType: files[index].mimetype, extension: EXTENSIONS[files[index].mimetype], sizeBytes: saved.sizeBytes, sha256: saved.sha256 });
        }
      } catch (error) {
        await cleanupUncommittedJob(id);
        throw error;
      }

      const job = { id, userId, provider: 'metis', model: config.model, prompt: data.prompt, aspectRatio: data.aspectRatio, sources, idempotencyHash, payloadHash, expiresAt: new Date(Date.now() + config.jobTimeoutMinutes * 60_000) };
      let created;
      try {
        created = await repository.createWithReservation({
          job,
          reservationInput: { userId, actionKey, quantity: '1', idempotencyKey: `image_to_image:${idempotencyKey}`, payloadHash, referenceType: 'image_to_image', referenceId: id, expiresAt: job.expiresAt, actorType: 'user', actorId: userId, metadata: { jobId: id, inputCount: sources.length, provider: 'metis', model: config.model } }
        });
      } catch (error) {
        await cleanupUncommittedJob(id);
        throw error;
      }
      return dto(created);
    }
  };
}

module.exports = { createImageToImageService, dto };
