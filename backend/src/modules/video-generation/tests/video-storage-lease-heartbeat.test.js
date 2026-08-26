const test = require('node:test');
const assert = require('node:assert/strict');
const { createVideoJobProcessingService } = require('../worker/video-job-processing.service');

const now = new Date('2030-01-01T00:00:00.000Z');

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function intervalTimers() {
  let nextId = 0;
  const tasks = new Map();
  return {
    setInterval(fn, delay) {
      const id = ++nextId;
      tasks.set(id, { fn, delay });
      return id;
    },
    clearInterval(id) {
      tasks.delete(id);
    },
    async tick() {
      for (const task of [...tasks.values()]) task.fn();
      await flush();
      await flush();
    },
    get size() {
      return tasks.size;
    }
  };
}

function storingJob() {
  return {
    id: 'storage-lease-job',
    provider: 'fake',
    provider_job_id: 'provider-result-1',
    status: 'storing',
    worker_lease_owner: 'worker-1',
    poll_attempts: 1,
    storage_attempts: 0,
    expires_at: new Date(now.getTime() + 60_000)
  };
}

function makeSubject(store) {
  const timers = intervalTimers();
  const calls = { extensions: 0, storedFiles: 0, finalized: 0, submissions: 0, scheduled: 0, failed: 0, secondWorkerClaimed: null };
  let owner = 'worker-1';
  const repository = {
    extendJobLease: async ({ workerId }) => {
      calls.extensions += 1;
      return owner === workerId;
    },
    scheduleNextPoll: async ({ workerId }) => {
      calls.scheduled += 1;
      return owner === workerId;
    },
    failAndReleaseJob: async ({ workerId }) => {
      calls.failed += 1;
      return owner === workerId;
    }
  };
  const provider = {
    getJobStatus: async () => ({ status: 'storing' }),
    normalizeStatus: (value) => value.status,
    normalizeResult: () => ({ source: 'https://example.test/video.mp4', filename: 'video.mp4', mimeType: 'video/mp4' }),
    fetchResultStream: async () => {
      throw new Error('The storage test double must own result retrieval.');
    },
    submit: async () => {
      calls.submissions += 1;
      return { providerJobId: 'unexpected' };
    },
    submitTextToVideo: async () => {},
    submitImageToVideo: async () => {},
    sanitizeError: () => 'safe'
  };
  const service = createVideoJobProcessingService({
    repository,
    providerRegistry: { fake: provider },
    storageOrchestrator: {
      store: async (input) => store({ ...input, calls, timers, getOwner: () => owner, setOwner: (value) => { owner = value; }, repository })
    },
    config: { leaseMs: 1_000, providerDeadlineSeconds: 0, maxPollAttempts: 3, pollBaseDelayMs: 100, pollMaxDelayMs: 400 },
    clock: () => now,
    timers
  });
  return { service, timers, calls };
}

test('a long storing phase renews its lease, blocks a second worker, and finalizes one local file without another provider submit', async () => {
  const subject = makeSubject(async ({ assertLease, calls, timers, getOwner, setOwner }) => {
    await flush();
    await timers.tick();
    const claimedBySecondWorker = getOwner() === null;
    if (claimedBySecondWorker) setOwner('worker-2');
    calls.secondWorkerClaimed = claimedBySecondWorker;
    assert.equal(assertLease(), true);
    calls.storedFiles += 1;
    calls.finalized += 1;
    setOwner(null);
    return { action: 'succeeded' };
  });

  const result = await subject.service.processClaimedJob(storingJob(), { workerId: 'worker-1' });
  assert.equal(result.action, 'succeeded');
  assert.equal(subject.calls.extensions >= 4, true);
  assert.equal(subject.calls.secondWorkerClaimed, false);
  assert.equal(subject.calls.storedFiles, 1);
  assert.equal(subject.calls.finalized, 1);
  assert.equal(subject.calls.submissions, 0);
  assert.equal(subject.timers.size, 0);
});

test('the storage heartbeat is cleaned up after retry scheduling and download failure', async () => {
  const retry = makeSubject(async ({ timers }) => {
    await flush();
    await timers.tick();
    return { action: 'storage-retry', errorCode: 'VIDEO_RESULT_CONNECTION_RESET' };
  });
  assert.equal((await retry.service.processClaimedJob(storingJob(), { workerId: 'worker-1' })).action, 'storage-retry');
  assert.equal(retry.timers.size, 0);

  const failure = makeSubject(async ({ timers }) => {
    await flush();
    await timers.tick();
    throw Object.assign(new Error('download interrupted'), { code: 'VIDEO_RESULT_CONNECTION_RESET', retryable: true });
  });
  assert.equal((await failure.service.processClaimedJob(storingJob(), { workerId: 'worker-1' })).action, 'scheduled');
  assert.equal(failure.calls.scheduled, 1);
  assert.equal(failure.calls.failed, 0);
  assert.equal(failure.timers.size, 0);
});

test('ownership loss during storage prevents stale finalization, retry, failure, and provider submission', async () => {
  const subject = makeSubject(async ({ assertLease, calls, timers, setOwner }) => {
    await flush();
    setOwner('worker-2');
    await timers.tick();
    assert.equal(assertLease(), false);
    if (assertLease()) calls.finalized += 1;
    throw Object.assign(new Error('storage lease lost'), { code: 'VIDEO_WORKER_LEASE_LOST' });
  });

  const result = await subject.service.processClaimedJob(storingJob(), { workerId: 'worker-1' });
  assert.equal(result.action, 'ignored-lease-lost');
  assert.equal(subject.calls.finalized, 0);
  assert.equal(subject.calls.scheduled, 0);
  assert.equal(subject.calls.failed, 0);
  assert.equal(subject.calls.submissions, 0);
  assert.equal(subject.timers.size, 0);
});
