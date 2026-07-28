'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

const { createVideoGenerationRepository } = require('../video-generation.repository');
const { createNoaVideoDbFixture } = require('./noa-video-db.fixture');

let pool;
let noa;
const jobIds = new Set();

function routedJob(userId, overrides = {}) {
  const id = randomUUID();
  jobIds.add(id);
  const now = new Date();
  return {
    id,
    danoaRequestId: randomUUID(),
    userId,
    mode: 'text-to-video',
    capability: 'video.text_to_video',
    routeId: 'video-t2v',
    routeVersion: 1,
    routeSnapshot: {
      routeId: 'video-t2v',
      routeVersion: 1,
      capability: 'video.text_to_video',
      routingPolicy: 'PRIMARY_ONLY',
      selectedIndex: 0,
      candidates: [{
        providerKey: 'metis',
        modelKey: 'metis_kling_v25_turbo_pro',
        providerModelId: 'kling-v2.5-turbo-pro',
        available: true
      }]
    },
    modelKey: 'metis_kling_v25_turbo_pro',
    provider: 'metis',
    providerModelId: 'kling-v2.5-turbo-pro',
    prompt: 'transaction fixture',
    userPrompt: 'transaction fixture',
    compiledPrompt: 'transaction fixture',
    compiledPromptHash: 'c'.repeat(64),
    promptProfileId: null,
    promptProfileVersionId: null,
    promptProfileKey: null,
    promptProfileVersion: null,
    promptCompilerVersion: null,
    negativePrompt: null,
    aspectRatio: '16:9',
    duration: '5',
    quality: '',
    resolution: null,
    generateAudio: false,
    mediaId: null,
    estimatedCost: null,
    idempotencyHash: 'a'.repeat(64),
    payloadHash: 'b'.repeat(64),
    expiresAt: new Date(now.getTime() + 60_000),
    nextPollAt: now,
    now,
    ...overrides
  };
}

async function fundUserForJob(userId, job) {
  const quote = await noa.billing.quote({
    actionKey: 'video_generation',
    quantity: job.duration
  });
  const key = randomUUID();
  await noa.billing.credit({
    userId,
    amountNoa: quote.amountNoa,
    entryType: 'test_credit',
    referenceType: 'routing_test',
    referenceId: `credit-${key}`,
    idempotencyKey: `credit-${key}`,
    payloadHash: { jobId: job.id, quote },
    actorType: 'system',
    actorId: 'video-routing-test'
  });
  return quote;
}

function reservationInput(job) {
  return {
    userId: job.userId,
    actionKey: 'video_generation',
    quantity: job.duration,
    idempotencyKey: `video-route-${job.id}`,
    payloadHash: { payloadHash: job.payloadHash, routeId: job.routeId },
    referenceType: 'video_generation',
    referenceId: job.id,
    expiresAt: job.expiresAt,
    actorType: 'user',
    actorId: job.userId
  };
}

test.before(async () => {
  execFileSync(process.execPath, ['scripts/apply-video-generation-migration.js'], {
    cwd: path.join(__dirname, '../../../..'),
    stdio: 'inherit'
  });
  const url = new URL(process.env.DATABASE_URL);
  pool = mysql.createPool({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    connectionLimit: 4
  });
  noa = createNoaVideoDbFixture(pool);
  await noa.initialize();
});

test.afterEach(async () => {
  for (const jobId of jobIds) {
    await pool.query('DELETE FROM app_ai_provider_attempts WHERE job_id=?', [jobId]);
    await pool.query('DELETE FROM app_video_generations WHERE id=?', [jobId]);
  }
  jobIds.clear();
  await noa.cleanup();
});

test.after(async () => pool.end());

test('job, Noa reservation, route snapshot and first attempt commit atomically', async () => {
  const userId = await noa.createUser('routing-user');
  const job = routedJob(userId);
  const quote = await fundUserForJob(userId, job);
  const repository = createVideoGenerationRepository(pool, {
    noaBillingService: noa.billing
  });

  const createdJob = await repository.createRoutedWithReservation({
    job,
    reservationInput: reservationInput(job)
  });

  const [[generation]] = await pool.query(
    'SELECT * FROM app_video_generations WHERE id=?',
    [job.id]
  );
  const [[reservation]] = await pool.query(
    'SELECT * FROM app_noa_reservations WHERE reservation_id=?',
    [createdJob.noaReservationId]
  );
  const [[attempt]] = await pool.query(
    'SELECT * FROM app_ai_provider_attempts WHERE job_id=?',
    [job.id]
  );
  const wallet = await noa.billing.getBalance(userId);

  assert.equal(createdJob.status, 'queued');
  assert.equal(generation.route_id, 'video-t2v');
  assert.equal(generation.provider_attempt_id, attempt.attempt_id);
  assert.equal(reservation.reservation_id, generation.noa_reservation_id);
  assert.equal(reservation.status, 'reserved');
  assert.equal(String(reservation.amount), quote.amountNoa);
  assert.equal(attempt.state, 'planned');
  assert.equal(wallet.availableNoa, '0.000000');
  assert.equal(wallet.reservedNoa, quote.amountNoa);
});

test('invalid I2V ownership rolls back job, Noa reservation and attempt together', async () => {
  const userId = await noa.createUser('routing-user');
  const job = routedJob(userId, {
    mode: 'image-to-video',
    capability: 'video.image_to_video',
    routeId: 'video-i2v',
    routeSnapshot: { routeId: 'video-i2v', routeVersion: 1 },
    mediaId: randomUUID()
  });
  const quote = await fundUserForJob(userId, job);
  const repository = createVideoGenerationRepository(pool, {
    noaBillingService: noa.billing
  });

  await assert.rejects(
    repository.createRoutedWithReservation({
      job,
      reservationInput: reservationInput(job)
    }),
    { code: 'VIDEO_INPUT_MEDIA_INVALID' }
  );

  const [[counts]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM app_video_generations WHERE id=?) AS jobs,
       (SELECT COUNT(*) FROM app_noa_reservations
         WHERE reference_type='video_generation' AND reference_id=?) AS reservations,
       (SELECT COUNT(*) FROM app_ai_provider_attempts WHERE job_id=?) AS attempts`,
    [job.id, job.id, job.id]
  );
  const wallet = await noa.billing.getBalance(userId);

  assert.deepEqual(
    {
      jobs: Number(counts.jobs),
      reservations: Number(counts.reservations),
      attempts: Number(counts.attempts)
    },
    { jobs: 0, reservations: 0, attempts: 0 }
  );
  assert.equal(wallet.availableNoa, quote.amountNoa);
  assert.equal(wallet.reservedNoa, '0.000000');
});
