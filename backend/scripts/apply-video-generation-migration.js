const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { VIDEO_MODEL_REGISTRATIONS } = require('../src/modules/video-generation/video-model.registry');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function hasColumn(connection, table, column) {
  const [rows] = await connection.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [column]);
  return rows.length > 0;
}

async function hasIndex(connection, table, index) {
  const [rows] = await connection.query(`SHOW INDEX FROM \`${table}\` WHERE Key_name=?`, [index]);
  return rows.length > 0;
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

async function applyWorkerRepositoryMigration(connection) {
  await connection.query("ALTER TABLE app_video_generations MODIFY COLUMN status ENUM('queued','submitting','submitted','processing','succeeded','failed','cancelled','expired') NOT NULL");
  await ensureColumn(connection, 'app_video_generations', 'worker_lease_owner', 'VARCHAR(191) NULL AFTER worker_lease_until');
  await ensureColumn(connection, 'app_video_generations', 'last_polled_at', 'DATETIME NULL AFTER next_poll_at');
  await ensureColumn(connection, 'app_video_generations', 'cancelled_at', 'DATETIME NULL AFTER failed_at');
  await ensureColumn(connection, 'app_video_generations', 'expired_at', 'DATETIME NULL AFTER cancelled_at');
  await ensureIndex(connection, 'app_video_generations', 'idx_video_generations_status_poll_lease', '`status`, `next_poll_at`, `worker_lease_until`');
  await ensureIndex(connection, 'app_video_generations', 'idx_video_generations_quota_reservation', '`quota_reservation_id`');
  await connection.query("ALTER TABLE app_video_quota_reservations MODIFY COLUMN status ENUM('reserved','finalized','released','expired') NOT NULL DEFAULT 'reserved'");
  await ensureColumn(connection, 'app_video_quota_reservations', 'finalized_at', 'DATETIME NULL AFTER updated_at');
  await ensureColumn(connection, 'app_video_quota_reservations', 'released_at', 'DATETIME NULL AFTER finalized_at');
  await ensureColumn(connection, 'app_video_quota_reservations', 'expired_at', 'DATETIME NULL AFTER released_at');
  await ensureColumn(connection, 'app_video_quota_reservations', 'release_reason', 'VARCHAR(100) NULL AFTER expired_at');
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
  for (const model of VIDEO_MODEL_REGISTRATIONS) {
    await connection.query(sql, [
      model.internalKey, model.provider, model.upstreamVendor, model.providerModelId,
      model.displayNameFa, model.displayName, model.descriptionFa, Number(model.isActive),
      Number(model.supportsTextToVideo), Number(model.supportsImageToVideo),
      Number(model.upstreamSupportsImageToVideo), Number(model.upstreamSupportsStartImage),
      Number(model.supportsNegativePrompt), JSON.stringify(model.allowedAspectRatios),
      JSON.stringify(model.allowedDurations), JSON.stringify(model.allowedQualities),
      model.maxPromptLength, model.quotaUnits, model.sortOrder
    ]);
  }
}

async function applyMetisKlingOperationMigration(connection) {
  // These fields are needed to keep the verified provider contract in the
  // private registry, rather than accepting provider identifiers from clients.
  await ensureColumn(connection, 'app_video_models', 'upstream_operation', 'VARCHAR(128) NULL AFTER provider_model_id');
  await ensureColumn(connection, 'app_video_generations', 'negative_prompt', 'TEXT NULL AFTER prompt');
  await connection.query('ALTER TABLE app_video_generations MODIFY COLUMN quota_reservation_id VARCHAR(64) NULL');
  for (const model of VIDEO_MODEL_REGISTRATIONS) {
    await connection.query(
      'UPDATE app_video_models SET upstream_operation=?, is_active=0, supports_image_to_video=0, updated_at=NOW() WHERE internal_key=?',
      [model.upstreamOperation, model.internalKey]
    );
  }
}

async function applyProductionReadinessMigration(connection) {
  await ensureColumn(connection, 'app_video_quota_reservations', 'expires_at', 'DATETIME NULL AFTER released_at');
  await ensureColumn(connection, 'app_video_generations', 'recovery_started_at', 'DATETIME NULL AFTER failed_at');
  await ensureColumn(connection, 'app_video_generations', 'recovery_completed_at', 'DATETIME NULL AFTER recovery_started_at');
}

async function main() {
  const value = String(process.env.DATABASE_URL || '').trim();
  if (!value.startsWith('mysql://')) throw new Error('DATABASE_URL must point to local MySQL.');
  const url = new URL(value); const connection = await mysql.createConnection({ host:url.hostname,port:url.port||3306,user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),database:url.pathname.slice(1),multipleStatements:true });
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/026_video_generation.sql'), 'utf8');
  try {
    const [columns] = await connection.query("SHOW COLUMNS FROM app_plans LIKE 'video_limit'");
    if (!columns.length) await connection.query('ALTER TABLE app_plans ADD COLUMN video_limit INT NULL AFTER hourly_image_limit');
    await connection.query(sql);
    await applyWorkerRepositoryMigration(connection);
    await applyResultStorageMigration(connection);
    await applyMetisKlingModelMigration(connection);
    await applyMetisKlingOperationMigration(connection);
    await applyProductionReadinessMigration(connection);
    console.log('Video generation migrations 026 through 031 applied locally.');
  } finally { await connection.end(); }
}
if (require.main === module) {
  main().catch((error)=>{ console.error('Video generation migration failed:', error.message); process.exitCode=1; });
}

module.exports = { applyWorkerRepositoryMigration, applyResultStorageMigration, applyMetisKlingModelMigration, applyMetisKlingOperationMigration, applyProductionReadinessMigration, main };
