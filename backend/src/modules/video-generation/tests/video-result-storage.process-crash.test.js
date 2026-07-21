process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { Readable } = require('stream');
const { createLocalVideoStorage } = require('../storage/local-video.storage');
const { createVideoResultOrchestrator } = require('../storage/video-result-orchestrator');

const mp4 = Buffer.from('000000186674797069736f6d0000020069736f6d69736f6d', 'hex');
const child = path.join(__dirname, 'fixtures', 'video-storage-crash-child.js');
const config = { maxBytes: 1024, timeoutMs: 1000, maxRedirects: 1, maxAttempts: 2, retryBaseDelayMs: 1, retryMaxDelayMs: 1 };
const job = { id: 'child-crash-job', user_id: 'child-crash-user', storage_attempts: 0 };
const descriptor = { source: 'fake://never-connected', filename: 'output.mp4', mimeType: 'video/mp4' };
const key = `results/${crypto.createHash('sha256').update(job.user_id).digest('hex').slice(0, 24)}/${job.id}/output.mp4`;

function runCrash(root, point) { try { execFileSync(process.execPath, [child, root, point], { env: { ...process.env, NODE_ENV: 'test' }, stdio: 'pipe' }); } catch (error) { assert.equal(error.status, 91); } }
function repository() { return { recordStorageAttempt: async () => true, finalizeStoredResult: async () => ({ idempotent: false }), scheduleStorageRetry: async () => true, failStorageAndRelease: async () => true }; }

test('child process crash after rename leaves a reusable final file without a second download', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'video-process-crash-'));
  try {
    runCrash(root, 'after_atomic_rename');
    const storage = createLocalVideoStorage({ root, maxBytes: 1024, tempMaxAgeMinutes: 1 });
    assert.equal(await storage.exists(key), true);
    let downloads = 0;
    const result = await createVideoResultOrchestrator({ storage, config }).store({ job, descriptor, repository: repository(), workerId: 'recovery-worker', provider: { fetchResultStream: async () => { downloads += 1; return { stream: Readable.from([mp4]), mimeType: 'video/mp4' }; } } });
    assert.equal(result.reusedExistingFile, true); assert.equal(downloads, 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('child process crash during stream leaves no final file and recovery downloads once', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'video-process-crash-'));
  try {
    runCrash(root, 'mid_write_stream');
    const storage = createLocalVideoStorage({ root, maxBytes: 1024, tempMaxAgeMinutes: 1 });
    assert.equal(await storage.exists(key), false);
    let downloads = 0;
    await createVideoResultOrchestrator({ storage, config }).store({ job, descriptor, repository: repository(), workerId: 'recovery-worker', provider: { fetchResultStream: async () => { downloads += 1; return { stream: Readable.from([mp4]), mimeType: 'video/mp4' }; } } });
    assert.equal(downloads, 1); assert.equal(await storage.exists(key), true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
