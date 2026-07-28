CREATE TABLE IF NOT EXISTS app_video_input_media (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  storage_key VARCHAR(255) NOT NULL,
  original_filename VARCHAR(255) NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes BIGINT NOT NULL,
  sha256 CHAR(64) NOT NULL,
  status ENUM('ready','bound','deleted','expired') NOT NULL DEFAULT 'ready',
  bound_generation_id VARCHAR(64) NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_video_input_storage_key (storage_key),
  UNIQUE KEY uq_video_input_bound_generation (bound_generation_id),
  INDEX idx_video_input_owner_created (user_id, created_at),
  INDEX idx_video_input_status_expiry (status, expires_at),
  CONSTRAINT fk_video_input_user FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_video_input_generation FOREIGN KEY (bound_generation_id) REFERENCES app_video_generations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

