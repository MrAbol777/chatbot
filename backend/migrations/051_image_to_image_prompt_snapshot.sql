-- Runtime prompt snapshot for image-to-image jobs.
-- Existing deployments should run backend/scripts/apply-image-to-image-migration.js,
-- which performs these additions idempotently and backfills legacy jobs.
ALTER TABLE app_image_to_image_jobs ADD COLUMN user_prompt TEXT NULL AFTER prompt;
ALTER TABLE app_image_to_image_jobs ADD COLUMN compiled_prompt MEDIUMTEXT NULL AFTER user_prompt;
ALTER TABLE app_image_to_image_jobs ADD COLUMN compiled_prompt_hash CHAR(64) NULL AFTER compiled_prompt;
ALTER TABLE app_image_to_image_jobs ADD COLUMN prompt_compiler_version VARCHAR(64) NULL AFTER compiled_prompt_hash;
ALTER TABLE app_image_to_image_jobs ADD COLUMN prompt_snapshot JSON NULL AFTER prompt_compiler_version;
