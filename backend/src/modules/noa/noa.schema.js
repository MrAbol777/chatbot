'use strict';

const NOA_CORE_DDL = Object.freeze([
  `
    CREATE TABLE IF NOT EXISTS app_noa_pricing_configs (
      action_key VARCHAR(64) PRIMARY KEY,
      unit ENUM('message','image','second') NOT NULL,
      unit_price DECIMAL(24,6) NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      version BIGINT UNSIGNED NOT NULL DEFAULT 1,
      updated_by_admin_id VARCHAR(191) NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      CONSTRAINT chk_noa_pricing_price CHECK (unit_price > 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
    CREATE TABLE IF NOT EXISTS app_noa_settings (
      setting_key VARCHAR(64) PRIMARY KEY,
      decimal_value DECIMAL(24,6) NOT NULL,
      fiat_currency VARCHAR(8) NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      version BIGINT UNSIGNED NOT NULL DEFAULT 1,
      updated_by_admin_id VARCHAR(191) NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      CONSTRAINT chk_noa_setting_value CHECK (decimal_value > 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
    CREATE TABLE IF NOT EXISTS app_noa_bank_transfer_accounts (
      account_id TINYINT UNSIGNED PRIMARY KEY,
      card_number CHAR(16) NOT NULL,
      card_holder_name VARCHAR(191) NOT NULL,
      version BIGINT UNSIGNED NOT NULL DEFAULT 1,
      updated_by_admin_id VARCHAR(191) NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      CONSTRAINT chk_noa_bank_transfer_account_id CHECK (account_id = 1),
      CONSTRAINT chk_noa_bank_transfer_card_number CHECK (card_number REGEXP '^[0-9]{16}$')
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
    CREATE TABLE IF NOT EXISTS app_noa_wallets (
      wallet_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      available_balance DECIMAL(24,6) NOT NULL DEFAULT 0,
      reserved_balance DECIMAL(24,6) NOT NULL DEFAULT 0,
      version BIGINT UNSIGNED NOT NULL DEFAULT 0,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      UNIQUE KEY uq_noa_wallet_user (user_id),
      CONSTRAINT fk_noa_wallet_user
        FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE RESTRICT,
      CONSTRAINT chk_noa_wallet_reserved CHECK (reserved_balance >= 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
    CREATE TABLE IF NOT EXISTS app_noa_reservations (
      reservation_id CHAR(36) PRIMARY KEY,
      wallet_id BIGINT UNSIGNED NOT NULL,
      user_id VARCHAR(191) NOT NULL,
      action_key VARCHAR(64) NOT NULL,
      unit VARCHAR(32) NOT NULL,
      quantity DECIMAL(20,6) NOT NULL,
      unit_price_snapshot DECIMAL(24,6) NOT NULL,
      pricing_version BIGINT UNSIGNED NOT NULL,
      amount DECIMAL(24,6) NOT NULL,
      idempotency_key_hash BINARY(32) NOT NULL,
      payload_hash BINARY(32) NOT NULL,
      reference_type VARCHAR(64) NOT NULL,
      reference_id VARCHAR(191) NOT NULL,
      status ENUM('reserved','captured','released') NOT NULL DEFAULT 'reserved',
      expires_at DATETIME(6) NULL,
      captured_at DATETIME(6) NULL,
      released_at DATETIME(6) NULL,
      release_reason VARCHAR(191) NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      UNIQUE KEY uq_noa_reservation_idempotency (wallet_id, idempotency_key_hash),
      UNIQUE KEY uq_noa_reservation_reference (wallet_id, reference_type, reference_id),
      INDEX idx_noa_reservation_status_expiry (status, expires_at),
      INDEX idx_noa_reservation_user_created (user_id, created_at),
      CONSTRAINT fk_noa_reservation_wallet
        FOREIGN KEY (wallet_id) REFERENCES app_noa_wallets(wallet_id) ON DELETE RESTRICT,
      CONSTRAINT fk_noa_reservation_pricing
        FOREIGN KEY (action_key) REFERENCES app_noa_pricing_configs(action_key) ON DELETE RESTRICT,
      CONSTRAINT chk_noa_reservation_quantity CHECK (quantity > 0),
      CONSTRAINT chk_noa_reservation_unit_price CHECK (unit_price_snapshot > 0),
      CONSTRAINT chk_noa_reservation_amount CHECK (amount > 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
    CREATE TABLE IF NOT EXISTS app_noa_transaction_logs (
      transaction_id CHAR(36) PRIMARY KEY,
      wallet_id BIGINT UNSIGNED NOT NULL,
      reservation_id CHAR(36) NULL,
      entry_type VARCHAR(32) NOT NULL,
      amount DECIMAL(24,6) NOT NULL,
      available_delta DECIMAL(24,6) NOT NULL,
      reserved_delta DECIMAL(24,6) NOT NULL,
      available_before DECIMAL(24,6) NOT NULL,
      available_after DECIMAL(24,6) NOT NULL,
      reserved_before DECIMAL(24,6) NOT NULL,
      reserved_after DECIMAL(24,6) NOT NULL,
      action_key VARCHAR(64) NULL,
      reference_type VARCHAR(64) NOT NULL,
      reference_id VARCHAR(191) NOT NULL,
      idempotency_key_hash BINARY(32) NOT NULL,
      payload_hash BINARY(32) NOT NULL,
      actor_type ENUM('user','admin','system','gateway') NOT NULL,
      actor_id VARCHAR(191) NULL,
      metadata JSON NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      UNIQUE KEY uq_noa_log_idempotency (wallet_id, idempotency_key_hash, entry_type),
      UNIQUE KEY uq_noa_log_reservation_entry (reservation_id, entry_type),
      INDEX idx_noa_log_wallet_created (wallet_id, created_at, transaction_id),
      INDEX idx_noa_log_reference (reference_type, reference_id),
      CONSTRAINT fk_noa_log_wallet
        FOREIGN KEY (wallet_id) REFERENCES app_noa_wallets(wallet_id) ON DELETE RESTRICT,
      CONSTRAINT fk_noa_log_reservation
        FOREIGN KEY (reservation_id) REFERENCES app_noa_reservations(reservation_id) ON DELETE RESTRICT,
      CONSTRAINT chk_noa_log_amount CHECK (amount > 0),
      CONSTRAINT chk_noa_log_reserved_balances CHECK (
        reserved_before >= 0 AND reserved_after >= 0
      )
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
    CREATE TABLE IF NOT EXISTS app_noa_user_notifications (
      notification_id CHAR(36) PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      transaction_id CHAR(36) NOT NULL,
      message VARCHAR(500) NOT NULL,
      delivered_at DATETIME(6) NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      INDEX idx_noa_user_notification_pending (user_id, delivered_at, created_at),
      CONSTRAINT fk_noa_user_notification_user
        FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE RESTRICT,
      CONSTRAINT fk_noa_user_notification_transaction
        FOREIGN KEY (transaction_id) REFERENCES app_noa_transaction_logs(transaction_id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
    CREATE TABLE IF NOT EXISTS app_noa_receipts (
      receipt_id CHAR(36) PRIMARY KEY,
      wallet_id BIGINT UNSIGNED NOT NULL,
      user_id VARCHAR(191) NOT NULL,
      transfer_reference VARCHAR(191) NOT NULL,
      transfer_reference_hash BINARY(32) NOT NULL,
      declared_toman DECIMAL(24,2) NULL,
      verified_toman DECIMAL(24,2) NULL,
      exchange_rate_snapshot DECIMAL(24,6) NULL,
      calculated_noa DECIMAL(24,6) NULL,
      approved_noa DECIMAL(24,6) NULL,
      manual_override TINYINT(1) NOT NULL DEFAULT 0,
      override_reason VARCHAR(500) NULL,
      status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
      storage_key VARCHAR(255) NOT NULL,
      original_file_name VARCHAR(255) NULL,
      mime_type VARCHAR(64) NOT NULL,
      size_bytes BIGINT UNSIGNED NOT NULL,
      file_sha256 BINARY(32) NOT NULL,
      submit_idempotency_hash BINARY(32) NOT NULL,
      submit_payload_hash BINARY(32) NOT NULL,
      reviewed_by_admin_id VARCHAR(191) NULL,
      review_reason VARCHAR(500) NULL,
      approval_transaction_id CHAR(36) NULL,
      submitted_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      reviewed_at DATETIME(6) NULL,
      updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      UNIQUE KEY uq_noa_receipt_transfer_reference (transfer_reference_hash),
      UNIQUE KEY uq_noa_receipt_submit_idempotency (wallet_id, submit_idempotency_hash),
      UNIQUE KEY uq_noa_receipt_approval_transaction (approval_transaction_id),
      INDEX idx_noa_receipt_status_submitted (status, submitted_at, receipt_id),
      INDEX idx_noa_receipt_user_submitted (user_id, submitted_at, receipt_id),
      INDEX idx_noa_receipt_file_hash (file_sha256),
      CONSTRAINT fk_noa_receipt_wallet
        FOREIGN KEY (wallet_id) REFERENCES app_noa_wallets(wallet_id) ON DELETE RESTRICT,
      CONSTRAINT fk_noa_receipt_user
        FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE RESTRICT,
      CONSTRAINT fk_noa_receipt_approval_transaction
        FOREIGN KEY (approval_transaction_id) REFERENCES app_noa_transaction_logs(transaction_id) ON DELETE RESTRICT,
      CONSTRAINT chk_noa_receipt_verified_toman CHECK (verified_toman IS NULL OR verified_toman > 0),
      CONSTRAINT chk_noa_receipt_approved_noa CHECK (approved_noa IS NULL OR approved_noa > 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,
  `
    CREATE TABLE IF NOT EXISTS app_noa_legacy_subscriptions_archive (
      archive_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      source_hash BINARY(32) NOT NULL,
      user_id VARCHAR(191) NOT NULL,
      plan_id VARCHAR(64) NULL,
      original_status VARCHAR(32) NULL,
      assigned_at DATETIME(6) NULL,
      expires_at DATETIME(6) NULL,
      source_payload JSON NOT NULL,
      migration_status ENUM('gifted','already_gifted','skipped_missing_user','skipped_inactive') NOT NULL,
      gift_transaction_id CHAR(36) NULL,
      archived_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      UNIQUE KEY uq_noa_legacy_subscription_source (source_hash),
      INDEX idx_noa_legacy_subscription_user (user_id, archived_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `
]);

const NOA_SEED_DML = Object.freeze([
  `
    INSERT IGNORE INTO app_noa_pricing_configs
      (action_key, unit, unit_price, is_active, version, created_at, updated_at)
    VALUES ('text_chat', 'message', '0.120000', 1, 1, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6))
  `,
  `
    INSERT IGNORE INTO app_noa_pricing_configs
      (action_key, unit, unit_price, is_active, version, created_at, updated_at)
    VALUES ('image_understanding', 'image', '0.120000', 1, 1, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6))
  `,
  `
    INSERT IGNORE INTO app_noa_pricing_configs
      (action_key, unit, unit_price, is_active, version, created_at, updated_at)
    VALUES ('image_generation', 'image', '1.700000', 1, 1, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6))
  `,
  `
    INSERT IGNORE INTO app_noa_pricing_configs
      (action_key, unit, unit_price, is_active, version, created_at, updated_at)
    VALUES ('video_generation', 'second', '0.800000', 1, 1, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6))
  `,
  `
    INSERT IGNORE INTO app_noa_settings
      (setting_key, decimal_value, fiat_currency, is_active, version, created_at, updated_at)
    VALUES ('toman_per_noa', '10000.000000', 'TOMAN', 1, 1, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6))
  `
]);

async function tableExists(db, tableName) {
  const [rows] = await db.query(
    `SELECT 1
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      LIMIT 1`,
    [tableName]
  );
  return rows.length > 0;
}

async function columnInfo(db, tableName, columnName) {
  const [rows] = await db.query(
    `SELECT COLUMN_NAME, IS_NULLABLE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
      LIMIT 1`,
    [tableName, columnName]
  );
  return rows[0] || null;
}

async function indexExists(db, tableName, indexName) {
  const [rows] = await db.query(
    `SELECT 1
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
      LIMIT 1`,
    [tableName, indexName]
  );
  return rows.length > 0;
}

async function ensureIntegrationColumn(db, tableName, definition) {
  if (!(await tableExists(db, tableName))) return;
  const column = await columnInfo(db, tableName, 'noa_reservation_id');
  if (!column) {
    await db.query(`ALTER TABLE \`${tableName}\` ADD COLUMN noa_reservation_id CHAR(36) NULL`);
  }
  const indexName = `idx_${tableName}_noa_reservation`;
  if (!(await indexExists(db, tableName, indexName))) {
    await db.query(`ALTER TABLE \`${tableName}\` ADD INDEX \`${indexName}\` (noa_reservation_id)`);
  }
  if (definition) await definition();
}

async function ensureImageOnlyReceiptSubmission(db) {
  if (!(await tableExists(db, 'app_noa_receipts'))) return;

  const [constraints] = await db.query(
    `SELECT CONSTRAINT_NAME
       FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'app_noa_receipts'
        AND CONSTRAINT_NAME = 'chk_noa_receipt_declared_toman'
      LIMIT 1`
  );
  if (constraints.length > 0) {
    await db.query(
      'ALTER TABLE app_noa_receipts DROP CONSTRAINT chk_noa_receipt_declared_toman'
    );
  }

  const declaredToman = await columnInfo(
    db,
    'app_noa_receipts',
    'declared_toman'
  );
  if (declaredToman && String(declaredToman.IS_NULLABLE).toUpperCase() !== 'YES') {
    await db.query(
      'ALTER TABLE app_noa_receipts MODIFY COLUMN declared_toman DECIMAL(24,2) NULL'
    );
  }
}

async function constraintExists(db, tableName, constraintName) {
  const [rows] = await db.query(
    `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? LIMIT 1`,
    [tableName, constraintName]
  );
  return rows.length > 0;
}

async function ensureNegativeAdminBalances(db) {
  if (await constraintExists(db, 'app_noa_wallets', 'chk_noa_wallet_available')) {
    await db.query('ALTER TABLE app_noa_wallets DROP CONSTRAINT chk_noa_wallet_available');
  }
  if (await constraintExists(db, 'app_noa_transaction_logs', 'chk_noa_log_balances')) {
    await db.query('ALTER TABLE app_noa_transaction_logs DROP CONSTRAINT chk_noa_log_balances');
  }
  if (!(await constraintExists(db, 'app_noa_transaction_logs', 'chk_noa_log_reserved_balances'))) {
    await db.query(
      'ALTER TABLE app_noa_transaction_logs ADD CONSTRAINT chk_noa_log_reserved_balances CHECK (reserved_before >= 0 AND reserved_after >= 0)'
    );
  }
}

const LEGACY_RUNTIME_TABLES = Object.freeze([
  'app_plans',
  'app_plan_daily_usage',
  'app_plan_hourly_usage',
  'app_video_usage'
]);

async function archiveLegacyRuntimeTables(db) {
  for (const sourceTable of LEGACY_RUNTIME_TABLES) {
    if (!(await tableExists(db, sourceTable))) continue;
    const archiveTable = `app_noa_legacy_${sourceTable.replace(/^app_/, '')}_archive`;
    await db.query(`CREATE TABLE IF NOT EXISTS \`${archiveTable}\` LIKE \`${sourceTable}\``);
    await db.query(`INSERT IGNORE INTO \`${archiveTable}\` SELECT * FROM \`${sourceTable}\``);
  }
}

async function ensureNoaSchema(db) {
  for (const statement of NOA_CORE_DDL) {
    await db.query(statement);
  }
  for (const statement of NOA_SEED_DML) {
    await db.query(statement);
  }
  await ensureImageOnlyReceiptSubmission(db);
  await ensureNegativeAdminBalances(db);

  await ensureIntegrationColumn(db, 'app_chat_turns');
  await ensureIntegrationColumn(db, 'image_generations');
  await ensureIntegrationColumn(db, 'app_video_generations');
}

module.exports = {
  LEGACY_RUNTIME_TABLES,
  NOA_CORE_DDL,
  NOA_SEED_DML,
  archiveLegacyRuntimeTables,
  ensureImageOnlyReceiptSubmission,
  ensureNegativeAdminBalances,
  ensureNoaSchema
};
