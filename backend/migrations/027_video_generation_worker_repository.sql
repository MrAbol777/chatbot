-- Additive, local-only migration for transactional video polling repositories.
-- The local migration runner checks existing columns and indexes before executing
-- these statements so rerunning it is safe on an already migrated database.

ALTER TABLE app_video_generations
  MODIFY COLUMN status ENUM('queued','submitting','submitted','processing','succeeded','failed','cancelled','expired') NOT NULL;

ALTER TABLE app_video_generations
  ADD COLUMN worker_lease_owner VARCHAR(191) NULL AFTER worker_lease_until;

ALTER TABLE app_video_generations
  ADD COLUMN last_polled_at DATETIME NULL AFTER next_poll_at;

ALTER TABLE app_video_generations
  ADD COLUMN cancelled_at DATETIME NULL AFTER failed_at;

ALTER TABLE app_video_generations
  ADD COLUMN expired_at DATETIME NULL AFTER cancelled_at;

ALTER TABLE app_video_generations
  ADD INDEX idx_video_generations_status_poll_lease (status, next_poll_at, worker_lease_until);

ALTER TABLE app_video_generations
  ADD INDEX idx_video_generations_quota_reservation (quota_reservation_id);

ALTER TABLE app_video_quota_reservations
  MODIFY COLUMN status ENUM('reserved','finalized','released','expired') NOT NULL DEFAULT 'reserved';

ALTER TABLE app_video_quota_reservations
  ADD COLUMN finalized_at DATETIME NULL AFTER updated_at;

ALTER TABLE app_video_quota_reservations
  ADD COLUMN released_at DATETIME NULL AFTER finalized_at;

ALTER TABLE app_video_quota_reservations
  ADD COLUMN expired_at DATETIME NULL AFTER released_at;

ALTER TABLE app_video_quota_reservations
  ADD COLUMN release_reason VARCHAR(100) NULL AFTER expired_at;
