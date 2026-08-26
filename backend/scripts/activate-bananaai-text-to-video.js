'use strict';

const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const { databaseOptions } = require('./admin-enable-video-model');
const { BANANAAI_TEXT_TO_VIDEO_MODEL_KEY, BANANAAI_TEXT_TO_VIDEO_MODEL_ID } = require('../src/modules/video-generation/video-model.registry');

dotenv.config({ path: path.join(__dirname, '../.env') });

function assertActivationConfig(env) {
  if (String(env.VIDEO_GENERATION_ACTIVATION_EXPECTED || '0') !== '1') throw new Error('VIDEO_GENERATION_ACTIVATION_EXPECTED=1 is required.');
  if (String(env.VIDEO_GENERATION_ENABLED || '0') !== '1') throw new Error('VIDEO_GENERATION_ENABLED=1 is required.');
  if (!String(env.BANANAAI_API_KEY || '').trim()) throw new Error('BANANAAI_API_KEY is required.');
  if (!String(env.BANANAAI_VIDEO_RESULT_ALLOWED_HOSTS || '').trim() || !String(env.BANANAAI_VIDEO_RESULT_ALLOWED_PATH_PREFIXES || '').trim()) throw new Error('BananaAI result URL contract is required.');
}

async function main({ env = process.env } = {}) {
  assertActivationConfig(env);
  const connection = await mysql.createConnection(databaseOptions(env.DATABASE_URL));
  try {
    await connection.beginTransaction();
    const [[provider]] = await connection.query("SELECT * FROM app_ai_providers WHERE provider_key='bananaai' FOR UPDATE");
    const [[model]] = await connection.query('SELECT * FROM app_video_models WHERE internal_key=? FOR UPDATE', [BANANAAI_TEXT_TO_VIDEO_MODEL_KEY]);
    const [[route]] = await connection.query("SELECT * FROM app_ai_capability_routes WHERE capability_key='video.text_to_video' FOR UPDATE");
    if (!provider || !model || !route) throw new Error('BananaAI text-to-video seed is incomplete. Apply migrations first.');
    if (model.provider !== 'bananaai' || model.provider_model_id !== BANANAAI_TEXT_TO_VIDEO_MODEL_ID || !model.is_active || !model.supports_text_to_video || model.supports_image_to_video) throw new Error('The active text-to-video model is not the dedicated BananaAI Grok registration.');
    if (route.primary_provider_key !== 'bananaai' || route.primary_model_key !== BANANAAI_TEXT_TO_VIDEO_MODEL_KEY || route.routing_policy !== 'PRIMARY_ONLY') throw new Error('Text-to-video route is not pinned to BananaAI Grok.');

    if (!provider.enabled) await connection.query("UPDATE app_ai_providers SET enabled=1,version=version+1,updated_at=NOW() WHERE provider_key='bananaai'");
    if (!route.enabled) {
      const previous = { enabled: false, providerKey: route.primary_provider_key, modelKey: route.primary_model_key, policy: route.routing_policy, version: Number(route.version) };
      const next = { ...previous, enabled: true, version: Number(route.version) + 1 };
      await connection.query("UPDATE app_ai_capability_routes SET enabled=1,version=version+1,updated_at=NOW() WHERE capability_key='video.text_to_video'");
      await connection.query(
        'INSERT INTO app_ai_route_audit_logs (route_id,capability_key,previous_configuration,new_configuration,changed_by,reason,created_at) VALUES (?,?,?,?,?,?,NOW())',
        [route.route_id, route.capability_key, JSON.stringify(previous), JSON.stringify(next), 'activation-script', 'Enable the production BananaAI Grok text-to-video route after readiness validation.']
      );
    }
    await connection.commit();
    console.log(JSON.stringify({ action: 'bananaai-text-to-video-active', provider: 'bananaai', model: BANANAAI_TEXT_TO_VIDEO_MODEL_ID, route: 'video.text_to_video' }));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

if (require.main === module) main().catch((error) => { console.error(`BananaAI activation refused: ${error.message}`); process.exitCode = 1; });
module.exports = { assertActivationConfig, main };
