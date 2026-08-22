CREATE TABLE IF NOT EXISTS app_image_to_image_jobs (
  id CHAR(36) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  status ENUM('queued','submitted','succeeded','failed') NOT NULL DEFAULT 'queued',
  provider VARCHAR(32) NOT NULL,
  model VARCHAR(100) NOT NULL,
  prompt TEXT NOT NULL,
  aspect_ratio VARCHAR(16) NOT NULL,
  sources JSON NOT NULL,
  idempotency_key_hash CHAR(64) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  noa_reservation_id CHAR(36) NOT NULL,
  provider_task_id VARCHAR(191) NULL,
  poll_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  next_poll_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  worker_lease_owner VARCHAR(191) NULL,
  worker_lease_until DATETIME NULL,
  result_storage_key VARCHAR(255) NULL,
  result_mime_type VARCHAR(64) NULL,
  result_size_bytes BIGINT UNSIGNED NULL,
  safe_error_code VARCHAR(100) NULL,
  safe_error_message VARCHAR(500) NULL,
  submitted_at DATETIME NULL,
  completed_at DATETIME NULL,
  failed_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_image_to_image_idempotency (user_id, idempotency_key_hash),
  INDEX idx_image_to_image_due (status, next_poll_at, worker_lease_until),
  INDEX idx_image_to_image_user_created (user_id, created_at),
  CONSTRAINT fk_image_to_image_user FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE RESTRICT,
  CONSTRAINT fk_image_to_image_reservation FOREIGN KEY (noa_reservation_id) REFERENCES app_noa_reservations(reservation_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO app_noa_pricing_configs
  (action_key, unit, unit_price, is_active, version, created_at, updated_at)
VALUES ('image_to_image', 'image', '1.700000', 1, 1, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6));
