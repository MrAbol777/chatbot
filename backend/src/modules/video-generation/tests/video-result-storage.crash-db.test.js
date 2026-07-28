'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { execFileSync } = require('node:child_process');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

const { createVideoWorkerRepository } = require('../worker/video-worker.repository');
const { createLocalVideoStorage } = require('../storage/local-video.storage');
const { createVideoResultOrchestrator } = require('../storage/video-result-orchestrator');
const { createNoaVideoDbFixture } = require('./noa-video-db.fixture');

const mp4 = Buffer.from(
  '000000186674797069736f6d0000020069736f6d69736f6d',
  'hex'
);
const config = {
  maxBytes: 1024,
  timeoutMs: 1000,
  maxRedirects: 1,
  maxAttempts: 2,
  retryBaseDelayMs: 1,
  retryMaxDelayMs: 1
};

let pool;
let noa;

function repository() {
  return createVideoWorkerRepository(pool, {
    noaBillingService: noa.billing
  });
}

async function storageFixture() {
  return noa.createJob({
    status: 'storing',
    workerLeaseOwner: 'worker-a',
    workerLeaseUntil: new Date(Date.now() + 60_000),
    additionalColumns: {
      next_storage_attempt_at: new Date()
    }
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
    connectionLimit: 4
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

test('restart recovery reuses the renamed file and captures Noa exactly once', async () => {
  const fixture = await storageFixture();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'video-storage-db-'));
  try {
    const crash = Object.assign(new Error('process crash'), {
      simulateCrash: true
    });
    let downloads = 0;
    const provider = {
      fetchResultStream: async () => {
        downloads += 1;
        return {
          stream: Readable.from([mp4]),
          mimeType: 'video/mp4'
        };
      }
    };
    const descriptor = {
      source: 'fake://local',
      filename: 'output.mp4',
      mimeType: 'video/mp4'
    };
    const crashing = createVideoResultOrchestrator({
      storage: createLocalVideoStorage({
        root,
        maxBytes: 1024,
        tempMaxAgeMinutes: 1,
        faultInjector: (point) => {
          if (point === 'after_atomic_rename') throw crash;
        }
      }),
      config
    });

    const initial = await noa.state(fixture);
    await assert.rejects(
      () => crashing.store({
        job: initial.job,
        provider,
        descriptor,
        repository: repository(),
        workerId: 'worker-a'
      }),
      (error) => error === crash
    );
    assert.equal((await noa.state(fixture)).reservation.status, 'reserved');

    await pool.query(
      'UPDATE app_video_generations SET worker_lease_until=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE id=?',
      [fixture.jobId]
    );
    const value = repository();
    const [claimed] = await value.claimPollableJobs({ workerId: 'worker-b' });
    assert.equal(claimed.id, fixture.jobId);

    const recovered = await createVideoResultOrchestrator({
      storage: createLocalVideoStorage({
        root,
        maxBytes: 1024,
        tempMaxAgeMinutes: 1
      }),
      config
    }).store({
      job: claimed,
      provider,
      descriptor,
      repository: value,
      workerId: 'worker-b'
    });
    const current = await noa.state(fixture);

    assert.equal(recovered.reusedExistingFile, true);
    assert.equal(downloads, 1);
    assert.equal(current.job.status, 'succeeded');
    assert.equal(current.reservation.status, 'captured');
    assert.equal(current.wallet.availableNoa, '0.000000');
    assert.equal(current.wallet.reservedNoa, '0.000000');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('two MariaDB workers claim one storing job and perform one capture', async () => {
  const fixture = await storageFixture();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'video-storage-db-'));
  try {
    await pool.query(
      `UPDATE app_video_generations
          SET worker_lease_owner=NULL, worker_lease_until=NULL
        WHERE id=?`,
      [fixture.jobId]
    );
    const [one, two] = await Promise.all([
      repository().claimPollableJobs({ workerId: 'worker-one' }),
      repository().claimPollableJobs({ workerId: 'worker-two' })
    ]);
    const claimed = [...one, ...two];
    assert.equal(claimed.length, 1);

    let downloads = 0;
    const provider = {
      fetchResultStream: async () => {
        downloads += 1;
        return {
          stream: Readable.from([mp4]),
          mimeType: 'video/mp4'
        };
      }
    };
    await createVideoResultOrchestrator({
      storage: createLocalVideoStorage({
        root,
        maxBytes: 1024,
        tempMaxAgeMinutes: 1
      }),
      config
    }).store({
      job: claimed[0],
      provider,
      descriptor: {
        source: 'fake://local',
        filename: 'output.mp4',
        mimeType: 'video/mp4'
      },
      repository: repository(),
      workerId: claimed[0].worker_lease_owner
    });
    const current = await noa.state(fixture);

    assert.equal(downloads, 1);
    assert.equal(current.job.status, 'succeeded');
    assert.equal(current.reservation.status, 'captured');
    assert.equal(current.wallet.reservedNoa, '0.000000');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
