'use strict';

const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const { databaseOptions } = require('./admin-enable-video-model');
const { BANANAAI_IMAGE_TO_VIDEO_MODEL_KEY, BANANAAI_IMAGE_TO_VIDEO_MODEL_ID } = require('../src/modules/video-generation/video-model.registry');

dotenv.config({ path: path.join(__dirname, '../.env') });

function assertActivationConfig(env) {
  if (String(env.VIDEO_GENERATION_ACTIVATION_EXPECTED || '0') !== '1') throw new Error('VIDEO_GENERATION_ACTIVATION_EXPECTED=1 is required.');
  if (String(env.VIDEO_GENERATION_ENABLED || '0') !== '1') throw new Error('VIDEO_GENERATION_ENABLED=1 is required.');
  if (!String(env.BANANAAI_API_KEY || '').trim()) throw new Error('BANANAAI_API_KEY is required.');
  if (!String(env.BANANAAI_VIDEO_RESULT_ALLOWED_HOSTS || '').trim() || !String(env.BANANAAI_VIDEO_RESULT_ALLOWED_PATH_PREFIXES || '').trim()) throw new Error('BananaAI result URL contract is required.');
  const mode = String(env.VIDEO_PROVIDER_INPUT_MODE || 'gateway').trim().toLowerCase();
  if (mode === 'remote_upload') {
    if (!String(env.VIDEO_PROVIDER_INPUT_UPLOAD_ALLOWED_HOSTS || '').trim() || !String(env.VIDEO_PROVIDER_INPUT_UPLOAD_ALLOWED_PATH_PREFIXES || '').trim()) throw new Error('Remote input upload URL contract is required.');
    if (!String(env.VIDEO_PROVIDER_INPUT_UPLOAD_API_KEY || env.METIS_IMAGE_API_KEY || env.METIS_API_KEY || '').trim()) throw new Error('Remote input upload API key is required.');
  } else if (mode === 'gateway') {
    if (!env.VIDEO_PROVIDER_INPUT_SIGNING_SECRET || !env.VIDEO_PROVIDER_INPUT_PUBLIC_BASE_URL) throw new Error('Public provider input gateway is required.');
  } else {
    throw new Error('VIDEO_PROVIDER_INPUT_MODE_INVALID');
  }
}

async function main({ env = process.env } = {}) {
  assertActivationConfig(env);
  const connection = await mysql.createConnection(databaseOptions(env.DATABASE_URL));
  try {
    await connection.beginTransaction();
    const [[provider]] = await connection.query("SELECT * FROM app_ai_providers WHERE provider_key='bananaai' FOR UPDATE");
    const [[model]] = await connection.query('SELECT * FROM app_video_models WHERE internal_key=? FOR UPDATE', [BANANAAI_IMAGE_TO_VIDEO_MODEL_KEY]);
    const [[route]] = await connection.query("SELECT * FROM app_ai_capability_routes WHERE capability_key='video.image_to_video' FOR UPDATE");
    if (!provider || !model || !route) throw new Error('BananaAI image-to-video seed is incomplete. Apply migrations first.');
    if (model.provider !== 'bananaai' || model.provider_model_id !== BANANAAI_IMAGE_TO_VIDEO_MODEL_ID || !model.is_active || !model.supports_image_to_video) throw new Error('The active image-to-video model is not BananaAI Grok.');
    if (route.primary_provider_key !== 'bananaai' || route.primary_model_key !== BANANAAI_IMAGE_TO_VIDEO_MODEL_KEY || route.routing_policy !== 'PRIMARY_ONLY') throw new Error('Image-to-video route is not pinned to BananaAI Grok.');

    if (!provider.enabled) {
      await connection.query("UPDATE app_ai_providers SET enabled=1,version=version+1,updated_at=NOW() WHERE provider_key='bananaai'");
    }
    if (!route.enabled) {
      const previous = { enabled: false, providerKey: route.primary_provider_key, modelKey: route.primary_model_key, policy: route.routing_policy, version: Number(route.version) };
      const next = { ...previous, enabled: true, version: Number(route.version) + 1 };
      await connection.query("UPDATE app_ai_capability_routes SET enabled=1,version=version+1,updated_at=NOW() WHERE capability_key='video.image_to_video'");
      await connection.query(
        'INSERT INTO app_ai_route_audit_logs (route_id,capability_key,previous_configuration,new_configuration,changed_by,reason,created_at) VALUES (?,?,?,?,?,?,NOW())',
        [route.route_id, route.capability_key, JSON.stringify(previous), JSON.stringify(next), 'activation-script', 'Enable the production BananaAI Grok image-to-video route after readiness validation.']
      );
    }
    await connection.commit();
    console.log(JSON.stringify({ action: 'bananaai-image-to-video-active', provider: 'bananaai', model: BANANAAI_IMAGE_TO_VIDEO_MODEL_ID, route: 'video.image_to_video' }));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

if (require.main === module) main().catch((error) => { console.error(`BananaAI activation refused: ${error.message}`); process.exitCode = 1; });
module.exports = { assertActivationConfig, main };
