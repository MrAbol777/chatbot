-- Immutable per-scene work records for AnimationProject orchestration.
ALTER TABLE animation_video_jobs
  ADD COLUMN worker_lease_owner VARCHAR(191) NULL,
  ADD COLUMN worker_lease_until DATETIME NULL,
  ADD COLUMN final_storage_key VARCHAR(512) NULL,
  ADD COLUMN safe_error_code VARCHAR(100) NULL,
  ADD COLUMN safe_error_message VARCHAR(500) NULL;

CREATE TABLE IF NOT EXISTS animation_video_scenes (
  animation_scene_job_id VARCHAR(80) PRIMARY KEY,
  animation_job_id VARCHAR(64) NOT NULL,
  source_scene_id VARCHAR(80) NOT NULL,
  scene_order INT NOT NULL,
  status VARCHAR(32) NOT NULL,
  duration_seconds INT NOT NULL,
  storyboard_image_job_id VARCHAR(80) NULL,
  video_generation_id VARCHAR(64) NULL,
  output_storage_key VARCHAR(512) NULL,
  safe_error_code VARCHAR(100) NULL,
  safe_error_message VARCHAR(500) NULL,
  retry_count INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_animation_video_scene (animation_job_id, source_scene_id),
  INDEX idx_animation_video_scenes_status (animation_job_id, status, scene_order),
  CONSTRAINT fk_animation_video_scenes_job FOREIGN KEY (animation_job_id)
    REFERENCES animation_video_jobs(animation_job_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
