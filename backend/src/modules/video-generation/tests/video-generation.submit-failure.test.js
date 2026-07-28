const test = require('node:test');
const assert = require('node:assert/strict');
const { createVideoGenerationService } = require('../video-generation.service');
const { createNoaBillingFixture } = require('./noa-billing.fixture');

test('a failed provider submit marks the job failed and releases its reservation once', async () => {
  const calls = []; const repository = { findIdempotent: async () => null, getModel: async () => ({ is_active: 1, supports_text_to_video: 1, supports_image_to_video: 0, allowed_aspect_ratios: '["16:9"]', allowed_durations: '["4"]', allowed_qualities: '["standard"]', max_prompt_length: 100, provider: 'metis', provider_model_id: 'confirmed-model' }), createWithReservation: async ({job,reservationInput}) => { calls.push(['create',job,reservationInput]); return {...job,noaReservationId:'reservation-1'}; }, markSubmitFailedAndRelease: async (input) => calls.push(['failedAndReleased', input]) }; const provider = { submitTextToVideo: async () => { const error = new Error('network'); error.code = 'UPSTREAM_DOWN'; throw error; }, sanitizeError: () => 'safe provider error' };
  const service = createVideoGenerationService({ repository, noaBillingService:createNoaBillingFixture(), provider });
  await assert.rejects(() => service.submit({ userId: 'user-1', idempotencyKey: 'abcdefgh', input: { mode: 'text-to-video', prompt: 'safe prompt', modelKey: 'metis_t2v', aspectRatio: '16:9', duration: '4', quality: 'standard' } }), { code: 'UPSTREAM_DOWN' });
  assert.equal(calls.filter(([name]) => name === 'failedAndReleased').length, 1); assert.equal(calls.find(([name]) => name === 'failedAndReleased')[1].reason, 'provider_submit_failed');
});

test('a successful internal-only Metis submit persists its job, reservation and provider task ID', async () => {
  const stored = { jobs: new Map(), reservations: new Map() };
  const repository = {
    findIdempotent: async () => null,
    getModel: async () => ({ internal_key: 'metis_kling_v25_turbo_pro', is_active: 0, supports_text_to_video: 1, supports_image_to_video: 0, allowed_aspect_ratios: '["16:9"]', allowed_durations: '["5"]', allowed_qualities: '[]', max_prompt_length: null, provider: 'metis', provider_model_id: 'kling-v2.5-turbo-pro', upstream_vendor: 'kwaivgi', upstream_operation: 'Video Generation' }),
    createWithReservation: async ({job}) => { const reservationId=`reservation-${job.id}`; stored.jobs.set(job.id,{...job,reservationId}); stored.reservations.set(reservationId,{id:reservationId,generationId:job.id,status:'reserved'}); return {...job,noaReservationId:reservationId}; },
    updateSubmission: async (id, providerJobId) => { const job = stored.jobs.get(id); job.status = 'submitted'; job.providerJobId = providerJobId; }
  };
  const provider = { submitTextToVideo: async () => ({ providerJobId: 'provider-task-12345678', status: 'submitted' }), sanitizeError: () => 'safe' };
  const service = createVideoGenerationService({ repository, noaBillingService:createNoaBillingFixture(), provider, canUseInactiveModel: () => true });
  const created = await service.submit({ userId: 'metis-live-user-20260720', idempotencyKey: 'metis-live-20260720', input: { mode: 'text-to-video', prompt: 'safe prompt', modelKey: 'metis_kling_v25_turbo_pro', aspectRatio: '16:9', duration: '5', quality: '' } });
  const persisted = stored.jobs.get(created.id);
  assert.equal(persisted.status, 'submitted');
  assert.equal(persisted.providerJobId, 'provider-task-12345678');
  assert.equal(stored.reservations.get(persisted.reservationId).status, 'reserved');
  assert.equal(stored.jobs.size, 1);
});

test('text-to-video rejects image input before a provider submit can occur', async () => {
  let submitted = false;
  const repository = { findIdempotent: async () => null, getModel: async () => ({ is_active: 1, supports_text_to_video: 1, supports_image_to_video: 0, allowed_aspect_ratios: '["16:9"]', allowed_durations: '["5"]', allowed_qualities: '[]', max_prompt_length: null }) };
  const service = createVideoGenerationService({ repository, noaBillingService:createNoaBillingFixture({reserve:async()=>{throw new Error('must-not-reserve');}}), provider: { submitTextToVideo: async () => { submitted = true; }, sanitizeError: () => 'safe' } });
  await assert.rejects(() => service.submit({ userId: 'user-1', idempotencyKey: 'abcdefgh', input: { mode: 'text-to-video', prompt: 'safe prompt', modelKey: 'metis_kling_v25_turbo_pro', aspectRatio: '16:9', duration: '5', quality: '', mediaId: 'start-image' } }), { code: 'VIDEO_GENERATION_IMAGE_INPUT_DISABLED' });
  assert.equal(submitted, false);
});
