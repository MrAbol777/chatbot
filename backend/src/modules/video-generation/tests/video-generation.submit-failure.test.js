const test = require('node:test');
const assert = require('node:assert/strict');
const { createVideoGenerationService } = require('../video-generation.service');

test('a failed provider submit marks the job failed and releases its reservation once', async () => {
  const calls = []; const repository = { findIdempotent: async () => null, getModel: async () => ({ is_active: 1, supports_text_to_video: 1, supports_image_to_video: 0, allowed_aspect_ratios: '["16:9"]', allowed_durations: '["4"]', allowed_qualities: '["standard"]', max_prompt_length: 100, quota_units: 1, provider: 'metis', provider_model_id: 'confirmed-model' }), create: async (job) => calls.push(['create', job]), markSubmitFailed: async (...args) => calls.push(['failed', ...args]) }; const quotaService = { reserve: async () => 'reservation-1', release: async (...args) => calls.push(['release', ...args]) }; const provider = { submitTextToVideo: async () => { const error = new Error('network'); error.code = 'UPSTREAM_DOWN'; throw error; }, sanitizeError: () => 'safe provider error' };
  const service = createVideoGenerationService({ repository, quotaService, provider });
  await assert.rejects(() => service.submit({ userId: 'user-1', idempotencyKey: 'abcdefgh', input: { mode: 'text-to-video', prompt: 'safe prompt', modelKey: 'metis_t2v', aspectRatio: '16:9', duration: '4', quality: 'standard' } }), { code: 'UPSTREAM_DOWN' });
  assert.equal(calls.filter(([name]) => name === 'failed').length, 1); assert.deepEqual(calls.find(([name]) => name === 'release'), ['release', { reservationId: 'reservation-1', reason: 'provider_submit_failed' }]);
});

test('a successful internal-only Metis submit persists its job, reservation and provider task ID', async () => {
  const stored = { jobs: new Map(), reservations: new Map() };
  const repository = {
    findIdempotent: async () => null,
    getModel: async () => ({ internal_key: 'metis_kling_v25_turbo_pro', is_active: 0, supports_text_to_video: 1, supports_image_to_video: 0, allowed_aspect_ratios: '["16:9"]', allowed_durations: '["5"]', allowed_qualities: '[]', max_prompt_length: null, quota_units: 1, provider: 'metis', provider_model_id: 'kling-v2.5-turbo-pro', upstream_vendor: 'kwaivgi', upstream_operation: 'Video Generation' }),
    create: async (job) => stored.jobs.set(job.id, { ...job }),
    attachReservation: async (id, reservationId) => { stored.jobs.get(id).reservationId = reservationId; stored.reservations.set(reservationId, { id: reservationId, generationId: id, status: 'reserved' }); },
    updateSubmission: async (id, providerJobId) => { const job = stored.jobs.get(id); job.status = 'submitted'; job.providerJobId = providerJobId; }
  };
  const quotaService = { reserve: async ({ generationId }) => `reservation-${generationId}` };
  const provider = { submitTextToVideo: async () => ({ providerJobId: 'provider-task-12345678', status: 'submitted' }), sanitizeError: () => 'safe' };
  const service = createVideoGenerationService({ repository, quotaService, provider, canUseInactiveModel: () => true });
  const created = await service.submit({ userId: 'metis-live-user-20260720', idempotencyKey: 'metis-live-20260720', input: { mode: 'text-to-video', prompt: 'safe prompt', modelKey: 'metis_kling_v25_turbo_pro', aspectRatio: '16:9', duration: '5', quality: '' } });
  const persisted = stored.jobs.get(created.id);
  assert.equal(persisted.status, 'submitted');
  assert.equal(persisted.providerJobId, 'provider-task-12345678');
  assert.equal(stored.reservations.get(persisted.reservationId).status, 'reserved');
  assert.equal(stored.jobs.size, 1);
});

test('text-to-video rejects image input before a provider submit can occur', async () => {
  let submitted = false;
  const repository = { findIdempotent: async () => null, getModel: async () => ({ is_active: 1, supports_text_to_video: 1, supports_image_to_video: 0, allowed_aspect_ratios: '["16:9"]', allowed_durations: '["5"]', allowed_qualities: '[]', max_prompt_length: null, quota_units: 1 }) };
  const service = createVideoGenerationService({ repository, quotaService: { reserve: async () => 'must-not-reserve' }, provider: { submitTextToVideo: async () => { submitted = true; }, sanitizeError: () => 'safe' } });
  await assert.rejects(() => service.submit({ userId: 'user-1', idempotencyKey: 'abcdefgh', input: { mode: 'text-to-video', prompt: 'safe prompt', modelKey: 'metis_kling_v25_turbo_pro', aspectRatio: '16:9', duration: '5', quality: '', mediaId: 'start-image' } }), { code: 'VIDEO_GENERATION_IMAGE_INPUT_DISABLED' });
  assert.equal(submitted, false);
});
