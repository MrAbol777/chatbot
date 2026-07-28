'use strict';

// Deliberately opt-in, single-job recovery. It never submits work or polls
// Metis. The only potential external action is one result download after all
// local/database checks pass.
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const axios = require('axios');
const { databaseOptions } = require('./admin-enable-video-model');
const { createMetisVideoProvider } = require('../src/modules/video-generation/providers/metis-video.provider');
const { loadVideoStorageConfig } = require('../src/modules/video-generation/storage/video-storage.config');
const { createLocalVideoStorage } = require('../src/modules/video-generation/storage/local-video.storage');
const { createVideoResultOrchestrator } = require('../src/modules/video-generation/storage/video-result-orchestrator');
const { createVideoWorkerRepository } = require('../src/modules/video-generation/worker/video-worker.repository');
const { createNoaRepository } = require('../src/modules/noa/noa.repository');
const { createNoaBillingService } = require('../src/modules/noa/noa-billing.service');
dotenv.config({ path: path.join(__dirname, '../.env') });

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const short = (value) => String(value || '').slice(0, 12);

function requiredEnv(env) {
  if (env.RUN_METIS_RESULT_RECOVERY !== '1') throw new Error('RUN_METIS_RESULT_RECOVERY=1 is required.');
  const jobId = String(env.METIS_RECOVERY_JOB_ID || '').trim();
  const source = String(env.METIS_RECOVERY_RESULT_URL || '').trim();
  if (!JOB_ID.test(jobId) || !source) throw new Error('METIS_RECOVERY_JOB_ID and METIS_RECOVERY_RESULT_URL are required.');
  return { jobId, source, generationId: String(env.METIS_RECOVERY_GENERATION_ID || '').trim() || null };
}

async function prepareRecovery(pool, { jobId, generationId, workerId }, billingService) {
  const billing = billingService || createNoaBillingService({
    repository: createNoaRepository(pool)
  });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [jobs] = await connection.query('SELECT * FROM app_video_generations WHERE id=? FOR UPDATE', [jobId]);
    const job = jobs[0];
    if (!job) throw new Error('Recovery job was not found.');
    if (job.status === 'succeeded' && job.result_storage_key) { await connection.commit(); return { idempotent: true, job }; }
    if (job.status !== 'failed' || job.provider !== 'metis' || !job.provider_job_id) throw new Error('Only one failed Metis job with a provider result can be recovered.');
    if (job.recovery_started_at) throw new Error('This job has already used its one-shot recovery attempt.');
    if (generationId && generationId !== job.provider_job_id) throw new Error('Recovery generation id does not match the selected job.');
    const [reservations] = await connection.query(
      'SELECT * FROM app_noa_reservations WHERE reservation_id=? FOR UPDATE',
      [job.noa_reservation_id]
    );
    const originalReservation = reservations[0];
    if (!originalReservation || originalReservation.status !== 'released') {
      throw new Error('Recovery requires the released Noa reservation belonging to this job.');
    }
    const recoveryReservation = await billing.reserve({
      userId: job.user_id,
      actionKey: 'video_generation',
      quantity: String(job.duration),
      idempotencyKey: `metis-result-recovery:${job.id}`,
      payloadHash: {
        generationId: job.id,
        providerJobId: job.provider_job_id,
        recovery: true
      },
      referenceType: 'video_recovery',
      referenceId: job.id,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      actorType: 'system',
      actorId: 'metis-recovery',
      metadata: {
        generationId: job.id,
        originalReservationId: originalReservation.reservation_id
      }
    }, { connection });
    const [jobUpdate] = await connection.query(
      "UPDATE app_video_generations SET status='storing', noa_reservation_id=?, safe_error_code=NULL, safe_error_message=NULL, storage_safe_error_code=NULL, storage_safe_error_message=NULL, next_storage_attempt_at=NOW(), recovery_started_at=NOW(), worker_lease_owner=?, worker_lease_until=DATE_ADD(NOW(), INTERVAL 10 MINUTE), updated_at=NOW() WHERE id=? AND status='failed' AND recovery_started_at IS NULL",
      [recoveryReservation.reservationId, workerId, job.id]
    );
    if (jobUpdate.affectedRows !== 1) throw new Error('Recovery job state changed while reserving Noa.');
    const [updated] = await connection.query('SELECT * FROM app_video_generations WHERE id=?', [job.id]);
    await connection.commit();
    return { idempotent: false, job: updated[0] };
  } catch (error) { try { await connection.rollback(); } catch (_) {} throw error; } finally { connection.release(); }
}

async function main({ env = process.env } = {}) {
  const input = requiredEnv(env);
  const storageConfig = loadVideoStorageConfig(env);
  const pool = mysql.createPool({ ...databaseOptions(env.DATABASE_URL), connectionLimit: 1 });
  const workerId = `recovery-${crypto.randomUUID().slice(0, 8)}`;
  try {
    const noaBillingService = createNoaBillingService({
      repository: createNoaRepository(pool)
    });
    const prepared = await prepareRecovery(pool, { ...input, workerId }, noaBillingService);
    if (prepared.idempotent) return console.log(JSON.stringify({ action: 'already-recovered', jobId: short(input.jobId) }));
    const provider = createMetisVideoProvider({ httpClient: axios, baseUrl: env.METIS_BASE_URL, apiKey: env.METIS_API_KEY, requestTimeoutMs: Number(env.METIS_REQUEST_TIMEOUT_MS || 120000), statusTimeoutMs: Number(env.METIS_STATUS_TIMEOUT_MS || 30000), resultAllowedHosts: storageConfig.allowedHosts, resultAllowedPorts: storageConfig.allowedPorts, resultAllowedPathPrefixes: storageConfig.allowedPathPrefixes, resultTimeoutMs: storageConfig.timeoutMs, resultMaxBytes: storageConfig.maxBytes, resultMaxRedirects: 0 });
    const repository = createVideoWorkerRepository(pool, { noaBillingService });
    const storage = createLocalVideoStorage(storageConfig);
    const orchestrator = createVideoResultOrchestrator({ storage, config: storageConfig });
    const outcome = await orchestrator.store({ job: prepared.job, provider, descriptor: { source: input.source, filename: 'recovered-result.mp4' }, repository, workerId });
    console.log(JSON.stringify({ action: outcome.action, jobId: short(input.jobId), errorCode: outcome.errorCode || null }));
  } finally { await pool.end(); }
}

if (require.main === module) main().catch((error) => { console.error(`Metis result recovery refused or failed: ${error.code || error.message}`); process.exitCode = 1; });
module.exports = { requiredEnv, prepareRecovery, main };
