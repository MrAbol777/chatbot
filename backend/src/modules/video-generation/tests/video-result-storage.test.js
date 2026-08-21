process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { createLocalVideoStorage } = require('../storage/local-video.storage');
const { createVideoResultOrchestrator } = require('../storage/video-result-orchestrator');
const { VideoStorageError } = require('../storage/video-storage.errors');

let root; let storage;
const mp4 = Buffer.from('000000186674797069736f6d0000020069736f6d69736f6d', 'hex');
test.before(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'video-store-')); storage = createLocalVideoStorage({ root, maxBytes: 1024, tempMaxAgeMinutes: 1 }); });
test.after(async () => { await fs.rm(root, { recursive: true, force: true }); });
test('stores a streamed MP4 atomically with SHA-256 compatible bytes', async () => { const tmp = await storage.createTemporaryTarget(); const written = await storage.writeStream(Readable.from([mp4]), tmp); const validation = await storage.validateStoredFile(tmp, { declaredMimeType: 'video/mp4' }); await storage.commitTemporaryFile(tmp, 'results/a/output.mp4'); assert.equal(validation.mimeType, 'video/mp4'); assert.equal((await storage.stat('results/a/output.mp4')).size, mp4.length); assert.match(written.sha256, /^[a-f0-9]{64}$/); });
test('rejects empty, HTML and mismatched MIME files', async () => { for (const [bytes, mime] of [[Buffer.alloc(0), 'video/mp4'], [Buffer.from('<html>error</html>'), 'video/mp4'], [mp4, 'video/webm']]) { const tmp = await storage.createTemporaryTarget(); await fs.writeFile(tmp, bytes); await assert.rejects(storage.validateStoredFile(tmp, { declaredMimeType: mime }), VideoStorageError); await storage.removeTemporary(tmp); } });
test('enforces streaming size and safe keys', async () => { const tmp = await storage.createTemporaryTarget(); await assert.rejects(storage.writeStream(Readable.from([Buffer.alloc(2048)]), tmp), (error) => error?.code === 'VIDEO_RESULT_TOO_LARGE'); assert.throws(() => storage.resolveSafeKey('../escape.mp4'), (error) => error?.code === 'VIDEO_STORAGE_INVALID_KEY' || error?.code === 'VIDEO_STORAGE_PATH_ESCAPE'); });
test('cleanup removes old temporary files only', async () => { const tmp = await storage.createTemporaryTarget(); await fs.writeFile(tmp, mp4); const old = new Date(Date.now() - 120_000); await fs.utimes(tmp, old, old); assert.equal(await storage.cleanupTemporary({ maxAgeMinutes: 1 }), 1); assert.equal(await storage.exists('results/a/output.mp4'), true); });

test('a no-clobber commit preserves the first durable final file', async () => {
  const first = await storage.createTemporaryTarget(); const second = await storage.createTemporaryTarget();
  const alternateMp4 = Buffer.concat([mp4, Buffer.from('second-writer')]);
  await fs.writeFile(first, mp4); await fs.writeFile(second, alternateMp4);
  await storage.commitTemporaryFile(first, 'results/race/output.mp4');
  await storage.commitTemporaryFile(second, 'results/race/output.mp4');
  assert.deepEqual(await fs.readFile(storage.resolveSafeKey('results/race/output.mp4')), mp4);
  assert.equal(await fs.stat(second).then(() => true).catch(() => false), true);
  await storage.removeTemporary(second);
});

test('fault injection after temporary creation leaves a real isolated temp file', async () => {
  const crash = Object.assign(new Error('simulated process crash'), { simulateCrash: true });
  const crashingStorage = createLocalVideoStorage({ root, maxBytes: 1024, tempMaxAgeMinutes: 1, faultInjector: (point) => { if (point === 'after_temp_file') throw crash; } });
  await assert.rejects(() => crashingStorage.createTemporaryTarget(), (error) => error === crash);
  const temporaryEntries = await fs.readdir(path.join(root, '.tmp'));
  assert.ok(temporaryEntries.some((name) => name.endsWith('.part')));
  await crashingStorage.cleanupTemporary({ maxAgeMinutes: 1, limit: 100 });
});

test('reuses a valid final file after a simulated crash following atomic rename', async () => {
  const crash = Object.assign(new Error('simulated process crash'), { simulateCrash: true });
  const crashingStorage = createLocalVideoStorage({ root, maxBytes: 1024, tempMaxAgeMinutes: 1, faultInjector: (point) => { if (point === 'after_atomic_rename') throw crash; } });
  const calls = { downloads: 0, finalized: 0 };
  const provider = { fetchResultStream: async () => { calls.downloads += 1; return { stream: Readable.from([mp4]), mimeType: 'video/mp4' }; } };
  const repository = { recordStorageAttempt: async () => true, finalizeStoredResult: async () => { calls.finalized += 1; return { idempotent: false }; }, scheduleStorageRetry: async () => true, failStorageAndRelease: async () => true };
  const job = { id: 'crash-recovery-job', user_id: 'crash-recovery-user', storage_attempts: 0 };
  const descriptor = { source: 'fake://never-connected', filename: 'output.mp4', mimeType: 'video/mp4' };
  const config = { maxBytes: 1024, timeoutMs: 1000, maxRedirects: 1, maxAttempts: 2, retryBaseDelayMs: 1, retryMaxDelayMs: 1 };
  await assert.rejects(() => createVideoResultOrchestrator({ storage: crashingStorage, config }).store({ job, provider, descriptor, repository, workerId: 'worker-a' }), (error) => error === crash);
  const key = `results/${crypto.createHash('sha256').update(job.user_id).digest('hex').slice(0, 24)}/${job.id}/output.mp4`;
  assert.equal(await crashingStorage.exists(key), true);
  const recovered = await createVideoResultOrchestrator({ storage: createLocalVideoStorage({ root, maxBytes: 1024, tempMaxAgeMinutes: 1 }), config }).store({ job, provider, descriptor, repository, workerId: 'worker-b' });
  assert.equal(recovered.reusedExistingFile, true);
  assert.equal(calls.downloads, 1);
  assert.equal(calls.finalized, 1);
});

test('reuses a validated deterministic temp file after a crash before rename', async () => {
  const crash = Object.assign(new Error('simulated process crash'), { simulateCrash: true });
  const crashingStorage = createLocalVideoStorage({ root, maxBytes: 1024, tempMaxAgeMinutes: 1, faultInjector: (point) => { if (point === 'after_validation') throw crash; } });
  const calls = { downloads: 0, finalized: 0 };
  const provider = { fetchResultStream: async () => { calls.downloads += 1; return { stream: Readable.from([mp4]), mimeType: 'video/mp4' }; } };
  const repository = { recordStorageAttempt: async () => true, finalizeStoredResult: async () => { calls.finalized += 1; return { idempotent: false }; }, scheduleStorageRetry: async () => true, failStorageAndRelease: async () => true };
  const job = { id: 'temp-recovery-job', user_id: 'temp-recovery-user', storage_attempts: 0 };
  const descriptor = { source: 'fake://never-connected', filename: 'output.mp4', mimeType: 'video/mp4' };
  const config = { maxBytes: 1024, timeoutMs: 1000, maxRedirects: 1, maxAttempts: 2, retryBaseDelayMs: 1, retryMaxDelayMs: 1 };
  await assert.rejects(() => createVideoResultOrchestrator({ storage: crashingStorage, config }).store({ job, provider, descriptor, repository, workerId: 'worker-a' }), (error) => error === crash);
  const recoveredStorage = createLocalVideoStorage({ root, maxBytes: 1024, tempMaxAgeMinutes: 1 });
  const recovered = await createVideoResultOrchestrator({ storage: recoveredStorage, config }).store({ job, provider, descriptor, repository, workerId: 'worker-b' });
  assert.equal(recovered.reusedExistingTemporary, true);
  assert.equal(calls.downloads, 1);
  assert.equal(calls.finalized, 1);
});

test('lease loss during a streaming result cannot finalize, retry, or fail a stale storage attempt', async () => {
  let leaseActive = true;
  const calls = { finalized: 0, retried: 0, failed: 0 };
  async function* longResult() {
    yield mp4.subarray(0, 10);
    leaseActive = false;
    yield mp4.subarray(10);
  }
  const provider = { fetchResultStream: async () => ({ stream: Readable.from(longResult()), mimeType: 'video/mp4' }) };
  const repository = {
    recordStorageAttempt: async () => true,
    finalizeStoredResult: async () => { calls.finalized += 1; return { idempotent: false }; },
    scheduleStorageRetry: async () => { calls.retried += 1; return true; },
    failStorageAndRelease: async () => { calls.failed += 1; return true; }
  };
  const job = { id: 'lease-loss-job', user_id: 'lease-loss-user', storage_attempts: 0 };
  const descriptor = { source: 'https://example.test/video.mp4', filename: 'output.mp4', mimeType: 'video/mp4' };
  const config = { maxBytes: 1024, timeoutMs: 1000, maxRedirects: 0, maxAttempts: 2, retryBaseDelayMs: 1, retryMaxDelayMs: 1 };
  await assert.rejects(
    () => createVideoResultOrchestrator({ storage, config }).store({ job, provider, descriptor, repository, workerId: 'worker-a', assertLease: () => leaseActive }),
    (error) => error?.code === 'VIDEO_WORKER_LEASE_LOST'
  );
  assert.deepEqual(calls, { finalized: 0, retried: 0, failed: 0 });
});

test('a BananaAI completed task retries a transient invalid result descriptor without a new generation', async () => {
  const calls = { downloads: 0, retried: 0, failed: 0 };
  const provider = { fetchResultStream: async () => { calls.downloads += 1; throw new VideoStorageError('VIDEO_RESULT_URL_INVALID'); } };
  const repository = {
    recordStorageAttempt: async () => true,
    finalizeStoredResult: async () => { throw new Error('must not finalize'); },
    scheduleStorageRetry: async () => { calls.retried += 1; return true; },
    failStorageAndRelease: async () => { calls.failed += 1; return true; }
  };
  const job = { id: 'banana-invalid-result', user_id: 'banana-user', provider: 'bananaai', storage_attempts: 0 };
  const result = await createVideoResultOrchestrator({ storage, config: { maxBytes: 1024, timeoutMs: 1000, maxRedirects: 0, maxAttempts: 2, retryBaseDelayMs: 1, retryMaxDelayMs: 1 } }).store({
    job,
    provider,
    descriptor: { source: 'https://example.test/video.mp4', filename: 'output.mp4', mimeType: 'video/mp4' },
    repository,
    workerId: 'worker-a'
  });
  assert.equal(result.action, 'storage-retry');
  assert.deepEqual(calls, { downloads: 1, retried: 1, failed: 0 });
});

test('a completed BananaAI task keeps retrying transient storage failures past the short retry budget', async () => {
  const calls = { downloads: 0, retried: 0, failed: 0 };
  const provider = { fetchResultStream: async () => { calls.downloads += 1; throw new VideoStorageError('VIDEO_RESULT_IDLE_TIMEOUT', undefined, { retryable: true }); } };
  const repository = {
    recordStorageAttempt: async () => true,
    finalizeStoredResult: async () => { throw new Error('must not finalize'); },
    scheduleStorageRetry: async () => { calls.retried += 1; return true; },
    failStorageAndRelease: async () => { calls.failed += 1; return true; }
  };
  const job = { id: 'banana-storage-retry', user_id: 'banana-user', provider: 'bananaai', provider_job_id: 'provider-task', storage_attempts: 3 };
  const result = await createVideoResultOrchestrator({ storage, config: { maxBytes: 1024, timeoutMs: 1000, maxRedirects: 0, maxAttempts: 4, retryBaseDelayMs: 1, retryMaxDelayMs: 1 } }).store({
    job,
    provider,
    descriptor: { source: 'https://example.test/video.mp4', filename: 'output.mp4', mimeType: 'video/mp4' },
    repository,
    workerId: 'worker-a'
  });
  assert.equal(result.action, 'storage-retry');
  assert.deepEqual(calls, { downloads: 1, retried: 1, failed: 0 });
});
