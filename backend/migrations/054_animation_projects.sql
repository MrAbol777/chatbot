CREATE TABLE IF NOT EXISTS animation_projects (
  project_id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  title VARCHAR(191) NOT NULL,
  idea MEDIUMTEXT NOT NULL,
  stage ENUM('idea','questions','summary','scenario','characters','storyboard','video','completed','error') NOT NULL DEFAULT 'idea',
  status ENUM('draft','active','pending','processing','completed','failed','cancelled') NOT NULL DEFAULT 'draft',
  project JSON NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_animation_projects_user_updated (user_id, updated_at),
  INDEX idx_animation_projects_user_stage (user_id, stage),
  CONSTRAINT fk_animation_projects_user FOREIGN KEY (user_id)
    REFERENCES app_users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
