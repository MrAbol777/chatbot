process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { randomUUID } = require('crypto');
const { execFileSync } = require('child_process');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });
const { createVideoWorkerRepository } = require('../worker/video-worker.repository');
const { createLocalVideoStorage } = require('../storage/local-video.storage');
const { createVideoResultOrchestrator } = require('../storage/video-result-orchestrator');

const mp4 = Buffer.from('000000186674797069736f6d0000020069736f6d69736f6d', 'hex');
const config = { maxBytes: 1024, timeoutMs: 1000, maxRedirects: 1, maxAttempts: 2, retryBaseDelayMs: 1, retryMaxDelayMs: 1 };
let pool; const ids = new Set();
const id = (prefix) => { const value = `${prefix}-${randomUUID()}`; ids.add(value); return value; };
async function q(sql, params) { return pool.query(sql, params); }
async function fixture() {
  const userId = id('storage-crash-user'), planId = id('storage-crash-plan'), modelKey = id('storage-crash-model').slice(0, 64), jobId = id('storage-crash-job'), reservationId = id('storage-crash-reservation'), periodKey = '2099-12';
  await q('INSERT INTO app_users (user_id,name,age,registered_at) VALUES (?,?,20,NOW())', [userId, 'Storage crash']);
  await q('INSERT INTO app_plans (id,name,features,is_active,created_at,updated_at) VALUES (?,?,JSON_ARRAY(),0,NOW(),NOW())', [planId, 'Storage crash']);
  await q("INSERT INTO app_video_models (internal_key,provider,provider_model_id,display_name_fa,is_active,supports_text_to_video,supports_image_to_video,allowed_aspect_ratios,allowed_durations,allowed_qualities,max_prompt_length,quota_units,created_at,updated_at) VALUES (?,?,?,'مدل',0,1,0,JSON_ARRAY('16:9'),JSON_ARRAY('4'),JSON_ARRAY('standard'),100,1,NOW(),NOW())", [modelKey, 'fake', 'fake']);
  await q('INSERT INTO app_video_usage (user_id,period_key,video_used,video_reserved,updated_at) VALUES (?,?,0,1,NOW())', [userId, periodKey]);
  await q("INSERT INTO app_video_generations (id,user_id,mode,model_key,provider,provider_model_id_snapshot,status,prompt,aspect_ratio,duration,quality,provider_job_id,quota_units,quota_reservation_id,idempotency_hash,payload_hash,expires_at,next_poll_at,next_storage_attempt_at,worker_lease_owner,worker_lease_until,created_at,updated_at) VALUES (?,?,'text-to-video',?,'fake','fake','storing','fixture','16:9','4','standard','provider',1,?,SHA2(UUID(),256),SHA2(UUID(),256),DATE_ADD(NOW(),INTERVAL 1 HOUR),NOW(),NOW(),'worker-a',DATE_ADD(NOW(),INTERVAL 1 MINUTE),NOW(),NOW())", [jobId, userId, modelKey, reservationId]);
  await q("INSERT INTO app_video_quota_reservations (id,user_id,period_key,generation_id,quota_units,status,created_at,updated_at) VALUES (?,?,?,?,1,'reserved',NOW(),NOW())", [reservationId, userId, periodKey, jobId]);
  return { userId, planId, modelKey, jobId, reservationId, periodKey };
}
async function cleanup() { for (const value of ids) { await q('DELETE FROM app_video_quota_reservations WHERE id=?', [value]); await q('DELETE FROM app_video_generations WHERE id=?', [value]); await q('DELETE FROM app_video_models WHERE internal_key=?', [value]); await q('DELETE FROM app_video_usage WHERE user_id=?', [value]); await q('DELETE FROM app_plans WHERE id=?', [value]); await q('DELETE FROM app_users WHERE user_id=?', [value]); } ids.clear(); }
async function state(f) { const [[job]] = await q('SELECT * FROM app_video_generations WHERE id=?', [f.jobId]); const [[reservation]] = await q('SELECT * FROM app_video_quota_reservations WHERE id=?', [f.reservationId]); const [[usage]] = await q('SELECT * FROM app_video_usage WHERE user_id=? AND period_key=?', [f.userId, f.periodKey]); return { job, reservation, usage }; }
test.before(async () => { execFileSync(process.execPath, ['scripts/apply-video-generation-migration.js'], { cwd: path.join(__dirname, '../../../..'), stdio: 'inherit' }); const url = new URL(process.env.DATABASE_URL); pool = mysql.createPool({ host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.slice(1), connectionLimit: 4 }); });
test.afterEach(cleanup); test.after(async () => { try { await cleanup(); } finally { await pool.end(); } });

test('MariaDB restart recovery reuses a valid post-rename final file and finalizes quota once', async () => {
  const f = await fixture(); const root = await fs.mkdtemp(path.join(os.tmpdir(), 'video-storage-db-'));
  try {
    const crash = Object.assign(new Error('process crash'), { simulateCrash: true }); let downloads = 0;
    const provider = { fetchResultStream: async () => { downloads += 1; return { stream: Readable.from([mp4]), mimeType: 'video/mp4' }; } };
    const descriptor = { source: 'fake://local', filename: 'output.mp4', mimeType: 'video/mp4' };
    const crashing = createVideoResultOrchestrator({ storage: createLocalVideoStorage({ root, maxBytes: 1024, tempMaxAgeMinutes: 1, faultInjector: (point) => { if (point === 'after_atomic_rename') throw crash; } }), config });
    const initial = await state(f);
    await assert.rejects(() => crashing.store({ job: initial.job, provider, descriptor, repository: createVideoWorkerRepository(pool), workerId: 'worker-a' }), (error) => error === crash);
    await q("UPDATE app_video_generations SET worker_lease_until=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE id=?", [f.jobId]);
    const repository = createVideoWorkerRepository(pool); const [claimed] = await repository.claimPollableJobs({ workerId: 'worker-b' });
    assert.equal(claimed.id, f.jobId);
    const recovered = await createVideoResultOrchestrator({ storage: createLocalVideoStorage({ root, maxBytes: 1024, tempMaxAgeMinutes: 1 }), config }).store({ job: claimed, provider, descriptor, repository, workerId: 'worker-b' });
    const current = await state(f);
    assert.equal(recovered.reusedExistingFile, true); assert.equal(downloads, 1); assert.equal(current.job.status, 'succeeded'); assert.equal(current.reservation.status, 'finalized'); assert.equal(Number(current.usage.video_reserved), 0); assert.equal(Number(current.usage.video_used), 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('two MariaDB workers claim one storing job and perform one effective download', async () => {
  const f = await fixture(); const root = await fs.mkdtemp(path.join(os.tmpdir(), 'video-storage-db-'));
  try {
    await q('UPDATE app_video_generations SET worker_lease_owner=NULL, worker_lease_until=NULL WHERE id=?', [f.jobId]);
    const [one, two] = await Promise.all([createVideoWorkerRepository(pool).claimPollableJobs({ workerId: 'worker-one' }), createVideoWorkerRepository(pool).claimPollableJobs({ workerId: 'worker-two' })]);
    const claimed = [...one, ...two]; assert.equal(claimed.length, 1);
    let downloads = 0;
    const provider = { fetchResultStream: async () => { downloads += 1; return { stream: Readable.from([mp4]), mimeType: 'video/mp4' }; } };
    await createVideoResultOrchestrator({ storage: createLocalVideoStorage({ root, maxBytes: 1024, tempMaxAgeMinutes: 1 }), config }).store({ job: claimed[0], provider, descriptor: { source: 'fake://local', filename: 'output.mp4', mimeType: 'video/mp4' }, repository: createVideoWorkerRepository(pool), workerId: claimed[0].worker_lease_owner });
    const current = await state(f);
    assert.equal(downloads, 1); assert.equal(current.job.status, 'succeeded'); assert.equal(Number(current.usage.video_used), 1); assert.equal(Number(current.usage.video_reserved), 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
