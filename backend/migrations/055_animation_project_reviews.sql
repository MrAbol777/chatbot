-- Phase 2 keeps the existing project rows and queue contracts intact.
-- Review status needs to grow without changing earlier enum values.
ALTER TABLE animation_projects
  MODIFY status VARCHAR(32) NOT NULL DEFAULT 'draft';

CREATE TABLE IF NOT EXISTS animation_video_jobs (
  animation_job_id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  generation_id VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL,
  payload JSON NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_animation_video_jobs_project (project_id, updated_at),
  INDEX idx_animation_video_jobs_generation (generation_id),
  CONSTRAINT fk_animation_video_jobs_project FOREIGN KEY (project_id)
    REFERENCES animation_projects(project_id) ON DELETE CASCADE,
  CONSTRAINT fk_animation_video_jobs_user FOREIGN KEY (user_id)
    REFERENCES app_users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
