'use strict';

// The only opt-in path for a paid Metis request. It is never imported by
// startup, migrations, the worker, or normal test commands.
const path = require('node:path');
const crypto = require('node:crypto');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const axios = require('axios');
const { METIS_KLING_V25_TURBO_PRO } = require('../src/modules/video-generation/video-model.registry');
const { createVideoGenerationRepository } = require('../src/modules/video-generation/video-generation.repository');
const { createVideoGenerationService } = require('../src/modules/video-generation/video-generation.service');
const { createMetisVideoProvider } = require('../src/modules/video-generation/providers/metis-video.provider');
const { loadVideoWorkerConfig } = require('../src/modules/video-generation/worker/video-worker.config');
const { createNoaRepository } = require('../src/modules/noa/noa.repository');
const { createNoaBillingService } = require('../src/modules/noa/noa-billing.service');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const MAX_LIVE_METIS_REQUESTS = 2;
const STATUS_WAIT_MS = 90_000;
const LIVE_PROMPT = 'A red ball slowly moving on a white table, static camera, soft studio lighting, clean background, no text, no watermark';
const LIVE_NEGATIVE_PROMPT = 'text, watermark, flicker, jitter, warping';

function mask(value) { const text = String(value || ''); return text.length < 9 ? '***' : `${text.slice(0, 4)}…${text.slice(-4)}`; }
function databaseFingerprint(value = process.env.DATABASE_URL) { return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 12); }
function safeError(error) { return { code: String(error?.code || 'METIS_LIVE_TEST_FAILED').slice(0, 100), message: 'The live test stopped safely; inspect local state without printing provider data.' }; }
function isLocalHost(host) { return ['localhost', '127.0.0.1', '::1'].includes(String(host || '').toLowerCase()); }
function fixtureIds() { const requested = String(process.env.METIS_VIDEO_LIVE_TEST_RUN_ID || new Date().toISOString().slice(0, 10).replaceAll('-', '')).toLowerCase(); const runId = requested.replace(/[^a-z0-9_-]/g, '').slice(0, 40); if (!runId) throw new Error('METIS_VIDEO_LIVE_TEST_RUN_ID is invalid.'); return { runId, userId: `metis-live-user-${runId}` }; }
function hostnameFromResult(status) { const item = status?.generations?.[0] || status?.result; const source = item?.url || item?.source; try { return source ? new URL(String(source)).hostname.toLowerCase() : null; } catch (_) { return null; } }
function preconditions() {
  const missing = [];
  if (process.env.RUN_METIS_VIDEO_LIVE_TEST !== '1') missing.push('RUN_METIS_VIDEO_LIVE_TEST=1');
  if (process.env.ALLOW_METIS_PAID_VIDEO_TEST !== '1') missing.push('ALLOW_METIS_PAID_VIDEO_TEST=1');
  if (!String(process.env.METIS_API_KEY || '').trim()) missing.push('METIS_API_KEY');
  if (String(process.env.METIS_BASE_URL || '').replace(/\/+$/, '') !== 'https://api.metisai.ir') missing.push('METIS_BASE_URL=https://api.metisai.ir');
  if (!String(process.env.DATABASE_URL || '').trim()) missing.push('DATABASE_URL');
  if (missing.length) return { missing };
  let dbUrl;
  try { dbUrl = new URL(process.env.DATABASE_URL); } catch (_) { return { missing: ['DATABASE_URL(valid)'] }; }
  if (dbUrl.protocol !== 'mysql:' || !isLocalHost(dbUrl.hostname)) return { missing: ['DATABASE_URL(local MySQL)'] };
  return { dbUrl };
}
function createCountingClient(report) {
  const client = axios.create({ timeout: 120_000, maxRedirects: 0 });
  const request = async (method, url, data, config) => {
    if (report.liveRequestCount >= MAX_LIVE_METIS_REQUESTS) { const error = new Error('Metis request limit reached.'); error.code = 'METIS_LIVE_REQUEST_LIMIT'; throw error; }
    const target = new URL(url);
    if (target.origin !== 'https://api.metisai.ir' || !/^\/api\/v2\/generate(?:\/[^/]+)?$/.test(target.pathname)) { const error = new Error('Unapproved Metis endpoint.'); error.code = 'METIS_LIVE_ENDPOINT_BLOCKED'; throw error; }
    report.liveRequestCount += 1;
    try {
      const response = await client.request({ method, url, data, ...config, maxRedirects: 0 });
      report.requests.push({ type: method === 'post' ? 'submit' : 'status', httpStatus: response.status });
      return response;
    } catch (error) {
      report.requests.push({ type: method === 'post' ? 'submit' : 'status', httpStatus: Number(error?.response?.status) || null });
      throw error;
    }
  };
  return { post: (url, data, config) => request('post', url, data, config), get: (url, config) => request('get', url, undefined, config) };
}
async function ensureFixture(db, billing, ids) {
  const [users] = await db.query('SELECT user_id FROM app_users WHERE user_id=? LIMIT 1', [ids.userId]);
  if (!users[0]) await db.query('INSERT INTO app_users (user_id,name,age,registered_at) VALUES (?,?,?,NOW())', [ids.userId, 'Metis Video Live Test (test-only)', 99]);
  const quote = await billing.quote({ actionKey: 'video_generation', quantity: '5' });
  await billing.credit({
    userId: ids.userId,
    amountNoa: quote.amountNoa,
    entryType: 'live_test_credit',
    referenceType: 'metis_live_test',
    referenceId: ids.runId,
    idempotencyKey: `metis-live-credit:${ids.runId}:pricing-v${quote.pricingVersion}`,
    payloadHash: { runId: ids.runId, quote },
    actorType: 'system',
    actorId: 'metis-live-test',
    metadata: { testOnly: true }
  });
  return { user: ids.userId, wallet: await billing.getBalance(ids.userId), quote };
}
async function wallet(billing, userId) { const value = await billing.getBalance(userId); return { availableNoa: value.availableNoa, reservedNoa: value.reservedNoa, totalNoa: value.totalNoa }; }
async function readLiveJob(db, userId) { const [rows] = await db.query('SELECT id,status,provider_job_id,noa_reservation_id FROM app_video_generations WHERE user_id=? ORDER BY created_at DESC LIMIT 1', [userId]); return rows[0] || null; }

async function main() {
  const report = { outcome: 'blocked', databaseFingerprint: databaseFingerprint(), maxLiveMetisRequests: MAX_LIVE_METIS_REQUESTS, liveRequestCount: 0, requests: [], retries: 0, pollLoops: 0, downloads: 0, apiKeyRedacted: true, rawProviderResponseRedacted: true, workerBefore: loadVideoWorkerConfig({}).processMode, workerDuring: 'not-started', workerAfter: loadVideoWorkerConfig({}).processMode, outputHostAllowlist: [] };
  const ready = preconditions();
  if (ready.missing) { report.missingPreconditions = ready.missing; console.log(JSON.stringify(report, null, 2)); return; }
  let pool;
  try {
    const ids = fixtureIds();
    pool = mysql.createPool({ host: ready.dbUrl.hostname, port: Number(ready.dbUrl.port || 3306), user: decodeURIComponent(ready.dbUrl.username), password: decodeURIComponent(ready.dbUrl.password), database: ready.dbUrl.pathname.slice(1), connectionLimit: 2, charset: 'utf8mb4' });
    const db = { init: async () => {}, query: (...args) => pool.query(...args), getConnection: () => pool.getConnection() };
    const [models] = await db.query('SELECT * FROM app_video_models WHERE internal_key=? LIMIT 1', [METIS_KLING_V25_TURBO_PRO.internalKey]);
    const model = models[0];
    if (!model || Number(model.is_active) !== 0 || model.upstream_vendor !== 'kwaivgi' || model.provider_model_id !== 'kling-v2.5-turbo-pro' || model.upstream_operation !== 'Video Generation' || Number(model.supports_text_to_video) !== 1 || Number(model.supports_image_to_video) !== 0) throw new Error('The local inactive Metis model registry record is incomplete.');
    report.model = { internalKey: model.internal_key, provider: model.provider, providerModelId: mask(model.provider_model_id), upstreamVendor: model.upstream_vendor, operation: model.upstream_operation, isActive: false };
    const noaBillingService = createNoaBillingService({
      repository: createNoaRepository(db)
    });
    report.fixture = await ensureFixture(db, noaBillingService, ids);
    const prior = await readLiveJob(db, ids.userId);
    if (prior) { report.outcome = 'blocked-existing-fixture-job'; report.existingJob = { id: prior.id, status: prior.status, providerJobId: mask(prior.provider_job_id) }; console.log(JSON.stringify(report, null, 2)); return; }
    const provider = createMetisVideoProvider({ httpClient: createCountingClient(report), baseUrl: process.env.METIS_BASE_URL, apiKey: process.env.METIS_API_KEY, resultAllowedHosts: [] });
    const service = createVideoGenerationService({
      repository: createVideoGenerationRepository(db, { noaBillingService }),
      noaBillingService,
      provider,
      canUseInactiveModel: ({ userId, model: candidate }) => userId === ids.userId && candidate.internal_key === METIS_KLING_V25_TURBO_PRO.internalKey && Number(candidate.is_active) === 0
    });
    let job;
    try {
      job = await service.submit({ userId: ids.userId, idempotencyKey: `metis-live-${ids.runId}`.slice(0, 191), input: { mode: 'text-to-video', modelKey: METIS_KLING_V25_TURBO_PRO.internalKey, prompt: LIVE_PROMPT, negativePrompt: LIVE_NEGATIVE_PROMPT, aspectRatio: '16:9', duration: '5', quality: '' } });
      report.generationId = mask(job.provider_job_id);
    } catch (error) {
      const stored = await readLiveJob(db, ids.userId);
      report.outcome = 'submit-failed'; report.error = safeError(error); report.internalJobStatus = stored?.status || null; report.reservationStatus = null; report.wallet = await wallet(noaBillingService, ids.userId); console.log(JSON.stringify(report, null, 2)); return;
    }
    await new Promise((resolve) => setTimeout(resolve, STATUS_WAIT_MS));
    let status;
    try { status = await provider.getJobStatus(job.provider_job_id); }
    catch (error) { const stored = await readLiveJob(db, ids.userId); report.outcome = 'status-check-failed'; report.error = safeError(error); report.internalJobStatus = stored?.status || null; report.wallet = await wallet(noaBillingService, ids.userId); console.log(JSON.stringify(report, null, 2)); return; }
    const normalized = provider.normalizeStatus(status); report.providerStatus = normalized || 'unknown'; report.providerCost = provider.normalizeCost(status) || null;
    if (normalized === 'storing') { await db.query("UPDATE app_video_generations SET status='storing', provider_status='COMPLETED', updated_at=NOW() WHERE id=? AND status='submitted'", [job.id]); report.outputHostname = hostnameFromResult(status); report.outcome = 'provider-completed-storage-pending-no-download'; }
    else if (normalized === 'failed' || normalized === 'cancelled') {
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        await noaBillingService.release(job.noaReservationId, {
          connection,
          reason: normalized === 'cancelled' ? 'provider_cancelled' : 'provider_failure',
          actorType: 'system',
          actorId: 'metis-live-test',
          metadata: { generationId: job.id }
        });
        await connection.query(
          "UPDATE app_video_generations SET status='failed', provider_status=?, failed_at=NOW(), updated_at=NOW() WHERE id=? AND status='submitted'",
          [normalized === 'failed' ? 'ERROR' : 'CANCELLED', job.id]
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
      report.outcome = normalized === 'failed' ? 'provider-failed' : 'provider-cancelled';
    }
    else report.outcome = ['queued', 'submitted', 'processing'].includes(normalized) ? 'provider-pending' : 'provider-unknown-status';
    const stored = await readLiveJob(db, ids.userId);
    const [reservations] = await db.query(
      'SELECT status FROM app_noa_reservations WHERE reservation_id=? LIMIT 1',
      [job.noaReservationId]
    );
    report.internalJobStatus = stored?.status || null;
    report.reservationStatus = reservations[0]?.status || null;
    report.wallet = await wallet(noaBillingService, ids.userId);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) { report.outcome = 'blocked-or-failed-safely'; report.error = safeError(error); console.log(JSON.stringify(report, null, 2)); process.exitCode = 1; }
  finally { if (pool) await pool.end(); }
}

if (require.main === module) main();
module.exports = { MAX_LIVE_METIS_REQUESTS, STATUS_WAIT_MS, databaseFingerprint, preconditions };
