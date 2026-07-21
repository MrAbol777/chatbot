'use strict';

// This checker has no HTTP client and deliberately performs no Metis request.
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const { loadVideoStorageConfig } = require('../src/modules/video-generation/storage/video-storage.config');
const { loadVideoWorkerConfig } = require('../src/modules/video-generation/worker/video-worker.config');
const { databaseOptions } = require('./admin-enable-video-model');
dotenv.config({ path: path.join(__dirname, '../.env') });

const MODEL_KEY = 'metis_kling_v25_turbo_pro';
const REQUIRED_COLUMNS = Object.freeze(['provider_job_id', 'negative_prompt', 'worker_lease_owner', 'result_sha256', 'recovery_started_at']);
const fingerprint = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 12);

async function assertWritable(directory) {
  await fs.mkdir(directory, { recursive: true });
  const probe = path.join(directory, `.video-readiness-${process.pid}-${Date.now()}`);
  await fs.writeFile(probe, 'ok', { mode: 0o600 });
  await fs.unlink(probe);
}

async function databaseChecks(env) {
  const connection = await mysql.createConnection(databaseOptions(env.DATABASE_URL));
  try {
    const [columns] = await connection.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='app_video_generations'");
    const available = new Set(columns.map((row) => row.COLUMN_NAME));
    const missing = REQUIRED_COLUMNS.filter((name) => !available.has(name));
    if (missing.length) throw new Error(`Missing video migration columns: ${missing.join(', ')}`);
    const [models] = await connection.query('SELECT internal_key,is_active,supports_text_to_video,supports_image_to_video FROM app_video_models WHERE internal_key=?', [MODEL_KEY]);
    if (!models[0]) throw new Error('Metis model registry entry is missing.');
    return { modelActive: Boolean(models[0].is_active), imageToVideoActive: Boolean(models[0].supports_image_to_video) };
  } finally { await connection.end(); }
}

async function main({ env = process.env } = {}) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const storage = loadVideoStorageConfig(env);
  const worker = loadVideoWorkerConfig(env);
  if (env.METIS_BASE_URL && env.METIS_BASE_URL !== 'https://api.metisai.ir') throw new Error('METIS_BASE_URL must be https://api.metisai.ir.');
  if (!storage.allowedHosts.includes('api.metisai.ir')) throw new Error('Result host allowlist must include api.metisai.ir.');
  if (!storage.allowedPathPrefixes.includes('/api/tpsgsbxstoragecontainer/router/tpsgsbxstoragecontainer/router/')) throw new Error('Result path allowlist is missing the verified Metis prefix.');
  if (storage.maxRedirects !== 0) throw new Error('Result redirects must remain disabled.');
  await assertWritable(storage.root); await assertWritable(storage.temporaryRoot);
  const database = await databaseChecks(env);
  const report = {
    ready: true,
    databaseFingerprint: fingerprint(env.DATABASE_URL),
    featureEnabled: String(env.VIDEO_GENERATION_ENABLED || '0') === '1',
    metisApiKeyConfigured: Boolean(env.METIS_API_KEY),
    workerMode: worker.processMode,
    workerEnabled: worker.enabled,
    modelActive: database.modelActive,
    imageToVideoActive: database.imageToVideoActive,
    storageWritable: true,
    externalRequests: 0
  };
  if (database.imageToVideoActive) throw new Error('Image-to-video must remain disabled.');
  console.log(JSON.stringify(report));
  return report;
}

if (require.main === module) main().catch((error) => { console.error(`Video generation readiness failed: ${error.message}`); process.exitCode = 1; });
module.exports = { fingerprint, assertWritable, databaseChecks, main };
