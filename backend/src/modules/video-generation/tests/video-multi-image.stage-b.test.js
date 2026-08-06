'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSubmit, normalizeMediaIds } = require('../video-generation.schemas');
const { createVideoWorkerProviderRegistry } = require('../worker/video-worker.bootstrap');
const { createFakeVideoProvider } = require('../providers/fake-video.provider');
const { createOpenRouterVideoProvider } = require('../providers/openrouter-video.provider');
const { classifyOpenRouterSubmissionError } = require('../providers/openrouter-video.provider');
const { supportsCapability } = require('../../ai-routing/capability-route-resolver');
const { VIDEO_CAPABILITIES } = require('../../ai-routing/routing-policies');
const { loadVideoWorkerConfig } = require('../worker/video-worker.config');

const baseInput = { mode: 'image_to_video', prompt: 'test prompt', duration: '5', aspectRatio: '16:9', resolution: '480p', styleKey: 'cinematic' };

test('normalizeMediaIds accepts valid 2-item array', () => {
  assert.deepEqual(normalizeMediaIds(['id1', 'id2']), ['id1', 'id2']);
});

test('normalizeMediaIds accepts valid 7-item array', () => {
  const ids = Array.from({ length: 7 }, (_, i) => `id${i + 1}`);
  assert.deepEqual(normalizeMediaIds(ids), ids);
});

test('normalizeMediaIds rejects empty array', () => {
  assert.throws(() => normalizeMediaIds([]), { code: 'VIDEO_GENERATION_INVALID_MEDIA_IDS' });
});

test('normalizeMediaIds rejects 8 items', () => {
  assert.throws(() => normalizeMediaIds(Array(8).fill('x')), { code: 'VIDEO_GENERATION_TOO_MANY_MEDIA' });
});

test('normalizeMediaIds rejects duplicates', () => {
  assert.throws(() => normalizeMediaIds(['a', 'b', 'a']), { code: 'VIDEO_GENERATION_DUPLICATE_MEDIA' });
});

test('validateSubmit accepts mediaId alone', () => {
  const r = validateSubmit({ ...baseInput, mediaId: 'single-id' }, { modelKeyRequired: false });
  assert.equal(r.mediaId, 'single-id');
  assert.equal(r.mediaIds, null);
});

test('validateSubmit accepts mediaIds with 2 items', () => {
  const r = validateSubmit({ ...baseInput, mediaIds: ['a', 'b'] }, { modelKeyRequired: false });
  assert.deepEqual(r.mediaIds, ['a', 'b']);
  assert.equal(r.mediaId, null);
});

test('validateSubmit rejects both mediaId and mediaIds', () => {
  assert.throws(() => validateSubmit({ ...baseInput, mediaId: 'a', mediaIds: ['b', 'c'] }, { modelKeyRequired: false }), { code: 'VIDEO_GENERATION_INVALID_MEDIA' });
});

test('validateSubmit normalizes single-item mediaIds to mediaId', () => {
  const r = validateSubmit({ ...baseInput, mediaIds: ['single'] }, { modelKeyRequired: false });
  assert.equal(r.mediaId, 'single');
  assert.equal(r.mediaIds, null);
});

test('VIDEO_CAPABILITIES includes IMAGE_TO_VIDEO_MULTI', () => {
  assert.equal(VIDEO_CAPABILITIES.IMAGE_TO_VIDEO_MULTI, 'video.image_to_video_multi');
});

test('supportsCapability handles multi-image correctly', () => {
  const multiModel = { supports_image_to_video_multi: 1, supports_image_to_video: 0, supports_text_to_video: 0 };
  assert.equal(supportsCapability(multiModel, 'video.image_to_video_multi'), true);
  assert.equal(supportsCapability(multiModel, 'video.image_to_video'), false);
  assert.equal(supportsCapability({ supports_image_to_video: 1 }, 'video.image_to_video_multi'), false);
  assert.equal(supportsCapability({ supports_text_to_video: 1 }, 'video.text_to_video'), true);
});

test('all 429 responses are conservative ambiguous (audit B)', () => {
  assert.equal(classifyOpenRouterSubmissionError({ response: { status: 429 } }).submissionOutcome, 'ambiguous');
  assert.equal(classifyOpenRouterSubmissionError({ response: { status: 429, data: { error: { code: 'rate_limited', message: 'slow' } } } }).submissionOutcome, 'ambiguous');
  assert.equal(classifyOpenRouterSubmissionError({ response: { status: 429, data: { id: 'job_1' } } }).submissionOutcome, 'ambiguous');
  assert.equal(classifyOpenRouterSubmissionError({ response: { status: 429, data: {} } }).submissionOutcome, 'ambiguous');
});

test('worker registry returns openrouter when configured (audit A)', () => {
  const env = { OPENROUTER_API_KEY: 'sk-test', OPENROUTER_BASE_URL: 'https://openrouter.ai', NODE_ENV: 'production' };
  const registry = createVideoWorkerProviderRegistry({ httpClient: { post: async () => ({}), get: async () => ({}) }, env, storageConfig: { allowedHosts: [], allowedPorts: [443], allowedPathPrefixes: ['/'] } });
  assert.ok(registry.openrouter);
  assert.equal(registry.openrouter.getProviderKey(), 'openrouter');
});

test('worker registry does not include openrouter without key (audit A)', () => {
  const env = { NODE_ENV: 'production' };
  const registry = createVideoWorkerProviderRegistry({ httpClient: { post: async () => ({}), get: async () => ({}) }, env, storageConfig: { allowedHosts: [] } });
  assert.equal(registry.openrouter, undefined);
});

test('worker config loads submit retry defaults (audit D)', () => {
  const config = loadVideoWorkerConfig({ VIDEO_GENERATION_WORKER_ENABLED: 'false', VIDEO_GENERATION_WORKER_MODE: 'disabled' });
  assert.equal(config.maxSubmitRetries, 3);
  assert.equal(config.submitRetryBaseDelayMs, 5000);
  assert.equal(config.submitRetryMaxDelayMs, 60000);
});

test('worker config validates submit retry bounds (audit D)', () => {
  assert.throws(() => loadVideoWorkerConfig({ VIDEO_GENERATION_WORKER_ENABLED: 'false', VIDEO_GENERATION_WORKER_MODE: 'disabled', VIDEO_SUBMIT_RETRY_MAX: '11' }), /must not exceed 10/);
  assert.throws(() => loadVideoWorkerConfig({ VIDEO_GENERATION_WORKER_ENABLED: 'false', VIDEO_GENERATION_WORKER_MODE: 'disabled', VIDEO_SUBMIT_RETRY_BASE_DELAY_MS: '60000', VIDEO_SUBMIT_RETRY_MAX_DELAY_MS: '5000' }), /greater than/);
});

// DB integration tests for repository transactions
const testDB = process.env.DATABASE_URL
  ? (() => {
    const mysql = require('mysql2/promise');
    const path = require('path');
    require('dotenv').config({ path: path.join(__dirname, '../../../..', '.env') });
    const { randomUUID } = require('crypto');
    const { createVideoGenerationRepository } = require('../video-generation.repository');
    const { createNoaVideoDbFixture } = require('./noa-video-db.fixture');

    let pool, noa, repository;
    const jobIds = new Set();

    test.before(async () => {
      const url = new URL(process.env.DATABASE_URL);
      pool = mysql.createPool({ host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.slice(1), connectionLimit: 4 });
      noa = createNoaVideoDbFixture(pool);
      await noa.initialize();
      repository = createVideoGenerationRepository(pool, { noaBillingService: noa.billing });
    });

    test.afterEach(async () => {
      for (const jobId of jobIds) {
        await pool.query('DELETE FROM app_video_generation_inputs WHERE generation_id=?', [jobId]);
        await pool.query('DELETE FROM app_ai_provider_attempts WHERE job_id=?', [jobId]);
        await pool.query('DELETE FROM app_video_generations WHERE id=?', [jobId]);
      }
      jobIds.clear();
      await noa.cleanup();
    });

    test.after(async () => pool.end());

    function createMedia(userId, status = 'ready') {
      const id = randomUUID();
      return { id, userId, storageKey: `test/${id}`, mimeType: 'image/png', sizeBytes: 1024, sha256: 'a'.repeat(64), status, expiresAt: new Date(Date.now() + 3600000), createdAt: new Date(), updatedAt: new Date() };
    }

    async function insertMedia(conn, media) {
      await conn.query('INSERT INTO app_video_input_media (id,user_id,storage_key,mime_type,size_bytes,sha256,status,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,NOW(),NOW())', [media.id, media.userId, media.storageKey, media.mimeType, media.sizeBytes, media.sha256, media.status, media.expiresAt]);
    }

    const routedMultiJob = (userId, mediaIds, overrides = {}) => ({
      id: randomUUID(),
      danoaRequestId: randomUUID(),
      userId,
      mode: 'image-to-video',
      capability: 'video.image_to_video_multi',
      routeId: 'video-i2v-multi',
      routeVersion: 1,
      routeSnapshot: {},
      modelKey: 'openrouter_grok_imagine_video',
      provider: 'fake',
      providerModelId: 'x-ai/grok-imagine-video',
      prompt: 'multi test',
      userPrompt: 'multi test',
      compiledPrompt: 'multi test',
      compiledPromptHash: 'x'.repeat(64),
      promptProfileId: null,
      promptProfileVersionId: null,
      promptProfileKey: null,
      promptProfileVersion: null,
      promptCompilerVersion: null,
      negativePrompt: null,
      aspectRatio: '16:9',
      duration: '5',
      quality: '',
      resolution: '480p',
      generateAudio: false,
      mediaId: null,
      estimatedCost: null,
      noaReservationId: null,
      noaReservation: null,
      attemptId: null,
      idempotencyHash: 'a'.repeat(64),
      payloadHash: 'b'.repeat(64),
      expiresAt: new Date(Date.now() + 60000),
      nextPollAt: new Date(),
      now: new Date(),
      ...overrides
    });

    function reservationInput(job) {
      return {
        userId: job.userId,
        actionKey: 'video_multi_image_generation',
        quantity: '5',
        idempotencyKey: `video_multi_image_generation:${job.idempotencyHash}`,
        payloadHash: job.payloadHash,
        referenceType: 'video_generation',
        referenceId: job.id,
        expiresAt: job.expiresAt,
        actorType: 'user',
        actorId: job.userId
      };
    }

    test('two owned ready media rows bind to the same generation', async () => {
      const userId = await noa.createUser('multi-user-1');
      const m1 = createMedia(userId);
      const m2 = createMedia(userId);
      const conn = await pool.getConnection();
      try { await insertMedia(conn, m1); await insertMedia(conn, m2); await conn.commit(); } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
      const job = routedMultiJob(userId, [m1.id, m2.id]);
      jobIds.add(job.id);
      await noa.billing.credit({ userId, amountNoa: '10.000000', entryType: 'test_credit', referenceType: 'test', referenceId: randomUUID(), idempotencyKey: randomUUID(), payloadHash: {}, actorType: 'system', actorId: 'test' });
      const result = await repository.createRoutedWithReservation({ job, reservationInput: reservationInput(job), mediaIds: [m1.id, m2.id] });
      assert.equal(result.status, 'queued');
      const [inputs] = await pool.query('SELECT * FROM app_video_generation_inputs WHERE generation_id=? ORDER BY position', [job.id]);
      assert.equal(inputs.length, 2);
      assert.equal(inputs[0].media_id, m1.id);
      assert.equal(inputs[0].position, 1);
      assert.equal(inputs[1].media_id, m2.id);
      assert.equal(inputs[1].position, 2);
      const [media1] = await pool.query('SELECT status, bound_generation_id FROM app_video_input_media WHERE id=?', [m1.id]);
      assert.equal(media1[0].status, 'bound');
      assert.equal(media1[0].bound_generation_id, job.id);
    });

    test('cross-user media rejects entire transaction', async () => {
      const userId = await noa.createUser('multi-user-2');
      const otherUser = await noa.createUser('multi-user-3');
      const m1 = createMedia(userId);
      const m2 = createMedia(otherUser);
      const conn = await pool.getConnection();
      try { await insertMedia(conn, m1); await insertMedia(conn, m2); await conn.commit(); } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
      const job = routedMultiJob(userId, [m1.id, m2.id]);
      jobIds.add(job.id);
      await noa.billing.credit({ userId, amountNoa: '10.000000', entryType: 'test_credit', referenceType: 'test', referenceId: randomUUID(), idempotencyKey: randomUUID(), payloadHash: {}, actorType: 'system', actorId: 'test' });
      await assert.rejects(repository.createRoutedWithReservation({ job, reservationInput: reservationInput(job), mediaIds: [m1.id, m2.id] }), { code: 'VIDEO_INPUT_MEDIA_INVALID' });
      const [inputs] = await pool.query('SELECT * FROM app_video_generation_inputs WHERE generation_id=?', [job.id]);
      assert.equal(inputs.length, 0);
      const [gens] = await pool.query('SELECT * FROM app_video_generations WHERE id=?', [job.id]);
      assert.equal(gens.length, 0);
    });

    test('previously bound media rejects entire transaction', async () => {
      const userId = await noa.createUser('multi-user-4');
      const m1 = createMedia(userId);
      const m2 = createMedia(userId, 'bound');
      const conn = await pool.getConnection();
      try { await insertMedia(conn, m1); await insertMedia(conn, m2); await conn.commit(); } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
      const job = routedMultiJob(userId, [m1.id, m2.id]);
      jobIds.add(job.id);
      await noa.billing.credit({ userId, amountNoa: '10.000000', entryType: 'test_credit', referenceType: 'test', referenceId: randomUUID(), idempotencyKey: randomUUID(), payloadHash: {}, actorType: 'system', actorId: 'test' });
      await assert.rejects(repository.createRoutedWithReservation({ job, reservationInput: reservationInput(job), mediaIds: [m1.id, m2.id] }), { code: 'VIDEO_MEDIA_ALREADY_BOUND' });
      const [inputs] = await pool.query('SELECT * FROM app_video_generation_inputs WHERE generation_id=?', [job.id]);
      assert.equal(inputs.length, 0);
    });

    test('listInputsForGeneration returns ordered results', async () => {
      const userId = await noa.createUser('multi-user-5');
      const m1 = createMedia(userId);
      const m2 = createMedia(userId);
      const m3 = createMedia(userId);
      const conn = await pool.getConnection();
      try { await insertMedia(conn, m1); await insertMedia(conn, m2); await insertMedia(conn, m3); await conn.commit(); } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
      const job = routedMultiJob(userId, [m1.id, m2.id, m3.id]);
      jobIds.add(job.id);
      await noa.billing.credit({ userId, amountNoa: '10.000000', entryType: 'test_credit', referenceType: 'test', referenceId: randomUUID(), idempotencyKey: randomUUID(), payloadHash: {}, actorType: 'system', actorId: 'test' });
      await repository.createRoutedWithReservation({ job, reservationInput: reservationInput(job), mediaIds: [m1.id, m2.id, m3.id] });
      const inputs = await repository.listInputsForGeneration(job.id);
      assert.equal(inputs.length, 3);
      assert.equal(inputs[0].id, m2.id);
      assert.equal(inputs[1].id, m3.id);
      assert.equal(inputs[2].id, m1.id);
    });
  })()
  : null;
