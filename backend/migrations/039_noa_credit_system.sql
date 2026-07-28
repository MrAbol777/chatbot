-- Noa credit system expand/cutover migration.
-- Runtime prices are seeded once with INSERT IGNORE and are never overwritten.

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS app_noa_wallets (
  wallet_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  available_balance DECIMAL(24,6) NOT NULL DEFAULT 0,
  reserved_balance DECIMAL(24,6) NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_noa_wallet_user (user_id),
  CONSTRAINT fk_noa_wallet_user FOREIGN KEY (user_id)
    REFERENCES app_users(user_id) ON DELETE RESTRICT,
  CONSTRAINT chk_noa_wallet_available CHECK (available_balance >= 0),
  CONSTRAINT chk_noa_wallet_reserved CHECK (reserved_balance >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
  CONSTRAINT fk_noa_reservation_wallet FOREIGN KEY (wallet_id)
    REFERENCES app_noa_wallets(wallet_id) ON DELETE RESTRICT,
  CONSTRAINT fk_noa_reservation_pricing FOREIGN KEY (action_key)
    REFERENCES app_noa_pricing_configs(action_key) ON DELETE RESTRICT,
  CONSTRAINT chk_noa_reservation_quantity CHECK (quantity > 0),
  CONSTRAINT chk_noa_reservation_unit_price CHECK (unit_price_snapshot > 0),
  CONSTRAINT chk_noa_reservation_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
  CONSTRAINT fk_noa_log_wallet FOREIGN KEY (wallet_id)
    REFERENCES app_noa_wallets(wallet_id) ON DELETE RESTRICT,
  CONSTRAINT fk_noa_log_reservation FOREIGN KEY (reservation_id)
    REFERENCES app_noa_reservations(reservation_id) ON DELETE RESTRICT,
  CONSTRAINT chk_noa_log_amount CHECK (amount > 0),
  CONSTRAINT chk_noa_log_balances CHECK (
    available_before >= 0 AND available_after >= 0
    AND reserved_before >= 0 AND reserved_after >= 0
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS app_noa_receipts (
  receipt_id CHAR(36) PRIMARY KEY,
  wallet_id BIGINT UNSIGNED NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  transfer_reference VARCHAR(191) NOT NULL,
  transfer_reference_hash BINARY(32) NOT NULL,
  declared_toman DECIMAL(24,2) NOT NULL,
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
  CONSTRAINT fk_noa_receipt_wallet FOREIGN KEY (wallet_id)
    REFERENCES app_noa_wallets(wallet_id) ON DELETE RESTRICT,
  CONSTRAINT fk_noa_receipt_user FOREIGN KEY (user_id)
    REFERENCES app_users(user_id) ON DELETE RESTRICT,
  CONSTRAINT fk_noa_receipt_approval_transaction FOREIGN KEY (approval_transaction_id)
    REFERENCES app_noa_transaction_logs(transaction_id) ON DELETE RESTRICT,
  CONSTRAINT chk_noa_receipt_declared_toman CHECK (declared_toman > 0),
  CONSTRAINT chk_noa_receipt_verified_toman CHECK (verified_toman IS NULL OR verified_toman > 0),
  CONSTRAINT chk_noa_receipt_approved_noa CHECK (approved_noa IS NULL OR approved_noa > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO app_noa_pricing_configs
  (action_key, unit, unit_price, is_active, version, created_at, updated_at)
VALUES
  ('text_chat', 'message', '0.120000', 1, 1, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6)),
  ('image_generation', 'image', '1.700000', 1, 1, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6)),
  ('video_generation', 'second', '0.800000', 1, 1, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6));

INSERT IGNORE INTO app_noa_settings
  (setting_key, decimal_value, fiat_currency, is_active, version, created_at, updated_at)
VALUES
  ('toman_per_noa', '10000.000000', 'TOMAN', 1, 1, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6));

ALTER TABLE app_chat_turns
  ADD COLUMN IF NOT EXISTS noa_reservation_id CHAR(36) NULL,
  ADD INDEX IF NOT EXISTS idx_app_chat_turns_noa_reservation (noa_reservation_id),
  MODIFY COLUMN quota_charged TINYINT(1) NULL DEFAULT NULL;

ALTER TABLE image_generations
  ADD COLUMN IF NOT EXISTS noa_reservation_id CHAR(36) NULL,
  ADD INDEX IF NOT EXISTS idx_image_generations_noa_reservation (noa_reservation_id);

ALTER TABLE app_video_generations
  ADD COLUMN IF NOT EXISTS noa_reservation_id CHAR(36) NULL,
  ADD INDEX IF NOT EXISTS idx_app_video_generations_noa_reservation (noa_reservation_id),
  MODIFY COLUMN quota_units INT NULL,
  MODIFY COLUMN quota_reservation_id VARCHAR(64) NULL;

-- One-time read-only-by-convention snapshots. Runtime code must not import these tables.
CREATE TABLE IF NOT EXISTS app_noa_legacy_plans_archive LIKE app_plans;
INSERT IGNORE INTO app_noa_legacy_plans_archive SELECT * FROM app_plans;

CREATE TABLE IF NOT EXISTS app_noa_legacy_plan_daily_usage_archive LIKE app_plan_daily_usage;
INSERT IGNORE INTO app_noa_legacy_plan_daily_usage_archive SELECT * FROM app_plan_daily_usage;

CREATE TABLE IF NOT EXISTS app_noa_legacy_plan_hourly_usage_archive LIKE app_plan_hourly_usage;
INSERT IGNORE INTO app_noa_legacy_plan_hourly_usage_archive SELECT * FROM app_plan_hourly_usage;

CREATE TABLE IF NOT EXISTS app_noa_legacy_video_usage_archive LIKE app_video_usage;
INSERT IGNORE INTO app_noa_legacy_video_usage_archive SELECT * FROM app_video_usage;

CREATE TABLE IF NOT EXISTS app_noa_legacy_video_quota_reservations_archive LIKE app_video_quota_reservations;
INSERT IGNORE INTO app_noa_legacy_video_quota_reservations_archive
SELECT * FROM app_video_quota_reservations;

CREATE TABLE IF NOT EXISTS app_noa_legacy_guest_message_counts_archive LIKE guest_message_counts;
INSERT IGNORE INTO app_noa_legacy_guest_message_counts_archive
SELECT * FROM guest_message_counts;
