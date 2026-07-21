process.env.NODE_ENV = 'test';
const { Readable } = require('stream');
const { createLocalVideoStorage } = require('../../storage/local-video.storage');
const { createVideoResultOrchestrator } = require('../../storage/video-result-orchestrator');

const [root, point] = process.argv.slice(2);
const mp4 = Buffer.from('000000186674797069736f6d0000020069736f6d69736f6d', 'hex');
const storage = createLocalVideoStorage({ root, maxBytes: 1024, tempMaxAgeMinutes: 1, faultInjector: (current) => { if (current === point) process.exit(91); } });
const config = { maxBytes: 1024, timeoutMs: 1000, maxRedirects: 1, maxAttempts: 2, retryBaseDelayMs: 1, retryMaxDelayMs: 1 };
const repository = { recordStorageAttempt: async () => true, finalizeStoredResult: async () => ({ idempotent: false }), scheduleStorageRetry: async () => true, failStorageAndRelease: async () => true };
const provider = { fetchResultStream: async () => ({ stream: Readable.from([mp4]), mimeType: 'video/mp4' }) };
createVideoResultOrchestrator({ storage, config }).store({ job: { id: 'child-crash-job', user_id: 'child-crash-user', storage_attempts: 0 }, provider, descriptor: { source: 'fake://child', filename: 'output.mp4', mimeType: 'video/mp4' }, repository, workerId: 'child-worker' }).then(() => process.exit(0), () => process.exit(2));
