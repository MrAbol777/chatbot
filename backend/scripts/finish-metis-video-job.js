'use strict';

// One-shot recovery for the explicitly identified, already-submitted Metis
// fixture job. This file is never imported by startup, workers, migrations, or
// ordinary test commands.
const path = require('node:path');
const crypto = require('node:crypto');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const axios = require('axios');
const { createMetisVideoProvider, requestValidatedResult } = require('../src/modules/video-generation/providers/metis-video.provider');
const { createVideoResultUrlValidator } = require('../src/modules/video-generation/storage/video-result-url-validator');
const { createLocalVideoStorage } = require('../src/modules/video-generation/storage/local-video.storage');
const { createVideoResultOrchestrator } = require('../src/modules/video-generation/storage/video-result-orchestrator');
const { loadVideoStorageConfig } = require('../src/modules/video-generation/storage/video-storage.config');
const { VideoStorageError } = require('../src/modules/video-generation/storage/video-storage.errors');
const { createVideoWorkerRepository } = require('../src/modules/video-generation/worker/video-worker.repository');
const { loadVideoWorkerConfig } = require('../src/modules/video-generation/worker/video-worker.config');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const MAX_METIS_FINISH_REQUESTS = 2;
const METIS_ORIGIN = 'https://api.metisai.ir';
const FIXTURE_USER_ID = 'metis-live-user-20260720';
const MODEL_KEY = 'metis_kling_v25_turbo_pro';
const GENERATION_PREFIX = '141d';
const GENERATION_SUFFIX = '946e';
const RESULT_HOST = 'api.metisai.ir';
const RESULT_PATH_PREFIX = '/api/tpsgsbxstoragecontainer/router/tpsgsbxstoragecontainer/router/';
const FINISHABLE_STATUSES = new Set(['submitted', 'queued', 'processing', 'storing']);

function mask(value) {
  const text = String(value || '');
  return text.length < 9 ? '***' : `${text.slice(0, 4)}…${text.slice(-4)}`;
}

function databaseFingerprint(value = process.env.DATABASE_URL) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 12);
}

function safeError(error) {
  return { code: String(error?.code || 'METIS_FINISH_FAILED').slice(0, 100), message: 'The Metis finish job stopped safely; provider data was not printed.' };
}

function isLocalHost(host) {
  return ['localhost', '127.0.0.1', '::1'].includes(String(host || '').toLowerCase());
}

function preconditions() {
  const missing = [];
  if (process.env.RUN_METIS_FINISH_JOB !== '1') missing.push('RUN_METIS_FINISH_JOB=1');
  if (!String(process.env.METIS_API_KEY || '').trim()) missing.push('METIS_API_KEY');
  if (String(process.env.METIS_BASE_URL || '').replace(/\/+$/, '') !== METIS_ORIGIN) missing.push(`METIS_BASE_URL=${METIS_ORIGIN}`);
  if (!String(process.env.DATABASE_URL || '').trim()) missing.push('DATABASE_URL');
  if (missing.length) return { missing };
  let dbUrl;
  try { dbUrl = new URL(process.env.DATABASE_URL); } catch (_) { return { missing: ['DATABASE_URL(valid)'] }; }
  if (dbUrl.protocol !== 'mysql:' || !isLocalHost(dbUrl.hostname)) return { missing: ['DATABASE_URL(local MySQL)'] };
  const worker = loadVideoWorkerConfig({});
  if (worker.enabled || worker.processMode !== 'disabled') return { missing: ['Video worker disabled'] };
  return { dbUrl, worker };
}

function validateMetisResultUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch (_) { throw new VideoStorageError('VIDEO_RESULT_URL_INVALID'); }
  if (url.protocol !== 'https:' || url.hostname !== RESULT_HOST || url.username || url.password
    || (url.port && url.port !== '443') || url.hash || !url.pathname.startsWith(RESULT_PATH_PREFIX)
    || !url.pathname.toLowerCase().endsWith('.mp4')) {
    throw new VideoStorageError('VIDEO_RESULT_URL_INVALID');
  }
  return url;
}

function findFirstValidMp4Result(status) {
  const candidates = [
    ...(Array.isArray(status?.generations) ? status.generations : []),
    ...(Array.isArray(status?.results) ? status.results : []),
    ...(status?.result && !Array.isArray(status.result) ? [status.result] : [])
  ];
  for (const item of candidates) {
    const source = item?.url || item?.source;
    try {
      const url = validateMetisResultUrl(source);
      return { source: url.toString(), filename: 'metis-result.mp4', mimeType: 'video/mp4', signedQueryPresent: Boolean(url.search) };
    } catch (_) {
      // A completed response can contain non-video artifacts. Only the first
      // structurally valid MP4 storage URL is eligible for the one download.
    }
  }
  return null;
}

function classifyMatchingJobs(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) return 'not-found';
  if (jobs.length > 1) return 'ambiguous';
  return FINISHABLE_STATUSES.has(String(jobs[0].status || '').toLowerCase()) ? 'finishable' : 'terminal';
}

function createCountingStatusClient(report) {
  const client = axios.create({ timeout: 30_000, maxRedirects: 0, validateStatus: () => true });
  return {
    get: async (url, config = {}) => {
      if (report.realRequestCount >= MAX_METIS_FINISH_REQUESTS) {
        const error = new Error('Metis finish request limit reached.');
        error.code = 'METIS_FINISH_REQUEST_LIMIT';
        throw error;
      }
      const target = new URL(url);
      if (target.origin !== METIS_ORIGIN || !/^\/api\/v2\/generate\/[^/]+$/.test(target.pathname)) {
        const error = new Error('Unapproved Metis endpoint.');
        error.code = 'METIS_FINISH_ENDPOINT_BLOCKED';
        throw error;
      }
      report.realRequestCount += 1;
      report.statusGetCount += 1;
      const response = await client.get(url, { ...config, maxRedirects: 0 });
      report.statusHttpStatus = response.status;
      if (response.status < 200 || response.status >= 300) {
        const error = new Error('Metis status request did not succeed.');
        error.code = 'METIS_STATUS_HTTP_ERROR';
        throw error;
      }
      return response;
    }
  };
}

function createOneShotDownloadProvider({ report, storageConfig, resolver }) {
  const validator = createVideoResultUrlValidator({ allowedHosts: [RESULT_HOST], allowedPorts: [443], resolver });
  return {
    fetchResultStream: async (descriptor) => {
      const url = validateMetisResultUrl(descriptor?.source);
      const plan = await validator.validate(url.toString());
      if (report.realRequestCount >= MAX_METIS_FINISH_REQUESTS) {
        const error = new Error('Metis finish request limit reached.');
        error.code = 'METIS_FINISH_REQUEST_LIMIT';
        throw error;
      }
      report.realRequestCount += 1;
      report.downloadGetCount += 1;
      let response;
      try {
        response = await requestValidatedResult(plan, { timeoutMs: storageConfig.timeoutMs, maxBytes: storageConfig.maxBytes });
      } catch (error) {
        throw error;
      }
      report.downloadHttpStatus = Number(response.statusCode) || null;
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        throw new VideoStorageError('VIDEO_RESULT_REDIRECT_BLOCKED');
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        throw new VideoStorageError(response.statusCode >= 500 || response.statusCode === 429 ? 'VIDEO_RESULT_PROVIDER_TEMPORARY' : 'VIDEO_RESULT_PROVIDER_NOT_FOUND', undefined, { retryable: response.statusCode >= 500 || response.statusCode === 429 });
      }
      const mimeType = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (mimeType !== 'video/mp4') {
        response.resume();
        throw new VideoStorageError('VIDEO_RESULT_INVALID_MIME');
      }
      const contentLength = response.headers['content-length'];
      if (contentLength !== undefined && (!/^\d+$/.test(String(contentLength)) || Number(contentLength) > storageConfig.maxBytes)) {
        response.resume();
        throw new VideoStorageError('VIDEO_RESULT_TOO_LARGE');
      }
      report.contentType = mimeType;
      return { stream: response, mimeType };
    }
  };
}

async function findMatchingJobs(db) {
  const [rows] = await db.query(
    `SELECT g.*, r.status AS reservation_status, r.period_key AS reservation_period_key,
            u.video_used, u.video_reserved
       FROM app_video_generations g
       LEFT JOIN app_video_quota_reservations r ON r.id=g.quota_reservation_id
       LEFT JOIN app_video_usage u ON u.user_id=g.user_id AND u.period_key=r.period_key
      WHERE g.user_id=? AND g.provider='metis' AND g.model_key=? AND g.provider_model_id_snapshot='kling-v2.5-turbo-pro' AND g.provider_job_id IS NOT NULL
        AND g.provider_job_id LIKE ? AND g.provider_job_id LIKE ?
      ORDER BY g.created_at DESC`,
    [FIXTURE_USER_ID, MODEL_KEY, `${GENERATION_PREFIX}%`, `%${GENERATION_SUFFIX}`]
  );
  return rows;
}

async function claimOneShotLease(db, jobId, workerId) {
  const [result] = await db.query(
    "UPDATE app_video_generations SET worker_lease_owner=?, worker_lease_until=DATE_ADD(NOW(), INTERVAL 5 MINUTE), updated_at=NOW() WHERE id=? AND status IN ('submitted','queued','processing','storing') AND (worker_lease_until IS NULL OR worker_lease_until<=NOW())",
    [workerId, jobId]
  );
  return result.affectedRows === 1;
}

async function readSnapshot(db, jobId) {
  const [rows] = await db.query(
    `SELECT g.id, g.user_id, g.status, g.provider_job_id, g.storage_attempts, g.result_storage_key, g.result_mime_type, g.result_size_bytes, g.result_sha256,
            r.status AS reservation_status, u.video_used, u.video_reserved
       FROM app_video_generations g
       LEFT JOIN app_video_quota_reservations r ON r.id=g.quota_reservation_id
       LEFT JOIN app_video_usage u ON u.user_id=g.user_id AND u.period_key=r.period_key
      WHERE g.id=? LIMIT 1`,
    [jobId]
  );
  return rows[0] || null;
}

async function main() {
  const report = {
    outcome: 'blocked', databaseFingerprint: databaseFingerprint(), maxMetisFinishRequests: MAX_METIS_FINISH_REQUESTS, realRequestCount: 0,
    statusGetCount: 0, downloadGetCount: 0, retries: 0, redirects: 0, pollLoops: 0,
    apiKeyRedacted: true, signedUrlRedacted: true, rawProviderResponseRedacted: true,
    submitCount: 0, newJobCount: 0, newReservationCount: 0, workerBefore: loadVideoWorkerConfig({}).processMode,
    workerDuring: 'not-started', workerAfter: loadVideoWorkerConfig({}).processMode
  };
  const ready = preconditions();
  if (ready.missing) {
    report.missingPreconditions = ready.missing;
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  let pool;
  let workerId = null;
  let claimedJobId = null;
  let leaseClaimed = false;
  try {
    pool = mysql.createPool({ host: ready.dbUrl.hostname, port: Number(ready.dbUrl.port || 3306), user: decodeURIComponent(ready.dbUrl.username), password: decodeURIComponent(ready.dbUrl.password), database: ready.dbUrl.pathname.slice(1), connectionLimit: 2, charset: 'utf8mb4' });
    const db = { init: async () => {}, query: (...args) => pool.query(...args), getConnection: () => pool.getConnection() };
    const [models] = await db.query('SELECT * FROM app_video_models WHERE internal_key=? LIMIT 1', [MODEL_KEY]);
    const model = models[0];
    if (!model || Number(model.is_active) !== 0 || model.upstream_vendor !== 'kwaivgi' || model.provider_model_id !== 'kling-v2.5-turbo-pro' || model.upstream_operation !== 'Video Generation' || Number(model.supports_text_to_video) !== 1 || Number(model.supports_image_to_video) !== 0) {
      report.outcome = 'blocked-invalid-model-registry';
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    report.model = { internalKey: model.internal_key, isActive: false, supportsImageToVideo: false };
    const jobs = await findMatchingJobs(db);
    report.matchingJobCount = jobs.length;
    const matchState = classifyMatchingJobs(jobs);
    if (matchState === 'not-found' || matchState === 'ambiguous') {
      report.outcome = matchState;
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    let job = jobs[0];
    report.jobFound = true;
    report.generationId = mask(job.provider_job_id);
    report.jobStatusBefore = job.status;
    report.reservationStatusBefore = job.reservation_status || null;
    report.usageBefore = { used: Number(job.video_used || 0), reserved: Number(job.video_reserved || 0) };
    if (matchState === 'terminal') {
      report.outcome = `terminal-${String(job.status || 'unknown').toLowerCase()}`;
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    if (!job.quota_reservation_id || job.reservation_status !== 'reserved') {
      report.outcome = 'blocked-invalid-existing-job';
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    workerId = `metis-finish-${crypto.randomUUID()}`;
    if (!await claimOneShotLease(db, job.id, workerId)) {
      report.outcome = 'lease-unavailable';
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    leaseClaimed = true;
    claimedJobId = job.id;
    report.workerDuring = 'one-shot-lease-only';
    job = await readSnapshot(db, job.id);
    const workerRepository = createVideoWorkerRepository(db);
    const provider = createMetisVideoProvider({ httpClient: createCountingStatusClient(report), baseUrl: process.env.METIS_BASE_URL, apiKey: process.env.METIS_API_KEY, resultAllowedHosts: [RESULT_HOST], resultAllowedPorts: [443], resultMaxRedirects: 0 });
    let status;
    try {
      status = await provider.getJobStatus(job.provider_job_id);
    } catch (error) {
      report.outcome = 'status-check-failed';
      report.error = safeError(error);
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    const normalized = provider.normalizeStatus(status);
    report.providerStatus = String(status?.status || normalized || 'unknown').toUpperCase();
    if (['queued', 'submitted', 'processing'].includes(normalized)) {
      report.outcome = 'provider-pending';
    } else if (normalized === 'failed' || normalized === 'cancelled') {
      await workerRepository.failAndReleaseJob({ jobId: job.id, workerId, errorCode: normalized === 'cancelled' ? 'VIDEO_PROVIDER_CANCELLED' : 'VIDEO_PROVIDER_FAILED', errorMessage: 'سرویس ساخت ویدیو با خطا مواجه شد.', releaseReason: normalized === 'cancelled' ? 'provider_cancelled' : 'provider_failure' });
      leaseClaimed = false;
      report.outcome = normalized === 'cancelled' ? 'provider-cancelled' : 'provider-failed';
    } else if (normalized === 'storing') {
      const descriptor = findFirstValidMp4Result(status);
      if (!descriptor) {
        await workerRepository.failStorageAndRelease({ jobId: job.id, workerId, errorCode: 'VIDEO_RESULT_DESCRIPTOR_INVALID' });
        leaseClaimed = false;
        report.outcome = 'completed-without-valid-mp4';
      } else {
        const structural = validateMetisResultUrl(descriptor.source);
        report.outputHost = structural.hostname;
        report.outputPathPrefixConfirmed = structural.pathname.startsWith(RESULT_PATH_PREFIX);
        report.outputExtension = '.mp4';
        report.signedQueryPresent = descriptor.signedQueryPresent;
        if (job.status !== 'storing') {
          if (!await workerRepository.markJobStoring({ jobId: job.id, workerId })) throw Object.assign(new Error('Could not transition the one-shot job to storing.'), { code: 'METIS_FINISH_STATE_CONFLICT' });
          job = { ...(await readSnapshot(db, job.id)), storage_attempts: 0 };
        }
        const storageConfig = { ...loadVideoStorageConfig(process.env), maxRedirects: 0 };
        const storage = createLocalVideoStorage(storageConfig);
        const downloader = createOneShotDownloadProvider({ report, storageConfig });
        const orchestrator = createVideoResultOrchestrator({ storage, config: storageConfig });
        const result = await orchestrator.store({ job, provider: downloader, descriptor, repository: workerRepository, workerId });
        leaseClaimed = false;
        report.outcome = result.action === 'succeeded' ? 'stored-and-finalized' : result.action;
        report.mp4Signature = result.action === 'succeeded' ? 'valid-ftyp' : null;
      }
    } else {
      report.outcome = 'provider-unknown-status';
    }
    const after = await readSnapshot(db, job.id);
    report.jobStatusAfter = after?.status || null;
    report.reservationStatusAfter = after?.reservation_status || null;
    report.usageAfter = { used: Number(after?.video_used || 0), reserved: Number(after?.video_reserved || 0) };
    report.storageKey = after?.result_storage_key || null;
    report.contentType = report.contentType || after?.result_mime_type || null;
    report.sizeBytes = after?.result_size_bytes === null || after?.result_size_bytes === undefined ? null : Number(after.result_size_bytes);
    report.sha256 = after?.result_sha256 ? mask(after.result_sha256) : null;
    report.workerAfter = loadVideoWorkerConfig({}).processMode;
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.outcome = 'blocked-or-failed-safely';
    report.error = safeError(error);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    if (pool && leaseClaimed && workerId && claimedJobId) {
      try { await createVideoWorkerRepository({ query: (...args) => pool.query(...args), getConnection: () => pool.getConnection() }).releaseJobLease({ jobId: claimedJobId, workerId }); } catch (_) {}
    }
    if (pool) await pool.end();
  }
}

if (require.main === module) main();
module.exports = { MAX_METIS_FINISH_REQUESTS, RESULT_HOST, RESULT_PATH_PREFIX, validateMetisResultUrl, findFirstValidMp4Result, classifyMatchingJobs, databaseFingerprint, findMatchingJobs, preconditions };
