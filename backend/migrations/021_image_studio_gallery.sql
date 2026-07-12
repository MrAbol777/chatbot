-- Additive Image Studio metadata; existing generations remain visible.
ALTER TABLE image_generations
  ADD COLUMN IF NOT EXISTS original_prompt TEXT NULL AFTER prompt,
  ADD COLUMN IF NOT EXISTS refined_prompt TEXT NULL AFTER original_prompt,
  ADD COLUMN IF NOT EXISTS aspect_ratio VARCHAR(16) NOT NULL DEFAULT '1:1' AFTER refined_prompt,
  ADD COLUMN IF NOT EXISTS operation ENUM('generate', 'edit') NOT NULL DEFAULT 'generate' AFTER aspect_ratio,
  ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(191) NULL AFTER operation,
  ADD COLUMN IF NOT EXISTS parent_image_id BIGINT NULL AFTER conversation_id,
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(191) NULL AFTER parent_image_id,
  ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL AFTER updated_at;

CREATE INDEX IF NOT EXISTS idx_image_generations_owner_created ON image_generations (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_image_generations_owner_deleted_status ON image_generations (user_id, deleted_at, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_image_generations_owner_idempotency ON image_generations (user_id, idempotency_key);
