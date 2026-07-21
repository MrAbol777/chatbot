ALTER TABLE app_conversations
  ADD COLUMN IF NOT EXISTS generated_title VARCHAR(255) NULL AFTER title,
  ADD COLUMN IF NOT EXISTS title_source ENUM('default','generated','manual') NOT NULL DEFAULT 'default' AFTER generated_title,
  ADD COLUMN IF NOT EXISTS title_generation_status ENUM('pending','generating','completed','fallback','failed') NULL DEFAULT NULL AFTER title_source,
  ADD COLUMN IF NOT EXISTS title_model VARCHAR(191) NULL AFTER title_generation_status,
  ADD COLUMN IF NOT EXISTS title_generator_version VARCHAR(32) NULL AFTER title_model,
  ADD COLUMN IF NOT EXISTS title_generation_latency_ms INT NULL AFTER title_generator_version,
  ADD COLUMN IF NOT EXISTS title_generated_at DATETIME NULL AFTER title_generation_latency_ms,
  ADD COLUMN IF NOT EXISTS title_manually_updated_at DATETIME NULL AFTER title_generated_at;

ALTER TABLE app_conversations
  ADD INDEX IF NOT EXISTS idx_app_conversations_title_generation (title_generation_status, updated_at),
  ADD INDEX IF NOT EXISTS idx_app_conversations_title_source (title_source, updated_at);
