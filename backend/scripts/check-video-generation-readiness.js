'use strict';

// This checker has no HTTP client and deliberately performs no provider request.
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const { loadVideoStorageConfig } = require('../src/modules/video-generation/storage/video-storage.config');
const { loadVideoWorkerConfig } = require('../src/modules/video-generation/worker/video-worker.config');
const { databaseOptions } = require('./admin-enable-video-model');
const { BANANAAI_IMAGE_TO_VIDEO_MODEL_KEY, BANANAAI_TEXT_TO_VIDEO_MODEL_KEY } = require('../src/modules/video-generation/video-model.registry');
dotenv.config({ path: path.join(__dirname, '../.env') });

const REQUIRED_COLUMNS = Object.freeze(['provider_job_id', 'negative_prompt', 'worker_lease_owner', 'result_sha256', 'recovery_started_at', 'danoa_request_id', 'capability_key', 'route_snapshot', 'provider_attempt_id', 'resolution', 'generate_audio', 'input_media_id','prompt_profile_id','prompt_profile_version_id','prompt_profile_key','prompt_profile_version','prompt_compiler_version','user_prompt','compiled_prompt','compiled_prompt_hash']);
const REQUIRED_TABLES = Object.freeze(['app_ai_providers','app_ai_capability_routes','app_ai_route_audit_logs','app_ai_provider_attempts','app_ai_provider_health','app_video_input_media','app_video_prompt_profiles','app_video_prompt_profile_versions','app_video_prompt_profile_audit_logs']);
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
    const [tables] = await connection.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
    const tableNames = new Set(tables.map((row) => row.TABLE_NAME));
    const missingTables = REQUIRED_TABLES.filter((name) => !tableNames.has(name));
    if (missingTables.length) throw new Error(`Missing AI routing tables: ${missingTables.join(', ')}`);
    const [indexes] = await connection.query("SELECT INDEX_NAME,NON_UNIQUE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='app_video_generations'");
    const indexNames = new Set(indexes.map((row) => row.INDEX_NAME));
    for (const index of ['uq_video_generations_danoa_request','idx_video_generations_route_created','idx_video_generations_prompt_profile_version','idx_video_generations_compiled_prompt_hash']) if (!indexNames.has(index)) throw new Error(`Missing video routing index: ${index}`);
    if (indexes.some((row) => row.INDEX_NAME === 'uq_video_generations_danoa_request' && Number(row.NON_UNIQUE) !== 0)) throw new Error('danoa_request_id index must be unique.');
    const [bananaProviders] = await connection.query("SELECT enabled FROM app_ai_providers WHERE provider_key='bananaai'");
    const [bananaModels] = await connection.query("SELECT COUNT(*) AS total,SUM(is_active) AS active,SUM(is_public) AS public_count FROM app_video_models WHERE provider='bananaai'");
    const [t2vRoutes] = await connection.query("SELECT enabled,primary_provider_key,primary_model_key,routing_policy FROM app_ai_capability_routes WHERE capability_key='video.text_to_video'");
    const [i2vRoutes] = await connection.query("SELECT enabled,primary_provider_key,primary_model_key,routing_policy FROM app_ai_capability_routes WHERE capability_key='video.image_to_video'");
    const [promptProfiles] = await connection.query("SELECT COUNT(*) AS total,SUM(is_active) AS active,SUM(is_public) AS public_count,SUM(current_version_id IS NOT NULL) AS versioned FROM app_video_prompt_profiles WHERE profile_key IN ('cinematic','animation')");
    if (!bananaProviders[0] || Number(bananaModels[0]?.total || 0) !== 7 || Number(bananaModels[0]?.active || 0) !== 2 || Number(bananaModels[0]?.public_count || 0) !== 0 || !t2vRoutes[0] || !i2vRoutes[0]) throw new Error('BananaAI Grok seed is incomplete.');
    if (t2vRoutes[0].primary_provider_key !== 'bananaai' || t2vRoutes[0].primary_model_key !== BANANAAI_TEXT_TO_VIDEO_MODEL_KEY || t2vRoutes[0].routing_policy !== 'PRIMARY_ONLY') throw new Error('Text-to-video route is not pinned to the dedicated BananaAI Grok registration.');
    if (i2vRoutes[0].primary_provider_key !== 'bananaai' || i2vRoutes[0].primary_model_key !== BANANAAI_IMAGE_TO_VIDEO_MODEL_KEY || i2vRoutes[0].routing_policy !== 'PRIMARY_ONLY') throw new Error('Image-to-video route is not pinned to BananaAI Grok.');
    if (Number(promptProfiles[0]?.total || 0)!==2 || Number(promptProfiles[0]?.active || 0)!==2 || Number(promptProfiles[0]?.public_count || 0)!==2 || Number(promptProfiles[0]?.versioned || 0)!==2) throw new Error('Video prompt profile seed is incomplete.');
    return { bananaProviderEnabled: Boolean(bananaProviders[0].enabled), bananaActiveModels: Number(bananaModels[0].active || 0), bananaPublicModels: Number(bananaModels[0].public_count || 0), textRouteEnabled: Boolean(t2vRoutes[0].enabled), imageRouteEnabled: Boolean(i2vRoutes[0].enabled), grokTextToVideoPinned: true, grokImageToVideoPinned: true, promptProfilesReady: true };
  } finally { await connection.end(); }
}

async function main({ env = process.env } = {}) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const storage = loadVideoStorageConfig(env);
  const worker = loadVideoWorkerConfig(env);
  if (storage.maxRedirects !== 0) throw new Error('Result redirects must remain disabled.');
  await assertWritable(storage.root); await assertWritable(storage.temporaryRoot);
  const database = await databaseChecks(env);
  const activationExpected = String(env.VIDEO_GENERATION_ACTIVATION_EXPECTED || '0') === '1';
  const providerInputMode = String(env.VIDEO_PROVIDER_INPUT_MODE || 'gateway').trim().toLowerCase();
  const remoteInputConfigured = providerInputMode === 'remote_upload'
    && Boolean(String(env.VIDEO_PROVIDER_INPUT_UPLOAD_BASE_URL || env.IMAGE_BASE_URL || '').trim())
    && Boolean(String(env.VIDEO_PROVIDER_INPUT_UPLOAD_ALLOWED_HOSTS || '').trim())
    && Boolean(String(env.VIDEO_PROVIDER_INPUT_UPLOAD_ALLOWED_PATH_PREFIXES || '').trim())
    && Boolean(String(env.VIDEO_PROVIDER_INPUT_UPLOAD_API_KEY || env.METIS_IMAGE_API_KEY || env.METIS_API_KEY || '').trim());
  const gatewayInputConfigured = providerInputMode === 'gateway'
    && Boolean(env.VIDEO_PROVIDER_INPUT_SIGNING_SECRET && env.VIDEO_PROVIDER_INPUT_PUBLIC_BASE_URL);
  const providerInputConfigured = remoteInputConfigured || gatewayInputConfigured;
  const report = {
    ready: true,
    databaseFingerprint: fingerprint(env.DATABASE_URL),
    featureEnabled: String(env.VIDEO_GENERATION_ENABLED || '0') === '1',
    bananaApiKeyConfigured: Boolean(String(env.BANANAAI_API_KEY || '').trim()),
    workerMode: worker.processMode,
    workerEnabled: worker.enabled,
    bananaProviderEnabled: database.bananaProviderEnabled,
    bananaActiveModels: database.bananaActiveModels,
    bananaPublicModels: database.bananaPublicModels,
    textRouteEnabled: database.textRouteEnabled,
    imageRouteEnabled: database.imageRouteEnabled,
    grokTextToVideoPinned: database.grokTextToVideoPinned,
    grokImageToVideoPinned: database.grokImageToVideoPinned,
    promptProfilesReady: database.promptProfilesReady,
    bananaResultContract: String(env.BANANAAI_VIDEO_RESULT_ALLOWED_HOSTS || '').trim() && String(env.BANANAAI_VIDEO_RESULT_ALLOWED_PATH_PREFIXES || '').trim() ? 'CONFIGURED' : 'BLOCKED',
    providerInputMode,
    providerInputGateway: providerInputConfigured ? 'CONFIGURED' : 'BLOCKED',
    storageWritable: true,
    externalRequests: 0
  };
  if (database.bananaActiveModels !== 2 || database.bananaPublicModels) throw new Error('BananaAI must keep exactly two private, capability-specific Grok registrations active.');
  if (activationExpected) {
    if (report.featureEnabled !== true || !worker.enabled || !env.BANANAAI_API_KEY || report.bananaResultContract !== 'CONFIGURED' || !database.bananaProviderEnabled || !database.textRouteEnabled) {
      throw new Error('Activated BananaAI text-to-video readiness is incomplete.');
    }
  } else if (database.bananaProviderEnabled || database.textRouteEnabled) {
    throw new Error('BananaAI provider and route are active while activation is not expected.');
  }
  console.log(JSON.stringify(report));
  return report;
}

if (require.main === module) main().catch((error) => { console.error(`Video generation readiness failed: ${error.message}`); process.exitCode = 1; });
module.exports = { fingerprint, assertWritable, databaseChecks, main };
