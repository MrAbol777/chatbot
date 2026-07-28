'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createVideoGenerationService } = require('../video-generation.service');
const { createNoaBillingFixture } = require('./noa-billing.fixture');

test('a successful live-style submit persists a job and attaches its reservation without cleanup deletion', async () => {
  const calls = [];
  const repository = {
    findIdempotent: async () => null,
    getModel: async () => ({ internal_key: 'metis_kling_v25_turbo_pro', is_active: 0, provider: 'metis', provider_model_id: 'kling-v2.5-turbo-pro', supports_text_to_video: 1, supports_image_to_video: 0, allowed_aspect_ratios: '["16:9"]', allowed_durations: '["5"]', allowed_qualities: '[]', max_prompt_length: 500 }),
    createWithReservation: async ({ job, reservationInput }) => {
      calls.push(['createWithReservation', job, reservationInput]);
      return { ...job, noaReservationId: 'reservation-test-id', noaReservation: { reservationId:'reservation-test-id', amountNoa:'4.000000', unitPriceNoa:'0.800000' } };
    },
    updateSubmission: async (id, providerJobId) => calls.push(['updateSubmission', id, providerJobId]),
    markSubmitFailedAndRelease: async () => calls.push(['markSubmitFailedAndRelease'])
  };
  const service = createVideoGenerationService({ repository, noaBillingService:createNoaBillingFixture(), provider: { submitTextToVideo: async () => ({ providerJobId: '141d-test-946e' }), sanitizeError: () => 'safe' }, canUseInactiveModel: () => true });
  const job = await service.submit({ userId: 'metis-live-user-20260720', idempotencyKey: 'metis-live-persist-test', input: { mode: 'text-to-video', modelKey: 'metis_kling_v25_turbo_pro', prompt: 'short prompt', aspectRatio: '16:9', duration: '5', quality: '' } });
  assert.equal(job.status, 'submitted');
  assert.equal(job.provider_job_id, '141d-test-946e');
  assert.equal(calls.filter(([name]) => name === 'createWithReservation').length, 1);
  assert.equal(calls.filter(([name]) => name === 'updateSubmission').length, 1);
  assert.equal(calls.some(([name]) => /delete|cleanup|release/.test(name)), false);
});
