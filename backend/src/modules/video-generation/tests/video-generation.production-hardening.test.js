'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JOB_STATUSES, canTransitionJob, isIdempotentJobTransition } = require('../video-generation.states');
const { createVideoGenerationService } = require('../video-generation.service');
const { requiredEnv } = require('../../../../scripts/recover-metis-video-result');
const { validateMetisBaseUrl } = require('../providers/metis-video.provider');

test('real-provider state machine requires storage before success and keeps transitions idempotent', () => {
  assert.equal(canTransitionJob(JOB_STATUSES.QUEUED, JOB_STATUSES.SUBMITTED), true);
  assert.equal(canTransitionJob(JOB_STATUSES.SUBMITTED, JOB_STATUSES.SUCCEEDED), false);
  assert.equal(canTransitionJob(JOB_STATUSES.PROCESSING, JOB_STATUSES.SUCCEEDED), false);
  assert.equal(canTransitionJob(JOB_STATUSES.STORING, JOB_STATUSES.SUCCEEDED), true);
  assert.equal(canTransitionJob(JOB_STATUSES.STORING, JOB_STATUSES.CANCELLED), false);
  assert.equal(isIdempotentJobTransition(JOB_STATUSES.STORING, JOB_STATUSES.STORING), true);
});

test('global feature flag denies submit before persistence or provider use', async () => {
  let touched = false;
  const service = createVideoGenerationService({
    repository: { findIdempotent: async () => { touched = true; return null; } },
    quotaService: {}, provider: {}, isFeatureEnabled: () => false
  });
  await assert.rejects(() => service.submit({ userId: 'user', idempotencyKey: 'abcdefgh', input: {} }), { code: 'VIDEO_GENERATION_DISABLED' });
  assert.equal(touched, false);
});

test('recovery is disabled by default and never includes its signed URL in the refusal', () => {
  const signed = 'https://api.metisai.ir/api/tpsgsbxstoragecontainer/router/tpsgsbxstoragecontainer/router/result.mp4?signature=must-not-leak';
  assert.throws(() => requiredEnv({ METIS_RECOVERY_RESULT_URL: signed }), (error) => !String(error.message).includes('must-not-leak'));
});

test('Metis API base URL must be an HTTPS origin without a path, credentials or port', () => {
  assert.equal(validateMetisBaseUrl('https://api.metisai.ir'), 'https://api.metisai.ir');
  for (const candidate of ['http://api.metisai.ir', 'https://api.metisai.ir/path', 'https://user:pass@api.metisai.ir', 'https://api.metisai.ir:444']) {
    assert.throws(() => validateMetisBaseUrl(candidate), { code: 'VIDEO_PROVIDER_NOT_CONFIGURED' });
  }
});
