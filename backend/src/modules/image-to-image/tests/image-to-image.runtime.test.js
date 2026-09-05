'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createImageToImageRuntime } = require('../worker/image-to-image.runtime');
const { resolveImageToImageWorkerMode } = require('../worker/image-to-image.bootstrap');

const dependencies = () => ({
  repository: {
    claimDue: async () => null,
    markSubmitted: async () => {},
    deferPoll: async () => {},
    complete: async () => {},
    fail: async () => {}
  },
  storage: {
    read: async () => Buffer.from('x'),
    saveResult: async () => ({ key: 'result.png', sizeBytes: 1 })
  },
  provider: {
    submit: async () => ({ taskId: 'task-1' }),
    poll: async () => ({ state: 'pending' }),
    download: async () => ({ buffer: Buffer.from('x'), mimeType: 'image/png' })
  }
});

function fakeTimers() {
  const state = { scheduled: 0, cleared: 0 };
  return {
    state,
    setInterval() {
      state.scheduled += 1;
      return { unref() {} };
    },
    clearInterval() {
      state.cleared += 1;
    }
  };
}

test('dedicated image-to-image worker mode starts and schedules ticks', async () => {
  const timers = fakeTimers();
  const runtime = createImageToImageRuntime({
    config: { enabled: true, workerMode: 'dedicated', runImmediately: false, workerIntervalMs: 1000, leaseSeconds: 60, pollIntervalSeconds: 3 },
    dependencies: dependencies(),
    timers,
    logger: { error() {} }
  });

  const result = await runtime.start();
  assert.deepEqual(result, { started: true, enabled: true, mode: 'dedicated' });
  assert.equal(runtime.isStarted(), true);
  assert.equal(timers.state.scheduled, 1);
  await runtime.stop();
  assert.equal(runtime.isStarted(), false);
  assert.equal(timers.state.cleared, 1);
});

test('unknown image-to-image worker mode stays disabled at runtime', async () => {
  const timers = fakeTimers();
  const runtime = createImageToImageRuntime({
    config: { enabled: true, workerMode: 'mystery', runImmediately: false, workerIntervalMs: 1000 },
    dependencies: dependencies(),
    timers
  });

  const result = await runtime.start();
  assert.deepEqual(result, { started: false, enabled: true, mode: 'mystery' });
  assert.equal(runtime.isStarted(), false);
  assert.equal(timers.state.scheduled, 0);
});

test('worker process mode defaults to embedded and accepts only explicit supported modes', () => {
  assert.equal(resolveImageToImageWorkerMode({}), 'embedded');
  assert.equal(resolveImageToImageWorkerMode({ IMAGE_TO_IMAGE_WORKER_MODE: 'dedicated' }), 'dedicated');
  assert.equal(resolveImageToImageWorkerMode({ IMAGE_TO_IMAGE_WORKER_MODE: 'disabled' }), 'disabled');
  assert.throws(
    () => resolveImageToImageWorkerMode({ IMAGE_TO_IMAGE_WORKER_MODE: 'dedicatd' }),
    (error) => error?.code === 'IMAGE_TO_IMAGE_WORKER_MODE_INVALID'
  );
});
