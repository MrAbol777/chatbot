'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

const { createVideoWorkerRepository } = require('../worker/video-worker.repository');
const { createVideoJobProcessingService } = require('../worker/video-job-processing.service');
const { createVideoGenerationWorker } = require('../worker/video-generation.worker');
const { createVideoWorkerRuntime } = require('../worker/video-worker.runtime');
const { createFakeVideoProvider } = require('../providers/fake-video.provider');
const { createNoaVideoDbFixture } = require('./noa-video-db.fixture');

let pool;
let noa;
const runtimes = new Set();
const config = Object.freeze({
  enabled: true,
  processMode: 'embedded',
  runImmediately: false,
  intervalMs: 1000,
  shutdownTimeoutMs: 100,
  leaseMs: 10_000,
  batchSize: 2,
  jobTimeoutMinutes: 30,
  maxPollAttempts: 3,
  pollBaseDelayMs: 50,
  pollMaxDelayMs: 100
});

function runtime(provider, owner = `runtime-${randomUUID().slice(0, 8)}`) {
  const repository = createVideoWorkerRepository(pool, {
    noaBillingService: noa.billing
  });
  const processingService = createVideoJobProcessingService({
    repository,
    providerRegistry: { fake: provider },
    config
  });
  const value = createVideoWorkerRuntime({
    config,
    workerDependencies: {
      repository,
      processingService,
      config,
      workerId: owner
    },
    createWorker: createVideoGenerationWorker
  });
  runtimes.add(value);
  return value;
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

test.afterEach(async () => {
  await Promise.all([...runtimes].map((value) => value.stop()));
  runtimes.clear();
  await noa.cleanup();
});

test.after(async () => {
  try {
    await noa.cleanup();
  } finally {
    await pool.end();
  }
});

test('runtime processes a success and captures Noa on a manual first tick', async () => {
  const fixture = await noa.createJob();
  const provider = createFakeVideoProvider();
  provider.plan(fixture.providerJobId, 'succeeded');
  const value = runtime(provider);

  await value.start();
  await value.runTickNow();
  const current = await noa.state(fixture);
  assert.equal(current.job.status, 'succeeded');
  assert.equal(current.reservation.status, 'captured');
});

test('terminal jobs are absent from a second runtime tick', async () => {
  const fixture = await noa.createJob();
  const provider = createFakeVideoProvider();
  provider.plan(fixture.providerJobId, 'succeeded');
  const value = runtime(provider);

  await value.start();
  await value.runTickNow();
  await value.runTickNow();
  assert.equal(provider.pollCount(fixture.providerJobId), 1);
});

test('multiple jobs are settled across runtime ticks', async () => {
  const success = await noa.createJob();
  const failure = await noa.createJob();
  const provider = createFakeVideoProvider();
  provider.plan(success.providerJobId, 'succeeded');
  provider.plan(failure.providerJobId, 'failed');
  const value = runtime(provider);

  await value.start();
  await value.runTickNow();
  assert.equal((await noa.state(success)).reservation.status, 'captured');
  assert.equal((await noa.state(failure)).reservation.status, 'released');
});

test('two runtimes make one effective MariaDB poll', async () => {
  const fixture = await noa.createJob();
  const provider = createFakeVideoProvider();
  provider.plan(fixture.providerJobId, 'succeeded');
  const first = runtime(provider, 'runtime-a');
  const second = runtime(provider, 'runtime-b');

  await Promise.all([first.start(), second.start()]);
  await Promise.all([first.runTickNow(), second.runTickNow()]);
  assert.equal(provider.pollCount(fixture.providerJobId), 1);
  assert.equal((await noa.state(fixture)).reservation.status, 'captured');
});

test('a runtime does not overlap an in-flight MariaDB tick', async () => {
  const fixture = await noa.createJob();
  const provider = createFakeVideoProvider();
  provider.plan(fixture.providerJobId, 'succeeded');
  const original = provider.getJobStatus;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  provider.getJobStatus = async (providerJobId) => {
    await gate;
    return original(providerJobId);
  };
  const value = runtime(provider);

  await value.start();
  const first = value.runTickNow();
  assert.equal((await value.runTickNow()).action, 'overlap-ignored');
  release();
  await first;
  assert.equal((await noa.state(fixture)).job.status, 'succeeded');
});

test('a later runtime recovers an expired lease', async () => {
  const fixture = await noa.createJob({
    status: 'processing',
    workerLeaseOwner: 'old',
    workerLeaseUntil: new Date(Date.now() - 1_000)
  });
  const provider = createFakeVideoProvider();
  provider.plan(fixture.providerJobId, 'succeeded');
  const value = runtime(provider);

  await value.start();
  await value.runTickNow();
  assert.equal((await noa.state(fixture)).reservation.status, 'captured');
});

test('temporary provider error keeps Noa reserved until the next success', async () => {
  const fixture = await noa.createJob();
  const provider = createFakeVideoProvider();
  provider.plan(fixture.providerJobId, ['http_500', 'succeeded']);
  const value = runtime(provider);

  await value.start();
  await value.runTickNow();
  assert.equal((await noa.state(fixture)).reservation.status, 'reserved');
  await pool.query(
    'UPDATE app_video_generations SET next_poll_at=NOW() WHERE id=?',
    [fixture.jobId]
  );
  await value.runTickNow();
  assert.equal((await noa.state(fixture)).reservation.status, 'captured');
});

test('expired jobs release Noa without provider polling', async () => {
  const fixture = await noa.createJob({
    expiresAt: new Date(Date.now() - 60_000)
  });
  const provider = createFakeVideoProvider();
  const value = runtime(provider);

  await value.start();
  await value.runTickNow();
  const current = await noa.state(fixture);
  assert.equal(current.job.status, 'expired');
  assert.equal(current.reservation.status, 'released');
  assert.equal(current.wallet.availableNoa, fixture.amountNoa);
  assert.equal(provider.pollCount(fixture.providerJobId), 0);
});

test('runtime state remains free of job and provider data', async () => {
  const value = runtime(createFakeVideoProvider());
  await value.start();
  const state = value.getState();
  assert.equal('providerJobId' in state, false);
  assert.equal('prompt' in state, false);
});
