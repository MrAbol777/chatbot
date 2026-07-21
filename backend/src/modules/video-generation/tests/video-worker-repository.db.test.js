process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

const { createVideoWorkerRepository } = require('../worker/video-worker.repository');

let pool;
const fixtureIds = new Set();

function fixtureId(prefix) {
  const id = `${prefix}-${randomUUID()}`;
  fixtureIds.add(id);
  return id;
}

async function query(sql, params) { return pool.query(sql, params); }

async function createFixture({ units = 1, status = 'submitted', nextPollAt = 'NOW()', leaseUntil = null } = {}) {
  const userId = fixtureId('video-worker-user');
  const planId = fixtureId('video-worker-plan');
  const modelKey = fixtureId('video-worker-model').slice(0, 64);
  const jobId = fixtureId('video-worker-job');
  const reservationId = fixtureId('video-worker-reservation');
  const periodKey = '2099-12';
  await query('INSERT INTO app_users (user_id,name,age,registered_at) VALUES (?,?,?,NOW())', [userId, 'Video Worker Test', 20]);
  await query('INSERT INTO app_plans (id,name,features,is_active,created_at,updated_at) VALUES (?,?,JSON_ARRAY(),0,NOW(),NOW())', [planId, 'Video Worker Test Plan']);
  await query("INSERT INTO app_video_models (internal_key,provider,provider_model_id,display_name_fa,is_active,supports_text_to_video,supports_image_to_video,allowed_aspect_ratios,allowed_durations,allowed_qualities,max_prompt_length,quota_units,created_at,updated_at) VALUES (?,?,?,'مدل تست',0,1,0,JSON_ARRAY('16:9'),JSON_ARRAY('4'),JSON_ARRAY('standard'),100,?,NOW(),NOW())", [modelKey, 'test', 'test-model', units]);
  await query('INSERT INTO app_video_usage (user_id,period_key,video_used,video_reserved,updated_at) VALUES (?,?,0,?,NOW())', [userId, periodKey, units]);
  await query(`INSERT INTO app_video_generations (id,user_id,mode,model_key,provider,provider_model_id_snapshot,status,prompt,aspect_ratio,duration,quality,quota_units,quota_reservation_id,idempotency_hash,payload_hash,expires_at,next_poll_at,worker_lease_until,created_at,updated_at) VALUES (?,?, 'text-to-video', ?, 'test', 'test-model', ?, 'fixture', '16:9', '4', 'standard', ?, ?, SHA2(UUID(),256), SHA2(UUID(),256), DATE_ADD(NOW(), INTERVAL 1 HOUR), ${nextPollAt}, ?, NOW(), NOW())`, [jobId, userId, modelKey, status, units, reservationId, leaseUntil]);
  await query('INSERT INTO app_video_quota_reservations (id,user_id,period_key,generation_id,quota_units,status,created_at,updated_at) VALUES (?,?,?,?,?,\'reserved\',NOW(),NOW())', [reservationId, userId, periodKey, jobId, units]);
  return { userId, planId, modelKey, jobId, reservationId, periodKey, units };
}

async function createAdditionalJob(fixture, { units = 1 } = {}) {
  const jobId = fixtureId('video-worker-job');
  const reservationId = fixtureId('video-worker-reservation');
  await query('UPDATE app_video_usage SET video_reserved=video_reserved+? WHERE user_id=? AND period_key=?', [units, fixture.userId, fixture.periodKey]);
  await query("INSERT INTO app_video_generations (id,user_id,mode,model_key,provider,provider_model_id_snapshot,status,prompt,aspect_ratio,duration,quality,quota_units,quota_reservation_id,idempotency_hash,payload_hash,expires_at,next_poll_at,created_at,updated_at) VALUES (?,?,'text-to-video',?,'test','test-model','submitted','fixture','16:9','4','standard',?,?,SHA2(UUID(),256),SHA2(UUID(),256),DATE_ADD(NOW(), INTERVAL 1 HOUR),NOW(),NOW(),NOW())", [jobId, fixture.userId, fixture.modelKey, units, reservationId]);
  await query('INSERT INTO app_video_quota_reservations (id,user_id,period_key,generation_id,quota_units,status,created_at,updated_at) VALUES (?,?,?,?,?,\'reserved\',NOW(),NOW())', [reservationId, fixture.userId, fixture.periodKey, jobId, units]);
  return { jobId, reservationId, units };
}

async function state(fixture) {
  const [[job]] = await query('SELECT * FROM app_video_generations WHERE id=?', [fixture.jobId]);
  const [[reservation]] = await query('SELECT * FROM app_video_quota_reservations WHERE id=?', [fixture.reservationId]);
  const [[usage]] = await query('SELECT * FROM app_video_usage WHERE user_id=? AND period_key=?', [fixture.userId, fixture.periodKey]);
  return { job, reservation, usage };
}

async function cleanup() {
  for (const id of fixtureIds) {
    await query('DELETE FROM app_video_quota_reservations WHERE id=?', [id]);
    await query('DELETE FROM app_video_generations WHERE id=?', [id]);
    await query('DELETE FROM app_video_models WHERE internal_key=?', [id]);
    await query('DELETE FROM app_video_usage WHERE user_id=?', [id]);
    await query('DELETE FROM app_plans WHERE id=?', [id]);
    await query('DELETE FROM app_users WHERE user_id=?', [id]);
  }
  fixtureIds.clear();
}

test.before(async () => {
  execFileSync(process.execPath, ['scripts/apply-video-generation-migration.js'], { cwd: path.join(__dirname, '../../../..'), stdio: 'inherit' });
  const url = new URL(process.env.DATABASE_URL);
  pool = mysql.createPool({ host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.slice(1), connectionLimit: 8 });
});

test.after(async () => { try { await cleanup(); } finally { await pool.end(); } });
test.afterEach(async () => { await cleanup(); });

test('1. claims one pollable job', async () => {
  const fixture = await createFixture();
  const claimed = await createVideoWorkerRepository(pool).claimPollableJobs({ workerId: 'worker-a' });
  assert.equal(claimed.length, 1); assert.equal(claimed[0].id, fixture.jobId); assert.equal(claimed[0].worker_lease_owner, 'worker-a');
});

test('2. an active lease blocks a second claim', async () => {
  await createFixture(); const repository = createVideoWorkerRepository(pool);
  assert.equal((await repository.claimPollableJobs({ workerId: 'worker-a' })).length, 1);
  assert.equal((await repository.claimPollableJobs({ workerId: 'worker-b' })).length, 0);
});

test('3. an expired lease is claimable again', async () => {
  const fixture = await createFixture(); const repository = createVideoWorkerRepository(pool);
  await repository.claimPollableJobs({ workerId: 'worker-a' });
  await query('UPDATE app_video_generations SET worker_lease_until=DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE id=?', [fixture.jobId]);
  const claimed = await repository.claimPollableJobs({ workerId: 'worker-b' }); assert.equal(claimed[0].worker_lease_owner, 'worker-b');
});

test('4. two connections concurrently claim only one job', async () => {
  await createFixture();
  const [one, two] = await Promise.all([
    createVideoWorkerRepository(pool).claimPollableJobs({ workerId: 'worker-a' }),
    createVideoWorkerRepository(pool).claimPollableJobs({ workerId: 'worker-b' })
  ]);
  assert.equal(one.length + two.length, 1);
});

test('5. finalizes a successful job transactionally', async () => {
  const fixture = await createFixture({ units: 2 }); await createVideoWorkerRepository(pool).finalizeSuccessfulJob({ jobId: fixture.jobId }); const result = await state(fixture);
  assert.equal(result.job.status, 'succeeded'); assert.equal(result.reservation.status, 'finalized'); assert.equal(Number(result.usage.video_reserved), 0); assert.equal(Number(result.usage.video_used), 2);
});

test('6. repeated finalize is idempotent', async () => {
  const fixture = await createFixture(); const repository = createVideoWorkerRepository(pool); await repository.finalizeSuccessfulJob({ jobId: fixture.jobId }); const result = await repository.finalizeSuccessfulJob({ jobId: fixture.jobId });
  assert.equal(result.idempotent, true); const current = await state(fixture); assert.equal(Number(current.usage.video_used), 1); assert.equal(Number(current.usage.video_reserved), 0);
});

test('7. two concurrent finalizes debit quota once', async () => {
  const fixture = await createFixture(); const outcome = await Promise.allSettled([createVideoWorkerRepository(pool).finalizeSuccessfulJob({ jobId: fixture.jobId }), createVideoWorkerRepository(pool).finalizeSuccessfulJob({ jobId: fixture.jobId })]);
  assert.equal(outcome.filter((item) => item.status === 'fulfilled').length, 2); const current = await state(fixture); assert.equal(Number(current.usage.video_used), 1); assert.equal(Number(current.usage.video_reserved), 0);
});

test('8. failure releases reserved quota without using it', async () => {
  const fixture = await createFixture({ units: 2 }); await createVideoWorkerRepository(pool).failAndReleaseJob({ jobId: fixture.jobId, errorCode: 'TEST_FAILURE', errorMessage: 'safe failure' }); const current = await state(fixture);
  assert.equal(current.job.status, 'failed'); assert.equal(current.reservation.status, 'released'); assert.equal(Number(current.usage.video_reserved), 0); assert.equal(Number(current.usage.video_used), 0);
});

test('9. repeated release is idempotent', async () => {
  const fixture = await createFixture(); const repository = createVideoWorkerRepository(pool); await repository.failAndReleaseJob({ jobId: fixture.jobId }); const result = await repository.failAndReleaseJob({ jobId: fixture.jobId }); assert.equal(result.idempotent, true);
});

test('10. two concurrent releases debit reserved quota once', async () => {
  const fixture = await createFixture(); const outcome = await Promise.allSettled([createVideoWorkerRepository(pool).failAndReleaseJob({ jobId: fixture.jobId }), createVideoWorkerRepository(pool).failAndReleaseJob({ jobId: fixture.jobId })]);
  assert.equal(outcome.filter((item) => item.status === 'fulfilled').length, 2); const current = await state(fixture); assert.equal(Number(current.usage.video_reserved), 0);
});

test('11. expiration releases quota and marks the reservation expired', async () => {
  const fixture = await createFixture(); await createVideoWorkerRepository(pool).expireAndReleaseJob({ jobId: fixture.jobId }); const current = await state(fixture); assert.equal(current.job.status, 'expired'); assert.equal(current.reservation.status, 'expired'); assert.equal(Number(current.usage.video_used), 0);
});

test('12. repeated expiration is idempotent', async () => {
  const fixture = await createFixture(); const repository = createVideoWorkerRepository(pool); await repository.expireAndReleaseJob({ jobId: fixture.jobId }); assert.equal((await repository.expireAndReleaseJob({ jobId: fixture.jobId })).idempotent, true);
});

test('13. success/failure race leaves exactly one consistent terminal result', async () => {
  const fixture = await createFixture(); const outcome = await Promise.allSettled([createVideoWorkerRepository(pool).finalizeSuccessfulJob({ jobId: fixture.jobId }), createVideoWorkerRepository(pool).failAndReleaseJob({ jobId: fixture.jobId })]); const current = await state(fixture);
  assert.equal(outcome.filter((item) => item.status === 'fulfilled').length, 1); assert.ok(['succeeded', 'failed'].includes(current.job.status)); assert.equal(Number(current.usage.video_reserved), 0); assert.equal(Number(current.usage.video_used), current.job.status === 'succeeded' ? 1 : 0);
});

test('14. a terminal job is never claimed', async () => {
  const fixture = await createFixture(); await createVideoWorkerRepository(pool).finalizeSuccessfulJob({ jobId: fixture.jobId }); const claimed = await createVideoWorkerRepository(pool).claimPollableJobs({ workerId: 'worker-a' }); assert.equal(claimed.length, 0);
});

test('a future next_poll_at is not claimable', async () => {
  await createFixture({ nextPollAt: 'DATE_ADD(NOW(), INTERVAL 1 HOUR)' });
  assert.equal((await createVideoWorkerRepository(pool).claimPollableJobs({ workerId: 'worker-a' })).length, 0);
});

test('a processing job is claimable', async () => {
  const fixture = await createFixture({ status: 'processing' });
  const claimed = await createVideoWorkerRepository(pool).claimPollableJobs({ workerId: 'worker-a' });
  assert.equal(claimed.length, 1); assert.equal(claimed[0].id, fixture.jobId);
});

test('a malformed reserved balance cannot become negative', async () => {
  const fixture = await createFixture({ units: 2 }); await query('UPDATE app_video_usage SET video_reserved=1 WHERE user_id=? AND period_key=?', [fixture.userId, fixture.periodKey]);
  await assert.rejects(() => createVideoWorkerRepository(pool).finalizeSuccessfulJob({ jobId: fixture.jobId }), { code: 'VIDEO_WORKER_RESERVED_QUOTA_INCONSISTENT' });
  const current = await state(fixture); assert.equal(Number(current.usage.video_reserved), 1); assert.equal(Number(current.usage.video_used), 0); assert.equal(current.job.status, 'submitted');
});

test('failure stores bounded safe errors and clears the lease', async () => {
  const fixture = await createFixture(); await query("UPDATE app_video_generations SET worker_lease_owner='worker-a', worker_lease_until=DATE_ADD(NOW(), INTERVAL 1 MINUTE) WHERE id=?", [fixture.jobId]);
  await createVideoWorkerRepository(pool).failAndReleaseJob({ jobId: fixture.jobId, errorCode: 'E'.repeat(200), errorMessage: 'M'.repeat(600) });
  const current = await state(fixture); assert.equal(current.job.safe_error_code.length, 100); assert.equal(current.job.safe_error_message.length, 500); assert.equal(current.job.worker_lease_owner, null); assert.equal(current.job.worker_lease_until, null);
});

test('expiration clears the lease without increasing used quota', async () => {
  const fixture = await createFixture(); await query("UPDATE app_video_generations SET worker_lease_owner='worker-a', worker_lease_until=DATE_ADD(NOW(), INTERVAL 1 MINUTE) WHERE id=?", [fixture.jobId]);
  await createVideoWorkerRepository(pool).expireAndReleaseJob({ jobId: fixture.jobId }); const current = await state(fixture); assert.equal(current.job.worker_lease_owner, null); assert.equal(current.job.worker_lease_until, null); assert.equal(Number(current.usage.video_used), 0);
});

test('15. multiple jobs for one user settle their reserved quota independently', async () => {
  const fixture = await createFixture(); const second = await createAdditionalJob(fixture); const repository = createVideoWorkerRepository(pool); await repository.finalizeSuccessfulJob({ jobId: fixture.jobId }); await repository.failAndReleaseJob({ jobId: second.jobId }); const current = await state(fixture); assert.equal(Number(current.usage.video_used), 1); assert.equal(Number(current.usage.video_reserved), 0);
});

for (const point of ['after_reserved_decrement', 'before_used_increment', 'after_used_increment', 'before_reservation_change', 'before_job_change']) {
  test(`fault injection at ${point} rolls back the complete transaction`, async () => {
    const fixture = await createFixture({ units: 2 });
    const repository = createVideoWorkerRepository(pool, { faultInjector: (current) => { if (current === point) throw new Error(`fault:${point}`); } });
    await assert.rejects(() => repository.finalizeSuccessfulJob({ jobId: fixture.jobId }), /fault:/);
    const current = await state(fixture); assert.equal(current.job.status, 'submitted'); assert.equal(current.reservation.status, 'reserved'); assert.equal(Number(current.usage.video_reserved), 2); assert.equal(Number(current.usage.video_used), 0);
  });
}

test('16. lease management methods enforce ownership and recover expired leases', async () => {
  const fixture = await createFixture(); const repository = createVideoWorkerRepository(pool); await repository.claimPollableJobs({ workerId: 'worker-a', leaseSeconds: 30 }); assert.equal(await repository.extendJobLease({ jobId: fixture.jobId, workerId: 'worker-b' }), false); assert.equal(await repository.scheduleNextPoll({ jobId: fixture.jobId, workerId: 'worker-a', nextPollAt: new Date(Date.now() + 60_000) }), true); await query('UPDATE app_video_generations SET worker_lease_owner=\'worker-a\', worker_lease_until=DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE id=?', [fixture.jobId]); assert.equal(await repository.recoverExpiredLeases(), 1); const current = await state(fixture); assert.equal(current.job.worker_lease_owner, null);
});

test('stored-result finalization is transactional and idempotent', async () => {
  const fixture = await createFixture({ units: 2, status: 'storing', nextPollAt: 'NOW()' });
  const repository = createVideoWorkerRepository(pool);
  await repository.finalizeStoredResult({ jobId: fixture.jobId, storageKey: `results/${fixture.jobId}/output.mp4`, mimeType: 'video/mp4', sizeBytes: 24, sha256: 'a'.repeat(64), originalFilename: 'output.mp4' });
  const current = await state(fixture);
  assert.equal(current.job.status, 'succeeded'); assert.equal(current.job.result_storage_status, 'stored'); assert.equal(current.reservation.status, 'finalized'); assert.equal(Number(current.usage.video_reserved), 0); assert.equal(Number(current.usage.video_used), 2);
  assert.equal((await repository.finalizeStoredResult({ jobId: fixture.jobId, storageKey: 'ignored.mp4', mimeType: 'video/mp4', sizeBytes: 24, sha256: 'b'.repeat(64), originalFilename: 'ignored.mp4' })).idempotent, true);
  assert.equal(Number((await state(fixture)).usage.video_used), 2);
});

for (const point of ['before_stored_metadata', 'after_stored_metadata', 'before_quota_finalize', 'after_quota_finalize', 'before_lease_clear']) {
  test(`stored-result fault injection at ${point} rolls back metadata and quota together`, async () => {
    const fixture = await createFixture({ units: 2, status: 'storing', nextPollAt: 'NOW()' });
    const repository = createVideoWorkerRepository(pool, { faultInjector: (current) => { if (current === point) throw new Error(`fault:${point}`); } });
    await assert.rejects(() => repository.finalizeStoredResult({ jobId: fixture.jobId, storageKey: `results/${fixture.jobId}/output.mp4`, mimeType: 'video/mp4', sizeBytes: 24, sha256: 'c'.repeat(64), originalFilename: 'output.mp4' }), /fault:/);
    const current = await state(fixture);
    assert.equal(current.job.status, 'storing'); assert.equal(current.job.result_storage_status, null); assert.equal(current.reservation.status, 'reserved'); assert.equal(Number(current.usage.video_reserved), 2); assert.equal(Number(current.usage.video_used), 0);
  });
}
