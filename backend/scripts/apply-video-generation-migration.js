const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const {
  METIS_KLING_V25_TURBO_PRO,
  VIDEO_MODEL_REGISTRATIONS
} = require('../src/modules/video-generation/video-model.registry');
const { VIDEO_PROMPT_PRESETS } = require('../src/modules/video-prompt-profiles/video-prompt-presets');
const { profileChecksum } = require('../src/modules/video-prompt-profiles/video-prompt-compiler');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function hasColumn(connection, table, column) {
  const [rows] = await connection.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [column]);
  return rows.length > 0;
}

async function hasIndex(connection, table, index) {
  const [rows] = await connection.query(`SHOW INDEX FROM \`${table}\` WHERE Key_name=?`, [index]);
  return rows.length > 0;
}

async function hasTable(connection, table) {
  const [rows] = await connection.query('SHOW TABLES LIKE ?', [table]);
  return rows.length > 0;
}

async function hasForeignKey(connection, table, constraint) {
  const [rows] = await connection.query(
    'SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME=? AND CONSTRAINT_TYPE=\'FOREIGN KEY\' LIMIT 1',
    [table, constraint]
  );
  return rows.length > 0;
}

async function ensureForeignKey(connection, table, constraint, definition) {
  if (!await hasForeignKey(connection, table, constraint)) {
    await connection.query(`ALTER TABLE \`${table}\` ADD CONSTRAINT \`${constraint}\` ${definition}`);
  }
}

async function ensureColumn(connection, table, column, definition) {
  if (!await hasColumn(connection, table, column)) {
    await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
}

async function ensureIndex(connection, table, index, columns) {
  if (!await hasIndex(connection, table, index)) {
    await connection.query(`ALTER TABLE \`${table}\` ADD INDEX \`${index}\` (${columns})`);
  }
}

async function ensureUniqueIndex(connection, table, index, columns) {
  const [rows] = await connection.query(`SHOW INDEX FROM \`${table}\` WHERE Key_name=?`, [index]);
  if (rows.length && rows.some((row) => Number(row.Non_unique) !== 0)) await connection.query(`ALTER TABLE \`${table}\` DROP INDEX \`${index}\``);
  if (!rows.length || rows.some((row) => Number(row.Non_unique) !== 0)) await connection.query(`ALTER TABLE \`${table}\` ADD UNIQUE INDEX \`${index}\` (${columns})`);
}

async function applyWorkerRepositoryMigration(connection) {
  await connection.query("ALTER TABLE app_video_generations MODIFY COLUMN status ENUM('queued','submitting','submitted','processing','succeeded','failed','cancelled','expired') NOT NULL");
  await ensureColumn(connection, 'app_video_generations', 'worker_lease_owner', 'VARCHAR(191) NULL AFTER worker_lease_until');
  await ensureColumn(connection, 'app_video_generations', 'last_polled_at', 'DATETIME NULL AFTER next_poll_at');
  await ensureColumn(connection, 'app_video_generations', 'cancelled_at', 'DATETIME NULL AFTER failed_at');
  await ensureColumn(connection, 'app_video_generations', 'expired_at', 'DATETIME NULL AFTER cancelled_at');
  await ensureIndex(connection, 'app_video_generations', 'idx_video_generations_status_poll_lease', '`status`, `next_poll_at`, `worker_lease_until`');
}

async function applyResultStorageMigration(connection) {
  await connection.query("ALTER TABLE app_video_generations MODIFY COLUMN status ENUM('queued','submitting','submitted','processing','storing','succeeded','failed','cancelled','expired') NOT NULL");
  await ensureColumn(connection, 'app_video_generations', 'result_storage_status', "ENUM('pending','stored','failed') NULL AFTER result_size_bytes");
  await ensureColumn(connection, 'app_video_generations', 'result_sha256', 'CHAR(64) NULL AFTER result_storage_status');
  await ensureColumn(connection, 'app_video_generations', 'result_original_filename', 'VARCHAR(255) NULL AFTER result_sha256');
  await ensureColumn(connection, 'app_video_generations', 'result_stored_at', 'DATETIME NULL AFTER result_original_filename');
  await ensureColumn(connection, 'app_video_generations', 'storage_attempts', 'INT NOT NULL DEFAULT 0 AFTER poll_attempts');
  await ensureColumn(connection, 'app_video_generations', 'next_storage_attempt_at', 'DATETIME NULL AFTER storage_attempts');
  await ensureColumn(connection, 'app_video_generations', 'storage_safe_error_code', 'VARCHAR(100) NULL AFTER safe_error_message');
  await ensureColumn(connection, 'app_video_generations', 'storage_safe_error_message', 'VARCHAR(500) NULL AFTER storage_safe_error_code');
  await ensureIndex(connection, 'app_video_generations', 'idx_video_generations_status_storage_attempt', '`status`, `next_storage_attempt_at`');
  await ensureIndex(connection, 'app_video_generations', 'idx_video_generations_result_storage_status', '`result_storage_status`');
  if (!await hasIndex(connection, 'app_video_generations', 'uq_video_generations_result_storage_key')) await connection.query('ALTER TABLE app_video_generations ADD UNIQUE INDEX uq_video_generations_result_storage_key (result_storage_key)');
}

async function applyMetisKlingModelMigration(connection) {
  await connection.query('ALTER TABLE app_video_models MODIFY COLUMN max_prompt_length INT NULL');
  await ensureColumn(connection, 'app_video_models', 'upstream_vendor', 'VARCHAR(64) NULL AFTER provider');
  await ensureColumn(connection, 'app_video_models', 'display_name', 'VARCHAR(191) NULL AFTER display_name_fa');
  await ensureColumn(connection, 'app_video_models', 'upstream_supports_image_to_video', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER supports_image_to_video');
  await ensureColumn(connection, 'app_video_models', 'upstream_supports_start_image', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER upstream_supports_image_to_video');
  await ensureColumn(connection, 'app_video_models', 'supports_negative_prompt', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER upstream_supports_start_image');
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/029_video_generation_metis_kling_model.sql'), 'utf8');
  for (const model of [METIS_KLING_V25_TURBO_PRO]) {
    await connection.query(sql, [
      model.internalKey, model.provider, model.upstreamVendor, model.providerModelId,
      model.displayNameFa, model.displayName, model.descriptionFa, Number(model.isActive),
      Number(model.supportsTextToVideo), Number(model.supportsImageToVideo),
      Number(model.upstreamSupportsImageToVideo), Number(model.upstreamSupportsStartImage),
      Number(model.supportsNegativePrompt), JSON.stringify(model.allowedAspectRatios),
      JSON.stringify(model.allowedDurations), JSON.stringify(model.allowedQualities),
      model.maxPromptLength, model.sortOrder
    ]);
  }
}

async function applyMetisKlingOperationMigration(connection) {
  // These fields are needed to keep the verified provider contract in the
  // private registry, rather than accepting provider identifiers from clients.
  await ensureColumn(connection, 'app_video_models', 'upstream_operation', 'VARCHAR(128) NULL AFTER provider_model_id');
  await ensureColumn(connection, 'app_video_generations', 'negative_prompt', 'TEXT NULL AFTER prompt');
  for (const model of [METIS_KLING_V25_TURBO_PRO]) {
    await connection.query(
      'UPDATE app_video_models SET upstream_operation=?, supports_image_to_video=0, updated_at=NOW() WHERE internal_key=?',
      [model.upstreamOperation, model.internalKey]
    );
  }
}

async function applyProductionReadinessMigration(connection) {
  await ensureColumn(connection, 'app_video_generations', 'recovery_started_at', 'DATETIME NULL AFTER failed_at');
  await ensureColumn(connection, 'app_video_generations', 'recovery_completed_at', 'DATETIME NULL AFTER recovery_started_at');
}

async function applyAiRoutingSchemaMigration(connection) {
  await ensureColumn(connection, 'app_video_models', 'is_public', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active');
  await ensureColumn(connection, 'app_video_models', 'allowed_resolutions', 'JSON NULL AFTER allowed_qualities');
  await ensureColumn(connection, 'app_video_models', 'capability_config', 'JSON NULL AFTER allowed_resolutions');
  await ensureColumn(connection, 'app_video_models', 'supports_audio', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER supports_negative_prompt');
  await ensureColumn(connection, 'app_video_models', 'supports_first_frame', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER supports_audio');
  await ensureColumn(connection, 'app_video_models', 'supports_last_frame', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER supports_first_frame');
  await ensureColumn(connection, 'app_video_models', 'supports_idempotency', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER supports_last_frame');
  await ensureColumn(connection, 'app_video_models', 'supports_webhook', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER supports_idempotency');
  await ensureColumn(connection, 'app_video_models', 'cost_config', 'JSON NULL AFTER supports_webhook');
  await ensureColumn(connection, 'app_video_models', 'provider_config', 'JSON NULL AFTER cost_config');
  await ensureColumn(connection, 'app_video_models', 'config_version', 'BIGINT NOT NULL DEFAULT 1 AFTER provider_config');

  await connection.query("ALTER TABLE app_video_generations MODIFY COLUMN status ENUM('queued','routing','submitting','submitted','processing','storing','provider_status_unknown','succeeded','failed','cancelled','expired') NOT NULL");
  await ensureColumn(connection, 'app_video_generations', 'danoa_request_id', 'VARCHAR(64) NULL AFTER id');
  await ensureColumn(connection, 'app_video_generations', 'capability_key', 'VARCHAR(100) NULL AFTER mode');
  await ensureColumn(connection, 'app_video_generations', 'route_id', 'VARCHAR(64) NULL AFTER capability_key');
  await ensureColumn(connection, 'app_video_generations', 'route_version', 'BIGINT NULL AFTER route_id');
  await ensureColumn(connection, 'app_video_generations', 'route_snapshot', 'JSON NULL AFTER route_version');
  await ensureColumn(connection, 'app_video_generations', 'provider_attempt_id', 'VARCHAR(64) NULL AFTER provider_job_id');
  await ensureColumn(connection, 'app_video_generations', 'resolution', 'VARCHAR(32) NULL AFTER quality');
  await ensureColumn(connection, 'app_video_generations', 'generate_audio', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER resolution');
  await ensureColumn(connection, 'app_video_generations', 'input_media_id', 'VARCHAR(64) NULL AFTER input_media_reference');
  await ensureUniqueIndex(connection, 'app_video_generations', 'uq_video_generations_danoa_request', '`danoa_request_id`');
  await ensureIndex(connection, 'app_video_generations', 'idx_video_generations_route_created', '`route_id`, `created_at`');

  const routingSql = fs.readFileSync(path.join(__dirname, '../migrations/032_ai_video_routing.sql'), 'utf8');
  await connection.query(routingSql);
  await ensureColumn(connection, 'app_ai_providers', 'version', 'BIGINT NOT NULL DEFAULT 1 AFTER enabled');
  await ensureColumn(connection, 'app_ai_provider_attempts', 'version', 'BIGINT NOT NULL DEFAULT 1 AFTER safe_error_summary');
  await ensureColumn(connection, 'app_ai_provider_health', 'version', 'BIGINT NOT NULL DEFAULT 1 AFTER failure_count');
  const mediaSql = fs.readFileSync(path.join(__dirname, '../migrations/033_video_input_media.sql'), 'utf8');
  await connection.query(mediaSql);
}

async function seedVideoModel(connection, model) {
  await connection.query(
    `INSERT IGNORE INTO app_video_models
      (internal_key,provider,upstream_vendor,provider_model_id,upstream_operation,display_name_fa,display_name,description_fa,is_active,is_public,
       supports_text_to_video,supports_image_to_video,upstream_supports_image_to_video,upstream_supports_start_image,supports_negative_prompt,
       supports_audio,supports_first_frame,supports_last_frame,supports_idempotency,supports_webhook,
       allowed_aspect_ratios,allowed_durations,allowed_qualities,allowed_resolutions,capability_config,max_prompt_length,max_input_image_bytes,
       cost_config,provider_config,sort_order,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())`,
    [
      model.internalKey, model.provider, model.upstreamVendor || null, model.providerModelId, model.upstreamOperation || null,
      model.displayNameFa, model.displayName, model.descriptionFa, Number(Boolean(model.isActive)), Number(Boolean(model.isPublic)),
      Number(Boolean(model.supportsTextToVideo)), Number(Boolean(model.supportsImageToVideo)), Number(Boolean(model.upstreamSupportsImageToVideo)),
      Number(Boolean(model.upstreamSupportsStartImage)), Number(Boolean(model.supportsNegativePrompt)), Number(Boolean(model.supportsAudio)),
      Number(Boolean(model.supportsFirstFrame)), Number(Boolean(model.supportsLastFrame)), Number(Boolean(model.supportsIdempotency)), Number(Boolean(model.supportsWebhook)),
      JSON.stringify(model.allowedAspectRatios || []), JSON.stringify(model.allowedDurations || []), JSON.stringify(model.allowedQualities || []),
      JSON.stringify(model.allowedResolutions || []), JSON.stringify(model.capabilityConfig || {}), model.maxPromptLength,
      model.maxInputBytes ?? null, JSON.stringify(model.costConfig || {}), JSON.stringify(model.providerConfig || { readiness: model.provider === 'bananaai' ? 'BLOCKED' : 'READY' }),
      model.sortOrder
    ]
  );
}

async function applyAiRoutingSeedMigration(connection) {
  const seedSql = fs.readFileSync(path.join(__dirname, '../migrations/034_ai_video_routing_seed.sql'), 'utf8');
  const statements = seedSql.replace(/^\s*--.*$/gm, '').split(';').map((value) => value.trim()).filter((value) => value.startsWith('INSERT'));
  await connection.query(statements[0], ['metis', 'Metis Video', 1, 'https://api.metisai.ir', 'METIS_API_KEY', JSON.stringify({ adapter: 'metis' })]);
  await connection.query(statements[0], ['bananaai', 'BananaAI', 0, 'https://bananaai.ir', 'BANANAAI_API_KEY', JSON.stringify({ readiness: 'BLOCKED' })]);

  for (const model of VIDEO_MODEL_REGISTRATIONS) await seedVideoModel(connection, model);

  await connection.query(statements[1], ['video-t2v', 'video.text_to_video', 'metis', METIS_KLING_V25_TURBO_PRO.internalKey, null, null, 'PRIMARY_ONLY', 1, JSON.stringify({ compatibility: 'legacy-metis' })]);
  await connection.query(statements[1], ['video-i2v', 'video.image_to_video', null, null, null, null, 'PRIMARY_ONLY', 0, JSON.stringify({ readiness: 'BLOCKED' })]);
  for (const providerKey of ['metis', 'bananaai']) {
    for (const capability of ['video.text_to_video', 'video.image_to_video']) {
      await connection.query(
        `INSERT IGNORE INTO app_ai_provider_health
          (provider_key,capability_key,circuit_state,failure_threshold,cooldown_seconds,half_open_max_attempts,half_open_attempts,consecutive_failures,success_count,failure_count,updated_at)
         VALUES (?,?,'CLOSED',5,300,1,0,0,0,0,NOW())`,
        [providerKey, capability]
      );
    }
  }
}

async function applyVideoPromptProfilesMigration(connection) {
  const schemaSql = fs.readFileSync(path.join(__dirname, '../migrations/035_video_prompt_profiles.sql'), 'utf8');
  await connection.query(schemaSql);
  await ensureColumn(connection, 'app_video_generations', 'prompt_profile_id', 'VARCHAR(64) NULL AFTER input_media_id');
  await ensureColumn(connection, 'app_video_generations', 'prompt_profile_version_id', 'VARCHAR(64) NULL AFTER prompt_profile_id');
  await ensureColumn(connection, 'app_video_generations', 'prompt_profile_key', 'VARCHAR(64) NULL AFTER prompt_profile_version_id');
  await ensureColumn(connection, 'app_video_generations', 'prompt_profile_version', 'INT NULL AFTER prompt_profile_key');
  await ensureColumn(connection, 'app_video_generations', 'prompt_compiler_version', 'VARCHAR(32) NULL AFTER prompt_profile_version');
  await ensureColumn(connection, 'app_video_generations', 'user_prompt', 'TEXT NULL AFTER prompt');
  await ensureColumn(connection, 'app_video_generations', 'compiled_prompt', 'MEDIUMTEXT NULL AFTER user_prompt');
  await ensureColumn(connection, 'app_video_generations', 'compiled_prompt_hash', 'CHAR(64) NULL AFTER compiled_prompt');
  await ensureIndex(connection, 'app_video_generations', 'idx_video_generations_prompt_profile_version', '`prompt_profile_version_id`, `created_at`');
  await ensureIndex(connection, 'app_video_generations', 'idx_video_generations_compiled_prompt_hash', '`compiled_prompt_hash`');
  await ensureForeignKey(connection, 'app_video_prompt_profiles', 'fk_video_prompt_current_version', 'FOREIGN KEY (`current_version_id`) REFERENCES `app_video_prompt_profile_versions` (`id`) ON DELETE RESTRICT');
  await ensureForeignKey(connection, 'app_video_generations', 'fk_video_generation_prompt_profile', 'FOREIGN KEY (`prompt_profile_id`) REFERENCES `app_video_prompt_profiles` (`id`) ON DELETE RESTRICT');
  await ensureForeignKey(connection, 'app_video_generations', 'fk_video_generation_prompt_version', 'FOREIGN KEY (`prompt_profile_version_id`) REFERENCES `app_video_prompt_profile_versions` (`id`) ON DELETE RESTRICT');

  const promptRoot = path.join(__dirname, '../../docs/video-prompts');
  for (const preset of VIDEO_PROMPT_PRESETS) {
    const sourcePath = path.join(promptRoot, preset.sourceFile);
    const sourceAvailable = fs.existsSync(sourcePath);
    await connection.query(
      `INSERT IGNORE INTO app_video_prompt_profiles
        (id,profile_key,display_name,public_description,visual_key,is_active,is_public,display_order,current_version_id,version,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,NULL,1,NOW(),NOW())`,
      [preset.id,preset.profileKey,preset.displayName,preset.publicDescription,preset.visualKey,Number(sourceAvailable),Number(sourceAvailable),preset.displayOrder]
    );
    const [profiles] = await connection.query('SELECT id,current_version_id FROM app_video_prompt_profiles WHERE profile_key=? LIMIT 1', [preset.profileKey]);
    const profile = profiles[0];
    if (!sourceAvailable || !profile || profile.current_version_id) continue;
    const baseSystemPrompt = fs.readFileSync(sourcePath, 'utf8');
    const checksum = profileChecksum({ baseSystemPrompt, executionTemplate: preset.executionTemplate, rulesManifest: preset.rulesManifest });
    await connection.query(
      `INSERT IGNORE INTO app_video_prompt_profile_versions
        (id,profile_id,version,base_system_prompt,execution_template,rules_manifest_json,checksum,created_by_admin_id,change_reason,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,NOW())`,
      [preset.versionId,profile.id,1,baseSystemPrompt,preset.executionTemplate,JSON.stringify(preset.rulesManifest),checksum,null,'seed from canonical repository prompt']
    );
    await connection.query('UPDATE app_video_prompt_profiles SET current_version_id=?,updated_at=NOW() WHERE id=? AND current_version_id IS NULL', [preset.versionId,profile.id]);
  }
}

async function applyGrokImageToVideoPinMigration(connection) {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/036_pin_grok_image_to_video.sql'), 'utf8');
  await connection.query(sql);
}

async function applyGrokImageToVideoOptionsMigration(connection) {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/037_grok_image_to_video_options.sql'), 'utf8');
  await connection.query(sql);
}

async function applyGrokTextToVideoMigration(connection) {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/047_grok_text_to_video.sql'), 'utf8');
  await connection.query(sql);
}

async function applyGrokTextToVideoOptionsMigration(connection) {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/048_grok_text_to_video_options.sql'), 'utf8');
  await connection.query(sql);
}

async function main() {
  const value = String(process.env.DATABASE_URL || '').trim();
  if (!value.startsWith('mysql://')) throw new Error('DATABASE_URL must point to local MySQL.');
  const url = new URL(value); const connection = await mysql.createConnection({ host:String(process.env.DATABASE_HOST || process.env.LOCAL_DATABASE_HOST || url.hostname).trim(),port:url.port||3306,user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),database:url.pathname.slice(1),multipleStatements:true });
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/026_video_generation.sql'), 'utf8');
  try {
    await connection.query(sql);
    await applyWorkerRepositoryMigration(connection);
    await applyResultStorageMigration(connection);
    await applyMetisKlingModelMigration(connection);
    await applyMetisKlingOperationMigration(connection);
    await applyProductionReadinessMigration(connection);
    await applyAiRoutingSchemaMigration(connection);
    await applyAiRoutingSeedMigration(connection);
    await applyVideoPromptProfilesMigration(connection);
    await applyGrokImageToVideoPinMigration(connection);
    await applyGrokImageToVideoOptionsMigration(connection);
    await applyGrokTextToVideoMigration(connection);
    await applyGrokTextToVideoOptionsMigration(connection);
    console.log('Video generation migrations 026 through 048 applied locally.');
  } finally { await connection.end(); }
}
if (require.main === module) {
  main().catch((error)=>{ console.error('Video generation migration failed:', error.message); process.exitCode=1; });
}

module.exports = {
  hasTable,
  applyWorkerRepositoryMigration,
  applyResultStorageMigration,
  applyMetisKlingModelMigration,
  applyMetisKlingOperationMigration,
  applyProductionReadinessMigration,
  applyAiRoutingSchemaMigration,
  applyAiRoutingSeedMigration,
  applyVideoPromptProfilesMigration,
  applyGrokImageToVideoPinMigration,
  applyGrokTextToVideoMigration,
  applyGrokTextToVideoOptionsMigration,
  main
};
