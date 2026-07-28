'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

const { createVideoWorkerRepository } = require('../worker/video-worker.repository');
const { createNoaVideoDbFixture } = require('./noa-video-db.fixture');

let pool;
let noa;

function workerRepository(options = {}) {
  return createVideoWorkerRepository(pool, {
    noaBillingService: noa.billing,
    ...options
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

test('claims one pollable job with an exclusive lease', async () => {
  const fixture = await noa.createJob();
  const claimed = await workerRepository().claimPollableJobs({
    workerId: 'worker-a'
  });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].id, fixture.jobId);
  assert.equal(claimed[0].worker_lease_owner, 'worker-a');
});

test('an active lease blocks a second claim', async () => {
  await noa.createJob();
  const repository = workerRepository();
  assert.equal(
    (await repository.claimPollableJobs({ workerId: 'worker-a' })).length,
    1
  );
  assert.equal(
    (await repository.claimPollableJobs({ workerId: 'worker-b' })).length,
    0
  );
});

test('an expired lease is claimable again', async () => {
  const fixture = await noa.createJob();
  const repository = workerRepository();
  await repository.claimPollableJobs({ workerId: 'worker-a' });
  await pool.query(
    'UPDATE app_video_generations SET worker_lease_until=DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE id=?',
    [fixture.jobId]
  );
  const [claimed] = await repository.claimPollableJobs({ workerId: 'worker-b' });
  assert.equal(claimed.worker_lease_owner, 'worker-b');
});

test('two connections concurrently claim only one job', async () => {
  await noa.createJob();
  const [one, two] = await Promise.all([
    workerRepository().claimPollableJobs({ workerId: 'worker-a' }),
    workerRepository().claimPollableJobs({ workerId: 'worker-b' })
  ]);
  assert.equal(one.length + two.length, 1);
});

test('success captures reserved Noa transactionally', async () => {
  const fixture = await noa.createJob({ duration: '2' });
  await workerRepository().finalizeSuccessfulJob({ jobId: fixture.jobId });
  const current = await noa.state(fixture);

  assert.equal(current.job.status, 'succeeded');
  assert.equal(current.reservation.status, 'captured');
  assert.equal(current.wallet.availableNoa, '0.000000');
  assert.equal(current.wallet.reservedNoa, '0.000000');
});

test('repeated success capture is idempotent', async () => {
  const fixture = await noa.createJob();
  const repository = workerRepository();
  await repository.finalizeSuccessfulJob({ jobId: fixture.jobId });
  const replay = await repository.finalizeSuccessfulJob({ jobId: fixture.jobId });
  const current = await noa.state(fixture);

  assert.equal(replay.idempotent, true);
  assert.equal(current.reservation.status, 'captured');
  assert.equal(current.wallet.reservedNoa, '0.000000');
});

test('two concurrent success callbacks capture Noa once', async () => {
  const fixture = await noa.createJob();
  const outcomes = await Promise.allSettled([
    workerRepository().finalizeSuccessfulJob({ jobId: fixture.jobId }),
    workerRepository().finalizeSuccessfulJob({ jobId: fixture.jobId })
  ]);
  const current = await noa.state(fixture);

  assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 2);
  assert.equal(current.reservation.status, 'captured');
  assert.equal(current.wallet.availableNoa, '0.000000');
  assert.equal(current.wallet.reservedNoa, '0.000000');
});

test('provider failure releases all reserved Noa', async () => {
  const fixture = await noa.createJob({ duration: '2' });
  await workerRepository().failAndReleaseJob({
    jobId: fixture.jobId,
    errorCode: 'TEST_FAILURE',
    errorMessage: 'safe failure'
  });
  const current = await noa.state(fixture);

  assert.equal(current.job.status, 'failed');
  assert.equal(current.reservation.status, 'released');
  assert.equal(current.wallet.availableNoa, fixture.amountNoa);
  assert.equal(current.wallet.reservedNoa, '0.000000');
});

test('repeated failure release is idempotent', async () => {
  const fixture = await noa.createJob();
  const repository = workerRepository();
  await repository.failAndReleaseJob({ jobId: fixture.jobId });
  const replay = await repository.failAndReleaseJob({ jobId: fixture.jobId });
  const current = await noa.state(fixture);

  assert.equal(replay.idempotent, true);
  assert.equal(current.wallet.availableNoa, fixture.amountNoa);
  assert.equal(current.wallet.reservedNoa, '0.000000');
});

test('two concurrent releases credit available Noa once', async () => {
  const fixture = await noa.createJob();
  const outcomes = await Promise.allSettled([
    workerRepository().failAndReleaseJob({ jobId: fixture.jobId }),
    workerRepository().failAndReleaseJob({ jobId: fixture.jobId })
  ]);
  const current = await noa.state(fixture);

  assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 2);
  assert.equal(current.wallet.availableNoa, fixture.amountNoa);
  assert.equal(current.wallet.reservedNoa, '0.000000');
});

test('expiration releases Noa and marks the job expired', async () => {
  const fixture = await noa.createJob();
  await workerRepository().expireAndReleaseJob({ jobId: fixture.jobId });
  const current = await noa.state(fixture);

  assert.equal(current.job.status, 'expired');
  assert.equal(current.reservation.status, 'released');
  assert.equal(current.reservation.release_reason, 'job_expired');
  assert.equal(current.wallet.availableNoa, fixture.amountNoa);
});

test('success and failure race leaves one consistent terminal settlement', async () => {
  const fixture = await noa.createJob();
  const outcomes = await Promise.allSettled([
    workerRepository().finalizeSuccessfulJob({ jobId: fixture.jobId }),
    workerRepository().failAndReleaseJob({ jobId: fixture.jobId })
  ]);
  const current = await noa.state(fixture);

  assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1);
  assert.ok(['succeeded', 'failed'].includes(current.job.status));
  assert.equal(
    current.reservation.status,
    current.job.status === 'succeeded' ? 'captured' : 'released'
  );
  assert.equal(current.wallet.reservedNoa, '0.000000');
  assert.equal(
    current.wallet.availableNoa,
    current.job.status === 'succeeded' ? '0.000000' : fixture.amountNoa
  );
});

test('terminal jobs are never claimed again', async () => {
  const fixture = await noa.createJob();
  await workerRepository().finalizeSuccessfulJob({ jobId: fixture.jobId });
  const claimed = await workerRepository().claimPollableJobs({
    workerId: 'worker-a'
  });
  assert.equal(claimed.length, 0);
});

test('a future next_poll_at is not claimable', async () => {
  await noa.createJob({ nextPollAt: new Date(Date.now() + 60 * 60 * 1000) });
  assert.equal(
    (await workerRepository().claimPollableJobs({ workerId: 'worker-a' })).length,
    0
  );
});

test('a processing job is claimable', async () => {
  const fixture = await noa.createJob({ status: 'processing' });
  const [claimed] = await workerRepository().claimPollableJobs({
    workerId: 'worker-a'
  });
  assert.equal(claimed.id, fixture.jobId);
});

test('an inconsistent reserved wallet balance cannot go negative', async () => {
  const fixture = await noa.createJob({ duration: '2' });
  await pool.query(
    `UPDATE app_noa_wallets
        SET reserved_balance='1.000000'
      WHERE user_id=?`,
    [fixture.userId]
  );

  await assert.rejects(
    workerRepository().finalizeSuccessfulJob({ jobId: fixture.jobId }),
    { code: 'NOA_LEDGER_INVARIANT_VIOLATION' }
  );
  const current = await noa.state(fixture);
  assert.equal(current.job.status, 'submitted');
  assert.equal(current.reservation.status, 'reserved');
  assert.equal(current.wallet.reservedNoa, '1.000000');
});

test('failure stores bounded safe errors and clears the lease', async () => {
  const fixture = await noa.createJob({
    workerLeaseOwner: 'worker-a',
    workerLeaseUntil: new Date(Date.now() + 60_000)
  });
  await workerRepository().failAndReleaseJob({
    jobId: fixture.jobId,
    workerId: 'worker-a',
    errorCode: 'E'.repeat(200),
    errorMessage: 'M'.repeat(600)
  });
  const current = await noa.state(fixture);

  assert.equal(current.job.safe_error_code.length, 100);
  assert.equal(current.job.safe_error_message.length, 500);
  assert.equal(current.job.worker_lease_owner, null);
  assert.equal(current.job.worker_lease_until, null);
});

test('multiple jobs for one user settle independent Noa reservations', async () => {
  const first = await noa.createJob();
  const second = await noa.createJob({ userId: first.userId });
  const repository = workerRepository();

  await repository.finalizeSuccessfulJob({ jobId: first.jobId });
  await repository.failAndReleaseJob({ jobId: second.jobId });

  const firstState = await noa.state(first);
  const secondState = await noa.state(second);
  assert.equal(firstState.reservation.status, 'captured');
  assert.equal(secondState.reservation.status, 'released');
  assert.equal(secondState.wallet.availableNoa, second.amountNoa);
  assert.equal(secondState.wallet.reservedNoa, '0.000000');
});

for (const point of ['before_reservation_change', 'before_job_change']) {
  test(`fault injection at ${point} rolls back job and Noa together`, async () => {
    const fixture = await noa.createJob({ duration: '2' });
    const repository = workerRepository({
      faultInjector: (current) => {
        if (current === point) throw new Error(`fault:${point}`);
      }
    });

    await assert.rejects(
      repository.finalizeSuccessfulJob({ jobId: fixture.jobId }),
      /fault:/
    );
    const current = await noa.state(fixture);
    assert.equal(current.job.status, 'submitted');
    assert.equal(current.reservation.status, 'reserved');
    assert.equal(current.wallet.availableNoa, '0.000000');
    assert.equal(current.wallet.reservedNoa, fixture.amountNoa);
  });
}

test('lease methods enforce ownership and recover expired leases', async () => {
  const fixture = await noa.createJob();
  const repository = workerRepository();
  await repository.claimPollableJobs({ workerId: 'worker-a', leaseSeconds: 30 });

  assert.equal(
    await repository.extendJobLease({
      jobId: fixture.jobId,
      workerId: 'worker-b'
    }),
    false
  );
  assert.equal(
    await repository.scheduleNextPoll({
      jobId: fixture.jobId,
      workerId: 'worker-a',
      nextPollAt: new Date(Date.now() + 60_000)
    }),
    true
  );
  await pool.query(
    `UPDATE app_video_generations
        SET worker_lease_owner='worker-a',
            worker_lease_until=DATE_SUB(NOW(), INTERVAL 1 SECOND)
      WHERE id=?`,
    [fixture.jobId]
  );
  assert.equal(await repository.recoverExpiredLeases(), 1);
  assert.equal((await noa.state(fixture)).job.worker_lease_owner, null);
});

test('stored-result finalization captures Noa transactionally and idempotently', async () => {
  const fixture = await noa.createJob({ duration: '2', status: 'storing' });
  const repository = workerRepository();
  await repository.finalizeStoredResult({
    jobId: fixture.jobId,
    storageKey: `results/${fixture.jobId}/output.mp4`,
    mimeType: 'video/mp4',
    sizeBytes: 24,
    sha256: 'a'.repeat(64),
    originalFilename: 'output.mp4'
  });
  const current = await noa.state(fixture);

  assert.equal(current.job.status, 'succeeded');
  assert.equal(current.job.result_storage_status, 'stored');
  assert.equal(current.reservation.status, 'captured');
  assert.equal(current.wallet.reservedNoa, '0.000000');

  const replay = await repository.finalizeStoredResult({
    jobId: fixture.jobId,
    storageKey: 'ignored.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 24,
    sha256: 'b'.repeat(64),
    originalFilename: 'ignored.mp4'
  });
  assert.equal(replay.idempotent, true);
});

for (const point of [
  'before_stored_metadata',
  'after_stored_metadata',
  'before_noa_capture',
  'after_noa_capture',
  'before_lease_clear'
]) {
  test(`stored-result fault at ${point} rolls back metadata and Noa`, async () => {
    const fixture = await noa.createJob({ duration: '2', status: 'storing' });
    const repository = workerRepository({
      faultInjector: (current) => {
        if (current === point) throw new Error(`fault:${point}`);
      }
    });

    await assert.rejects(
      repository.finalizeStoredResult({
        jobId: fixture.jobId,
        storageKey: `results/${fixture.jobId}/output.mp4`,
        mimeType: 'video/mp4',
        sizeBytes: 24,
        sha256: 'c'.repeat(64),
        originalFilename: 'output.mp4'
      }),
      /fault:/
    );
    const current = await noa.state(fixture);
    assert.equal(current.job.status, 'storing');
    assert.equal(current.job.result_storage_status, null);
    assert.equal(current.reservation.status, 'reserved');
    assert.equal(current.wallet.reservedNoa, fixture.amountNoa);
  });
}
