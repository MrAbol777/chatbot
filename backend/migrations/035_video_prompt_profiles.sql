-- Additive, local-only Video Prompt Profiles schema.
-- Guarded job-column and foreign-key additions are performed by
-- scripts/apply-video-generation-migration.js so reruns remain idempotent.

CREATE TABLE IF NOT EXISTS app_video_prompt_profiles (
  id VARCHAR(64) PRIMARY KEY,
  profile_key VARCHAR(64) NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  public_description VARCHAR(500) NOT NULL,
  visual_key VARCHAR(64) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 0,
  is_public TINYINT(1) NOT NULL DEFAULT 0,
  display_order INT NOT NULL DEFAULT 999,
  current_version_id VARCHAR(64) NULL,
  version BIGINT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_video_prompt_profile_key (profile_key),
  INDEX idx_video_prompt_profiles_public_order (is_active, is_public, display_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS app_video_prompt_profile_versions (
  id VARCHAR(64) PRIMARY KEY,
  profile_id VARCHAR(64) NOT NULL,
  version INT NOT NULL,
  base_system_prompt MEDIUMTEXT NOT NULL,
  execution_template TEXT NOT NULL,
  rules_manifest_json JSON NOT NULL,
  checksum CHAR(64) NOT NULL,
  created_by_admin_id VARCHAR(191) NULL,
  change_reason VARCHAR(500) NOT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_video_prompt_profile_version (profile_id, version),
  INDEX idx_video_prompt_versions_profile_created (profile_id, created_at),
  INDEX idx_video_prompt_versions_checksum (checksum),
  CONSTRAINT fk_video_prompt_version_profile FOREIGN KEY (profile_id)
    REFERENCES app_video_prompt_profiles(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS app_video_prompt_profile_audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  profile_id VARCHAR(64) NOT NULL,
  profile_version_id VARCHAR(64) NULL,
  action VARCHAR(64) NOT NULL,
  changed_by VARCHAR(191) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  previous_metadata JSON NULL,
  new_metadata JSON NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_video_prompt_audit_profile_created (profile_id, created_at),
  CONSTRAINT fk_video_prompt_audit_profile FOREIGN KEY (profile_id)
    REFERENCES app_video_prompt_profiles(id) ON DELETE RESTRICT,
  CONSTRAINT fk_video_prompt_audit_version FOREIGN KEY (profile_version_id)
    REFERENCES app_video_prompt_profile_versions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

