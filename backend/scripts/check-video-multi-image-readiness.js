'use strict';

const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const errors = [];
const warnings = [];

function error(message) { errors.push(message); }
function warn(message) { warnings.push(message); }

async function main() {
  const activationExpected = String(process.env.VIDEO_MULTI_IMAGE_ACTIVATION_EXPECTED || '0').trim();
  const expectActive = activationExpected === '1';

  if (!expectActive) {
    console.log('VIDEO_MULTI_IMAGE_ACTIVATION_EXPECTED=0 — verifying safety defaults only.\n');
  } else {
    console.log('VIDEO_MULTI_IMAGE_ACTIVATION_EXPECTED=1 — verifying full activation readiness.\n');
  }

  const dbUrl = String(process.env.DATABASE_URL || '').trim();
  if (!dbUrl.startsWith('mysql://')) {
    error('DATABASE_URL must point to MySQL.');
    printReport();
    return;
  }

  const url = new URL(dbUrl);
  const db = await mysql.createConnection({
    host: url.hostname, port: url.port || 3306,
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1), multipleStatements: true
  });

  try {
    // Schema existence
    const tables = ['app_video_generation_inputs', 'app_video_models', 'app_video_input_media'];
    for (const t of tables) {
      const [r] = await db.query('SHOW TABLES LIKE ?', [t]);
      if (!r.length) error(`Missing table: ${t}`);
      else console.log(`  [OK] Table ${t} exists`);
    }

    // Column checks
    const [cols] = await db.query("SHOW COLUMNS FROM app_video_models LIKE 'supports_image_to_video_multi'");
    if (!cols.length) error("Missing column: app_video_models.supports_image_to_video_multi");
    else console.log('  [OK] supports_image_to_video_multi column exists');

    // Index check
    const [uqIdx] = await db.query("SHOW INDEX FROM app_video_input_media WHERE Key_name='uq_video_input_bound_generation'");
    if (uqIdx.length) error("Unique index uq_video_input_bound_generation still exists (should be replaced by non-unique)");
    else console.log('  [OK] uq_video_input_bound_generation is gone');

    const [nIdx] = await db.query("SHOW INDEX FROM app_video_input_media WHERE Key_name='idx_video_input_bound_generation'");
    if (!nIdx.length) error("Missing non-unique index idx_video_input_bound_generation");
    else {
      const allNonUnique = nIdx.every(r => Number(r.Non_unique) === 1);
      if (allNonUnique) console.log('  [OK] idx_video_input_bound_generation is non-unique');
      else error("idx_video_input_bound_generation is still unique");
    }

    // DB row checks
    const [prov] = await db.query("SELECT * FROM app_ai_providers WHERE provider_key='openrouter'");
    if (!prov.length) { error("OpenRouter provider not seeded"); }
    else {
      const p = prov[0];
      if (!expectActive && Number(p.enabled)) error("OpenRouter provider is ENABLED but activation is not expected");
      if (expectActive && !Number(p.enabled)) error("OpenRouter provider is DISABLED but activation is expected");
      console.log(`  [${Number(p.enabled) ? 'OK' : 'OK'}] OpenRouter provider exists (enabled=${p.enabled})`);
    }

    const [model] = await db.query("SELECT * FROM app_video_models WHERE internal_key='openrouter_grok_imagine_video'");
    if (!model.length) { error("OpenRouter model not seeded"); }
    else {
      const m = model[0];
      if (!expectActive && Number(m.is_active)) error("OpenRouter model is ACTIVE but activation is not expected");
      if (expectActive && !Number(m.is_active)) error("OpenRouter model is INACTIVE but activation is expected");
      console.log(`  [${Number(m.is_active) ? 'OK' : 'OK'}] OpenRouter model exists (is_active=${m.is_active})`);
    }

    const [route] = await db.query("SELECT * FROM app_ai_capability_routes WHERE capability_key='video.image_to_video_multi'");
    if (!route.length) { error("Multi-image capability route not seeded"); }
    else {
      const r = route[0];
      if (!expectActive && Number(r.enabled)) error("Multi-image route is ENABLED but activation is not expected");
      if (expectActive && !Number(r.enabled)) error("Multi-image route is DISABLED but activation is expected");
      console.log(`  [${Number(r.enabled) ? 'OK' : 'OK'}] Multi-image route exists (enabled=${r.enabled})`);
    }

    const [pricing] = await db.query("SELECT * FROM app_noa_pricing_configs WHERE action_key='video_multi_image_generation'");
    if (!pricing.length) { error("Multi-image pricing not seeded"); }
    else {
      const pr = pricing[0];
      if (!expectActive && Number(pr.is_active)) error("Multi-image pricing is ACTIVE but activation is not expected");
      if (expectActive && !Number(pr.is_active)) error("Multi-image pricing is INACTIVE but activation is expected");
      if (expectActive && Number(pr.unit_price) <= 0) error("Multi-image unit_price must be positive");
      console.log(`  [${Number(pr.is_active) ? 'OK' : 'OK'}] Multi-image pricing exists (is_active=${pr.is_active}, unit_price=${pr.unit_price})`);
    }

    // Environment checks for full activation
    if (expectActive) {
      if (!String(process.env.OPENROUTER_API_KEY || '').trim()) error("OPENROUTER_API_KEY is not configured");
      else console.log('  [OK] OPENROUTER_API_KEY is configured');

      if (!String(process.env.VIDEO_PROVIDER_INPUT_SIGNING_SECRET || '').trim()) warn("VIDEO_PROVIDER_INPUT_SIGNING_SECRET is not configured");
      else console.log('  [OK] Input signing secret is configured');

      const hostList = String(process.env.OPENROUTER_VIDEO_RESULT_ALLOWED_HOSTS || '').trim();
      if (!hostList) warn("OPENROUTER_VIDEO_RESULT_ALLOWED_HOSTS is empty — result downloads will fail");
      else console.log(`  [OK] Result allowed hosts configured: ${hostList.split(',')[0]}...`);

      // Worker credential check
      const { createVideoWorkerProviderRegistry } = require('../src/modules/video-generation/worker/video-worker.bootstrap');
      const registry = createVideoWorkerProviderRegistry({ httpClient: {}, env: process.env, storageConfig: { allowedHosts: [], allowedPorts: [443], allowedPathPrefixes: ['/'] } });
      if (!registry.openrouter) error("Worker registry cannot resolve 'openrouter'");
      else console.log('  [OK] Worker registry resolves openrouter');
    }
  } finally {
    await db.end();
  }

  printReport();
}

function printReport() {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Errors: ${errors.length} | Warnings: ${warnings.length}`);
  console.log(`${'='.repeat(50)}`);
  if (errors.length) {
    console.log('\nERRORS:');
    errors.forEach(e => console.log(`  - ${e}`));
  }
  if (warnings.length) {
    console.log('\nWARNINGS:');
    warnings.forEach(w => console.log(`  - ${w}`));
  }
  if (!errors.length && !warnings.length) console.log('\nAll checks passed.');
  process.exitCode = errors.length ? 1 : 0;
}

main().catch(e => { console.error('Readiness check failed:', e.message); process.exit(1); });
