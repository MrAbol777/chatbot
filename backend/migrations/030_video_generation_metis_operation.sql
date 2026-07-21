-- Additive local schema change for the verified Metis contract.
-- apply-video-generation-migration.js performs the guarded/idempotent form so
-- it is safe to run repeatedly on existing local databases.
ALTER TABLE app_video_models ADD COLUMN upstream_operation VARCHAR(128) NULL AFTER provider_model_id;
ALTER TABLE app_video_generations ADD COLUMN negative_prompt TEXT NULL AFTER prompt;
ALTER TABLE app_video_generations MODIFY COLUMN quota_reservation_id VARCHAR(64) NULL;
