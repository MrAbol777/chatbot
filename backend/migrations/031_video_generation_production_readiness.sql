-- Additive Production-readiness metadata.  The migration runner guards each
-- statement, so this file is documentation-safe as well as MariaDB-compatible.
ALTER TABLE app_video_quota_reservations
  ADD COLUMN expires_at DATETIME NULL AFTER released_at;

ALTER TABLE app_video_generations
  ADD COLUMN recovery_started_at DATETIME NULL AFTER failed_at,
  ADD COLUMN recovery_completed_at DATETIME NULL AFTER recovery_started_at;
