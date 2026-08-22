'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createImageToImageWorker } = require('../worker/image-to-image.worker');
const { createMetisImageToImageProvider } = require('../providers/metis-image-to-image.provider');

test('submits a queued job, then stores and settles its completed result', async () => {
  const calls = [];
  const queuedJob = { id: 'job-1', status: 'queued', prompt: 'make it blue', aspect_ratio: '1:1', sources: [{ key: 'job-1/inputs/1.png', mimeType: 'image/png' }] };
  const submittedJob = { ...queuedJob, status: 'submitted', provider_task_id: 'metis-task-1' };
  const repository = {
    claimDue: async () => calls.some((call) => call.type === 'markSubmitted') ? submittedJob : queuedJob,
    markSubmitted: async (value) => calls.push({ type: 'markSubmitted', value }),
    deferPoll: async (value) => calls.push({ type: 'deferPoll', value }),
    complete: async (value) => calls.push({ type: 'complete', value }),
    fail: async (value) => calls.push({ type: 'fail', value })
  };
  const worker = createImageToImageWorker({
    repository,
    storage: { read: async () => Buffer.from('source'), saveResult: async () => ({ key: 'job-1/result/image.png', sizeBytes: 6 }) },
    provider: { submit: async () => ({ taskId: 'metis-task-1' }), poll: async () => ({ state: 'completed', resultUrl: 'https://result.example/image.png' }), download: async () => ({ buffer: Buffer.from('result'), mimeType: 'image/png' }) },
    config: { leaseSeconds: 60, pollIntervalSeconds: 3 },
    logger: { error: () => {} },
    workerId: 'test-worker'
  });
  assert.equal((await worker.tick()).action, 'submitted');
  assert.equal((await worker.tick()).action, 'completed');
  assert.deepEqual(calls.map((call) => call.type), ['markSubmitted', 'complete']);
  assert.equal(calls[1].value.result.mimeType, 'image/png');
});

test('rejects a provider result URL outside the allowlist before downloading it', async () => {
  let downloaded = false;
  const provider = createMetisImageToImageProvider({
    httpClient: { get: async () => { downloaded = true; return {}; } },
    apiKey: 'test-key',
    allowedResultHosts: ['cdn.metisai.ir']
  });
  await assert.rejects(() => provider.download({ resultUrl: 'https://127.0.0.1/internal.png' }), { code: 'IMAGE_TO_IMAGE_RESULT_URL_REJECTED' });
  assert.equal(downloaded, false);
});

test('uses the Metis Imagine operation for reference-image generation', async () => {
  const requests = [];
  const provider = createMetisImageToImageProvider({
    httpClient: {
      post: async (url, body) => {
        requests.push({ url, body });
        if (url.endsWith('/api/v1/storage')) return { data: { files: [{ url: 'https://api.metisai.ir/input.png' }] } };
        return { data: { id: 'metis-task-1' } };
      }
    },
    apiKey: 'test-key'
  });
  await provider.submit({ prompt: 'make it blue', aspectRatio: '1:1', sources: [{ buffer: Buffer.from('source'), extension: 'png', mimeType: 'image/png' }] });
  assert.equal(requests[1].body.operation, 'Imagine');
});
