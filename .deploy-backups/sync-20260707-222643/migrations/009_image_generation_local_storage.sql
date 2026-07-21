ALTER TABLE image_generations
  ADD COLUMN IF NOT EXISTS local_file_path TEXT NULL AFTER image_url,
  ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100) NULL AFTER local_file_path,
  ADD COLUMN IF NOT EXISTS file_size BIGINT NULL AFTER mime_type,
  ADD COLUMN IF NOT EXISTS provider VARCHAR(64) NULL AFTER file_size,
  ADD COLUMN IF NOT EXISTS model_admin_value VARCHAR(191) NULL AFTER provider,
  ADD COLUMN IF NOT EXISTS model_runtime_value VARCHAR(191) NULL AFTER model_admin_value,
  ADD COLUMN IF NOT EXISTS remote_url_host VARCHAR(255) NULL AFTER model_runtime_value,
  ADD COLUMN IF NOT EXISTS metadata JSON NULL AFTER remote_url_host;
