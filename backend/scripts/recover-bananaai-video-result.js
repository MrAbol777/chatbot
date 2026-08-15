'use strict';

// Deliberately opt-in, single-job recovery. It never submits provider work.
// It reads an existing completed BananaAI task and stores its already-created
// result after restoring the one Noa reservation released on storage failure.
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const axios = require('axios');
const { databaseOptions } = require('./admin-enable-video-model');
const { createBananaAiVideoProvider } = require('../src/modules/video-generation/providers/bananaai-video.provider');
const { loadVideoStorageConfig } = require('../src/modules/video-generation/storage/video-storage.config');
const { createLocalVideoStorage } = require('../src/modules/video-generation/storage/local-video.storage');
const { createVideoResultOrchestrator } = require('../src/modules/video-generation/storage/video-result-orchestrator');
const { createVideoWorkerRepository } = require('../src/modules/video-generation/worker/video-worker.repository');
const { createNoaRepository } = require('../src/modules/noa/noa.repository');
const { createNoaBillingService } = require('../src/modules/noa/noa-billing.service');

dotenv.config({ path: path.join(__dirname, '../.env') });

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const splitList = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
const short = (value) => String(value || '').slice(0, 12);

function requiredEnv(env) {
  if (env.RUN_BANANAAI_RESULT_RECOVERY !== '1') throw new Error('RUN_BANANAAI_RESULT_RECOVERY=1 is required.');
  const jobId = String(env.BANANAAI_RECOVERY_JOB_ID || '').trim();
  const taskId = String(env.BANANAAI_RECOVERY_TASK_ID || '').trim();
  if (!JOB_ID.test(jobId) || !taskId) throw new Error('BANANAAI_RECOVERY_JOB_ID and BANANAAI_RECOVERY_TASK_ID are required.');
  return { jobId, taskId };
}

async function prepareRecovery(pool, { jobId, taskId, workerId }, billingService) {
  const billing = billingService || createNoaBillingService({ repository: createNoaRepository(pool) });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [jobs] = await connection.query('SELECT * FROM app_video_generations WHERE id=? FOR UPDATE', [jobId]);
    const job = jobs[0];
    if (!job) throw new Error('Recovery job was not found.');
    if (job.status === 'succeeded' && job.result_storage_key) { await connection.commit(); return { idempotent: true, job }; }
    if (!['failed', 'expired'].includes(job.status) || job.provider !== 'bananaai' || job.provider_job_id !== taskId) throw new Error('Only the selected failed or expired BananaAI job can be recovered.');
    const [reservations] = await connection.query('SELECT * FROM app_noa_reservations WHERE reservation_id=? FOR UPDATE', [job.noa_reservation_id]);
    const originalReservation = reservations[0];
    if (!originalReservation || originalReservation.status !== 'released') throw new Error('Recovery requires the released Noa reservation belonging to this job.');
    const resumeInterruptedRecovery = job.status === 'expired'
      && Boolean(job.recovery_started_at)
      && job.storage_safe_error_code === 'VIDEO_RESULT_STREAM_INTERRUPTED';
    if (job.recovery_started_at && !resumeInterruptedRecovery) throw new Error('This job has already used its recovery attempt.');
    const recoveryReferenceType = resumeInterruptedRecovery ? 'video_recovery_resume' : 'video_recovery';
    const recoveryReservation = await billing.reserve({
      userId: job.user_id,
      actionKey: 'video_generation',
      quantity: String(job.duration),
      idempotencyKey: `bananaai-result-recovery:${job.id}:${resumeInterruptedRecovery ? 'wget' : 'initial'}`,
      payloadHash: { generationId: job.id, providerJobId: job.provider_job_id, recovery: true },
      referenceType: recoveryReferenceType,
      referenceId: job.id,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      actorType: 'system',
      actorId: 'bananaai-recovery',
      metadata: { generationId: job.id, originalReservationId: originalReservation.reservation_id, resumedAfterInterruptedDownload: resumeInterruptedRecovery }
    }, { connection });
    const [updated] = await connection.query(
      "UPDATE app_video_generations SET status='storing', noa_reservation_id=?, safe_error_code=NULL, safe_error_message=NULL, storage_safe_error_code=NULL, storage_safe_error_message=NULL, next_storage_attempt_at=NOW(), recovery_started_at=NOW(), worker_lease_owner=?, worker_lease_until=DATE_ADD(NOW(), INTERVAL 10 MINUTE), updated_at=NOW() WHERE id=? AND status IN ('failed','expired') AND (recovery_started_at IS NULL OR (status='expired' AND recovery_started_at IS NOT NULL AND storage_safe_error_code='VIDEO_RESULT_STREAM_INTERRUPTED'))",
      [recoveryReservation.reservationId, workerId, job.id]
    );
    if (updated.affectedRows !== 1) throw new Error('Recovery job state changed while reserving Noa.');
    const [refreshed] = await connection.query('SELECT * FROM app_video_generations WHERE id=?', [job.id]);
    await connection.commit();
    return { idempotent: false, job: refreshed[0] };
  } catch (error) {
    try { await connection.rollback(); } catch (_) {}
    throw error;
  } finally {
    connection.release();
  }
}

async function main({ env = process.env } = {}) {
  const input = requiredEnv(env);
  const storageConfig = loadVideoStorageConfig(env);
  const pool = mysql.createPool({ ...databaseOptions(env.DATABASE_URL), connectionLimit: 1 });
  const workerId = `recovery-${crypto.randomUUID().slice(0, 8)}`;
  try {
    const prepared = await prepareRecovery(pool, { ...input, workerId });
    if (prepared.idempotent) return console.log(JSON.stringify({ action: 'already-recovered', jobId: short(input.jobId) }));
    const provider = createBananaAiVideoProvider({
      httpClient: axios,
      baseUrl: env.BANANAAI_BASE_URL || 'https://bananaai.ir',
      apiKey: env.BANANAAI_API_KEY,
      forceIpv4: String(env.BANANAAI_FORCE_IPV4 ?? 'true').toLowerCase() !== 'false',
      requestTimeoutMs: Number(env.BANANAAI_REQUEST_TIMEOUT_MS || 120000),
      statusTimeoutMs: Number(env.BANANAAI_STATUS_TIMEOUT_MS || 30000),
      resultAllowedHosts: splitList(env.BANANAAI_VIDEO_RESULT_ALLOWED_HOSTS),
      resultAllowedPorts: storageConfig.allowedPorts,
      resultAllowedPathPrefixes: splitList(env.BANANAAI_VIDEO_RESULT_ALLOWED_PATH_PREFIXES),
      resultTimeoutMs: storageConfig.timeoutMs,
      resultMaxBytes: storageConfig.maxBytes,
      resultMaxRedirects: storageConfig.maxRedirects
    });
    const task = await provider.getJobStatus(input.taskId);
    if (provider.normalizeStatus(task) !== 'storing') throw new Error('BananaAI task is not completed.');
    const descriptor = provider.normalizeResult(task);
    if (!descriptor) throw new Error('BananaAI task does not contain a result URL.');
    const repository = createVideoWorkerRepository(pool, { noaBillingService: createNoaBillingService({ repository: createNoaRepository(pool) }) });
    const storage = createLocalVideoStorage(storageConfig);
    const orchestrator = createVideoResultOrchestrator({ storage, config: storageConfig });
    const outcome = await orchestrator.store({ job: prepared.job, provider, descriptor, repository, workerId });
    console.log(JSON.stringify({ action: outcome.action, jobId: short(input.jobId), errorCode: outcome.errorCode || null }));
  } finally {
    await pool.end();
  }
}

if (require.main === module) main().catch((error) => { console.error(`BananaAI result recovery refused or failed: ${error.code || error.message}`); process.exitCode = 1; });

module.exports = { requiredEnv, prepareRecovery, main };
