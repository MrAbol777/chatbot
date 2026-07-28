'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

const { createVideoWorkerRepository } = require('../worker/video-worker.repository');
const { createVideoJobProcessingService } = require('../worker/video-job-processing.service');
const { createVideoGenerationWorker } = require('../worker/video-generation.worker');
const { createFakeVideoProvider } = require('../providers/fake-video.provider');
const { createNoaVideoDbFixture } = require('./noa-video-db.fixture');

let pool;
let noa;
const config = {
  leaseMs: 5_000,
  batchSize: 5,
  maxPollAttempts: 3,
  pollBaseDelayMs: 100,
  pollMaxDelayMs: 400
};

function repository() {
  return createVideoWorkerRepository(pool, {
    noaBillingService: noa.billing
  });
}

function worker(provider, workerId = `worker-${randomUUID().slice(0, 8)}`) {
  const value = repository();
  const service = createVideoJobProcessingService({
    repository: value,
    providerRegistry: { fake: provider },
    config
  });
  return createVideoGenerationWorker({
    repository: value,
    processingService: service,
    config,
    workerId
  });
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
    connectionLimit: 8
  });
  noa = createNoaVideoDbFixture(pool);
  await noa.initialize();
});

test.afterEach(async () => noa.cleanup());
test.after(async () => {
  try {
    await noa.cleanup();
  } finally {
    await pool.end();
  }
});

test('worker claims a provider success and captures Noa once', async () => {
  const fixture = await noa.createJob();
  const provider = createFakeVideoProvider();
  provider.plan(fixture.providerJobId, 'succeeded');

  await worker(provider).tick();
  const current = await noa.state(fixture);
  assert.equal(current.job.status, 'succeeded');
  assert.equal(current.reservation.status, 'captured');
  assert.equal(current.wallet.reservedNoa, '0.000000');
});

test('worker releases Noa when the provider fails', async () => {
  const fixture = await noa.createJob();
  const provider = createFakeVideoProvider();
  provider.plan(fixture.providerJobId, 'failed');

  await worker(provider).tick();
  const current = await noa.state(fixture);
  assert.equal(current.job.status, 'failed');
  assert.equal(current.reservation.status, 'released');
  assert.equal(current.wallet.availableNoa, fixture.amountNoa);
});

test('processing response schedules another poll and keeps Noa reserved', async () => {
  const fixture = await noa.createJob();
  const provider = createFakeVideoProvider();
  provider.plan(fixture.providerJobId, 'processing');

  await worker(provider).tick();
  const current = await noa.state(fixture);
  assert.equal(current.job.status, 'submitted');
  assert.equal(current.job.worker_lease_owner, null);
  assert.equal(Number(current.job.poll_attempts), 1);
  assert.equal(current.reservation.status, 'reserved');
  assert.equal(current.wallet.reservedNoa, fixture.amountNoa);
});

test('temporary provider network failure keeps Noa reserved for retry', async () => {
  const fixture = await noa.createJob();
  const provider = createFakeVideoProvider();
  provider.plan(fixture.providerJobId, 'network_error');

  await worker(provider).tick();
  const current = await noa.state(fixture);
  assert.equal(current.job.status, 'submitted');
  assert.equal(current.reservation.status, 'reserved');
});

test('expired job releases Noa without provider polling', async () => {
  const fixture = await noa.createJob({
    expiresAt: new Date(Date.now() - 60_000)
  });
  const provider = createFakeVideoProvider();
  provider.plan(fixture.providerJobId, 'succeeded');

  await worker(provider).tick();
  const current = await noa.state(fixture);
  assert.equal(current.job.status, 'expired');
  assert.equal(current.reservation.status, 'released');
  assert.equal(current.wallet.availableNoa, fixture.amountNoa);
  assert.equal(provider.pollCount(fixture.providerJobId), 0);
});

test('maximum poll attempts expires the job and releases Noa', async () => {
  const fixture = await noa.createJob({ pollAttempts: 3 });
  const provider = createFakeVideoProvider();
  provider.plan(fixture.providerJobId, 'succeeded');

  await worker(provider).tick();
  const current = await noa.state(fixture);
  assert.equal(current.job.status, 'expired');
  assert.equal(
    current.job.safe_error_code,
    'VIDEO_MAX_POLL_ATTEMPTS_REACHED'
  );
  assert.equal(current.reservation.status, 'released');
});

test('restart recovery claims an expired old lease', async () => {
  const fixture = await noa.createJob({
    status: 'processing',
    workerLeaseOwner: 'old',
    workerLeaseUntil: new Date(Date.now() - 1_000)
  });
  const provider = createFakeVideoProvider();
  provider.plan(fixture.providerJobId, 'succeeded');

  await worker(provider, 'new-worker').tick();
  assert.equal((await noa.state(fixture)).job.status, 'succeeded');
});

test('wrong lease owner cannot settle a claimed job', async () => {
  const fixture = await noa.createJob();
  const value = repository();
  const [claimed] = await value.claimPollableJobs({
    workerId: 'owner-a',
    leaseSeconds: 30
  });
  await pool.query(
    "UPDATE app_video_generations SET worker_lease_owner='owner-b' WHERE id=?",
    [fixture.jobId]
  );
  const provider = createFakeVideoProvider();
  provider.plan(fixture.providerJobId, 'succeeded');
  const service = createVideoJobProcessingService({
    repository: value,
    providerRegistry: { fake: provider },
    config
  });

  const result = await service.processClaimedJob(claimed, {
    workerId: 'owner-a'
  });
  assert.equal(result.action, 'ignored-lease-lost');
  assert.equal((await noa.state(fixture)).job.status, 'submitted');
});

test('terminal jobs are never polled twice', async () => {
  const fixture = await noa.createJob();
  const provider = createFakeVideoProvider();
  provider.plan(fixture.providerJobId, 'succeeded');
  const value = worker(provider);

  await value.tick();
  await value.tick();
  assert.equal(provider.pollCount(fixture.providerJobId), 1);
});

test('duplicate provider success captures Noa once', async () => {
  const fixture = await noa.createJob();
  const provider = createFakeVideoProvider();
  provider.plan(fixture.providerJobId, ['succeeded', 'succeeded']);
  const value = worker(provider);

  await value.tick();
  await value.tick();
  const current = await noa.state(fixture);
  assert.equal(current.reservation.status, 'captured');
  assert.equal(current.wallet.availableNoa, '0.000000');
  assert.equal(current.wallet.reservedNoa, '0.000000');
});

test('duplicate provider failure releases Noa once', async () => {
  const fixture = await noa.createJob();
  const provider = createFakeVideoProvider();
  provider.plan(fixture.providerJobId, ['failed', 'failed']);
  const value = worker(provider);

  await value.tick();
  await value.tick();
  const current = await noa.state(fixture);
  assert.equal(current.reservation.status, 'released');
  assert.equal(current.wallet.availableNoa, fixture.amountNoa);
  assert.equal(current.wallet.reservedNoa, '0.000000');
});

test('two concurrent workers make one effective poll', async () => {
  const fixture = await noa.createJob();
  const provider = createFakeVideoProvider();
  provider.plan(fixture.providerJobId, 'succeeded');

  await Promise.all([
    worker(provider, 'concurrent-a').tick(),
    worker(provider, 'concurrent-b').tick()
  ]);
  assert.equal(provider.pollCount(fixture.providerJobId), 1);
  assert.equal((await noa.state(fixture)).job.status, 'succeeded');
});

test('one tick handles multiple jobs and settles each Noa reservation', async () => {
  const success = await noa.createJob();
  const failure = await noa.createJob();
  const provider = createFakeVideoProvider();
  provider.plan(success.providerJobId, 'succeeded');
  provider.plan(failure.providerJobId, 'failed');

  const output = await worker(provider).tick();
  assert.equal(output.processed, 2);
  assert.equal((await noa.state(success)).reservation.status, 'captured');
  assert.equal((await noa.state(failure)).reservation.status, 'released');
});

test('a temporary error does not block a following job', async () => {
  const retry = await noa.createJob();
  const success = await noa.createJob();
  const provider = createFakeVideoProvider();
  provider.plan(retry.providerJobId, 'http_500');
  provider.plan(success.providerJobId, 'succeeded');

  await worker(provider).tick();
  assert.equal((await noa.state(retry)).reservation.status, 'reserved');
  assert.equal((await noa.state(success)).reservation.status, 'captured');
});

test('different durations use their own dynamic Noa amounts', async () => {
  const success = await noa.createJob({ duration: '2' });
  const failure = await noa.createJob({ duration: '3' });
  const provider = createFakeVideoProvider();
  provider.plan(success.providerJobId, 'succeeded');
  provider.plan(failure.providerJobId, 'failed');

  await worker(provider).tick();
  const successState = await noa.state(success);
  const failureState = await noa.state(failure);
  assert.notEqual(success.amountNoa, failure.amountNoa);
  assert.equal(successState.reservation.status, 'captured');
  assert.equal(failureState.wallet.availableNoa, failure.amountNoa);
});
