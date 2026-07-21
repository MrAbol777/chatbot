'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createVideoGenerationService } = require('../video-generation.service');

test('a successful live-style submit persists a job and attaches its reservation without cleanup deletion', async () => {
  const calls = [];
  const repository = {
    findIdempotent: async () => null,
    getModel: async () => ({ internal_key: 'metis_kling_v25_turbo_pro', is_active: 0, provider: 'metis', provider_model_id: 'kling-v2.5-turbo-pro', supports_text_to_video: 1, supports_image_to_video: 0, allowed_aspect_ratios: '["16:9"]', allowed_durations: '["5"]', allowed_qualities: '[]', max_prompt_length: 500, quota_units: 1 }),
    create: async (job) => calls.push(['create', job]),
    attachReservation: async (id, reservationId) => calls.push(['attachReservation', id, reservationId]),
    updateSubmission: async (id, providerJobId) => calls.push(['updateSubmission', id, providerJobId]),
    markSubmitFailed: async () => calls.push(['markSubmitFailed'])
  };
  const service = createVideoGenerationService({ repository, quotaService: { reserve: async () => 'reservation-test-id', release: async () => calls.push(['release']) }, provider: { submitTextToVideo: async () => ({ providerJobId: '141d-test-946e' }), sanitizeError: () => 'safe' }, canUseInactiveModel: () => true });
  const job = await service.submit({ userId: 'metis-live-user-20260720', idempotencyKey: 'metis-live-persist-test', input: { mode: 'text-to-video', modelKey: 'metis_kling_v25_turbo_pro', prompt: 'short prompt', aspectRatio: '16:9', duration: '5', quality: '' } });
  assert.equal(job.status, 'submitted');
  assert.equal(job.provider_job_id, '141d-test-946e');
  assert.equal(calls.filter(([name]) => name === 'create').length, 1);
  assert.equal(calls.filter(([name]) => name === 'attachReservation').length, 1);
  assert.equal(calls.filter(([name]) => name === 'updateSubmission').length, 1);
  assert.equal(calls.some(([name]) => /delete|cleanup|release/.test(name)), false);
});
