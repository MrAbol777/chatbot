-- Additive, local-only result storage state.  Do not edit migrations 026/027.
ALTER TABLE app_video_generations
  MODIFY COLUMN status ENUM('queued','submitting','submitted','processing','storing','succeeded','failed','cancelled','expired') NOT NULL;

ALTER TABLE app_video_generations
  ADD COLUMN result_storage_status ENUM('pending','stored','failed') NULL AFTER result_size_bytes,
  ADD COLUMN result_sha256 CHAR(64) NULL AFTER result_storage_status,
  ADD COLUMN result_original_filename VARCHAR(255) NULL AFTER result_sha256,
  ADD COLUMN result_stored_at DATETIME NULL AFTER result_original_filename,
  ADD COLUMN storage_attempts INT NOT NULL DEFAULT 0 AFTER poll_attempts,
  ADD COLUMN next_storage_attempt_at DATETIME NULL AFTER storage_attempts,
  ADD COLUMN storage_safe_error_code VARCHAR(100) NULL AFTER safe_error_message,
  ADD COLUMN storage_safe_error_message VARCHAR(500) NULL AFTER storage_safe_error_code,
  ADD INDEX idx_video_generations_status_storage_attempt (status, next_storage_attempt_at),
  ADD INDEX idx_video_generations_result_storage_status (result_storage_status),
  ADD UNIQUE INDEX uq_video_generations_result_storage_key (result_storage_key);
