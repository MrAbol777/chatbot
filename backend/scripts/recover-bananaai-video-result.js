'use strict';

// Explicit, one-job recovery for a BananaAI task that completed upstream but
// failed while its result was being stored locally. This script never submits
// a new generation. It only reads the existing provider task and downloads the
// already-generated result after all local and billing checks pass.
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
const short = (value) => String(value || '').slice(0, 12);
const splitList = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean);

function requiredEnv(env) {
  if (env.RUN_BANANAAI_RESULT_RECOVERY !== '1') throw new Error('RUN_BANANAAI_RESULT_RECOVERY=1 is required.');
  const jobId = String(env.BANANAAI_RECOVERY_JOB_ID || '').trim();
  if (!JOB_ID.test(jobId)) throw new Error('BANANAAI_RECOVERY_JOB_ID is required.');
  return { jobId };
}

function recoveryDatabaseOptions(env) {
  const options = databaseOptions(env.DATABASE_URL);
  options.host = String(env.DATABASE_HOST || env.LOCAL_DATABASE_HOST || options.host).trim() || options.host;
  return options;
}

async function loadRecoveryCandidate(pool, jobId) {
  const [rows] = await pool.query('SELECT * FROM app_video_generations WHERE id=? LIMIT 1', [jobId]);
  const job = rows[0];
  if (!job) throw new Error('Recovery job was not found.');
  if (job.status === 'succeeded' && job.result_storage_key) return { idempotent: true, job };
  if (job.status !== 'failed' || job.provider !== 'bananaai' || !job.provider_job_id) {
    throw new Error('Only one failed BananaAI job with an existing provider task can be recovered.');
  }
  if (job.recovery_started_at) throw new Error('This job has already used its one-shot recovery attempt.');
  return { idempotent: false, job };
}

async function prepareRecovery(pool, { jobId, providerJobId, workerId }, billingService) {
  const billing = billingService || createNoaBillingService({ repository: createNoaRepository(pool) });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [jobs] = await connection.query('SELECT * FROM app_video_generations WHERE id=? FOR UPDATE', [jobId]);
    const job = jobs[0];
    if (!job) throw new Error('Recovery job was not found.');
    if (job.status === 'succeeded' && job.result_storage_key) { await connection.commit(); return { idempotent: true, job }; }
    if (job.status !== 'failed' || job.provider !== 'bananaai' || job.provider_job_id !== providerJobId) {
      throw new Error('BananaAI recovery job state changed before reservation.');
    }
    if (job.recovery_started_at) throw new Error('This job has already used its one-shot recovery attempt.');
    const [reservations] = await connection.query('SELECT * FROM app_noa_reservations WHERE reservation_id=? FOR UPDATE', [job.noa_reservation_id]);
    const originalReservation = reservations[0];
    if (!originalReservation || originalReservation.status !== 'released') {
      throw new Error('Recovery requires the released Noa reservation belonging to this job.');
    }
    const recoveryReservation = await billing.reserve({
      userId: job.user_id,
      actionKey: 'video_generation',
      quantity: String(job.duration),
      idempotencyKey: `bananaai-result-recovery:${job.id}`,
      payloadHash: { generationId: job.id, providerJobId: job.provider_job_id, recovery: true },
      referenceType: 'video_recovery',
      referenceId: job.id,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      actorType: 'system',
      actorId: 'bananaai-recovery',
      metadata: { generationId: job.id, originalReservationId: originalReservation.reservation_id }
    }, { connection });
    const [jobUpdate] = await connection.query(
      "UPDATE app_video_generations SET status='storing',noa_reservation_id=?,safe_error_code=NULL,safe_error_message=NULL,storage_safe_error_code=NULL,storage_safe_error_message=NULL,result_storage_status='pending',next_storage_attempt_at=NOW(),expires_at=GREATEST(expires_at,DATE_ADD(NOW(),INTERVAL 30 MINUTE)),recovery_started_at=NOW(),worker_lease_owner=?,worker_lease_until=DATE_ADD(NOW(),INTERVAL 10 MINUTE),updated_at=NOW() WHERE id=? AND status='failed' AND recovery_started_at IS NULL",
      [recoveryReservation.reservationId, workerId, job.id]
    );
    if (jobUpdate.affectedRows !== 1) throw new Error('Recovery job state changed while reserving Noa.');
    const [updated] = await connection.query('SELECT * FROM app_video_generations WHERE id=?', [job.id]);
    await connection.commit();
    return { idempotent: false, job: updated[0] };
  } catch (error) {
    try { await connection.rollback(); } catch (_) {}
    throw error;
  } finally { connection.release(); }
}

function createProvider(env, storageConfig) {
  return createBananaAiVideoProvider({
    httpClient: axios,
    baseUrl: env.BANANAAI_BASE_URL || 'https://bananaai.ir',
    apiKey: env.BANANAAI_API_KEY,
    proxyUrl: env.BANANAAI_PROXY_URL,
    forceIpv4: String(env.BANANAAI_FORCE_IPV4 ?? 'true').toLowerCase() !== 'false',
    requestTimeoutMs: Number(env.BANANAAI_REQUEST_TIMEOUT_MS || 120000),
    statusTimeoutMs: Number(env.BANANAAI_STATUS_TIMEOUT_MS || 30000),
    resultAllowedHosts: splitList(env.BANANAAI_VIDEO_RESULT_ALLOWED_HOSTS),
    resultAllowedPorts: storageConfig.allowedPorts,
    resultAllowedPathPrefixes: splitList(env.BANANAAI_VIDEO_RESULT_ALLOWED_PATH_PREFIXES),
    resultConnectTimeoutMs: storageConfig.connectTimeoutMs,
    resultHeadersTimeoutMs: storageConfig.headersTimeoutMs,
    resultIdleTimeoutMs: storageConfig.idleTimeoutMs,
    resultTotalTimeoutMs: storageConfig.totalTimeoutMs,
    resultMaxBytes: storageConfig.maxBytes,
    resultMaxRedirects: storageConfig.maxRedirects
  });
}

async function main({ env = process.env } = {}) {
  const input = requiredEnv(env);
  const storageConfig = loadVideoStorageConfig(env);
  const pool = mysql.createPool({ ...recoveryDatabaseOptions(env), connectionLimit: 1 });
  const workerId = `recovery-${crypto.randomUUID().slice(0, 8)}`;
  try {
    const candidate = await loadRecoveryCandidate(pool, input.jobId);
    if (candidate.idempotent) return console.log(JSON.stringify({ action: 'already-recovered', jobId: short(input.jobId) }));
    const provider = createProvider(env, storageConfig);
    const providerStatus = await provider.getJobStatus(candidate.job.provider_job_id);
    if (provider.normalizeStatus(providerStatus) !== 'storing') throw new Error('BananaAI task is not completed and cannot be recovered.');
    const descriptor = provider.normalizeResult(providerStatus);
    if (!descriptor?.source) throw new Error('BananaAI completed task has no recoverable result.');
    const noaBillingService = createNoaBillingService({ repository: createNoaRepository(pool) });
    const prepared = await prepareRecovery(pool, { jobId: input.jobId, providerJobId: candidate.job.provider_job_id, workerId }, noaBillingService);
    if (prepared.idempotent) return console.log(JSON.stringify({ action: 'already-recovered', jobId: short(input.jobId) }));
    const repository = createVideoWorkerRepository(pool, { noaBillingService });
    const storage = createLocalVideoStorage(storageConfig);
    const orchestrator = createVideoResultOrchestrator({ storage, config: storageConfig });
    const outcome = await orchestrator.store({ job: prepared.job, provider, descriptor, repository, workerId });
    console.log(JSON.stringify({ action: outcome.action, jobId: short(input.jobId), errorCode: outcome.errorCode || null }));
  } finally { await pool.end(); }
}

if (require.main === module) main().catch((error) => {
  console.error(`BananaAI result recovery refused or failed: ${error.code || error.message}`);
  process.exitCode = 1;
});

module.exports = { requiredEnv, recoveryDatabaseOptions, loadRecoveryCandidate, prepareRecovery, createProvider, main };
