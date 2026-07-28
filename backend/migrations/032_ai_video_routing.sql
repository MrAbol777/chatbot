-- Additive AI routing core for Video. Guarded ALTER statements are applied by
-- scripts/apply-video-generation-migration.js; old migrations are untouched.
CREATE TABLE IF NOT EXISTS app_ai_providers (
  provider_key VARCHAR(32) PRIMARY KEY,
  display_name VARCHAR(191) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  version BIGINT NOT NULL DEFAULT 1,
  base_url VARCHAR(500) NOT NULL,
  api_key_env_name VARCHAR(100) NOT NULL,
  max_concurrency INT NULL,
  daily_cost_limit DECIMAL(20,6) NULL,
  config_json JSON NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS app_ai_capability_routes (
  route_id VARCHAR(64) PRIMARY KEY,
  capability_key VARCHAR(100) NOT NULL,
  primary_provider_key VARCHAR(32) NULL,
  primary_model_key VARCHAR(64) NULL,
  fallback_provider_key VARCHAR(32) NULL,
  fallback_model_key VARCHAR(64) NULL,
  routing_policy ENUM('PRIMARY_ONLY','AUTO_FALLBACK','FALLBACK_ONLY') NOT NULL DEFAULT 'PRIMARY_ONLY',
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  version BIGINT NOT NULL DEFAULT 1,
  max_concurrency INT NULL,
  daily_cost_limit DECIMAL(20,6) NULL,
  config_json JSON NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_ai_capability_route (capability_key),
  INDEX idx_ai_routes_enabled (enabled),
  CONSTRAINT fk_ai_route_primary_provider FOREIGN KEY (primary_provider_key) REFERENCES app_ai_providers(provider_key),
  CONSTRAINT fk_ai_route_fallback_provider FOREIGN KEY (fallback_provider_key) REFERENCES app_ai_providers(provider_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS app_ai_route_audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  route_id VARCHAR(64) NOT NULL,
  capability_key VARCHAR(100) NOT NULL,
  previous_configuration JSON NULL,
  new_configuration JSON NOT NULL,
  changed_by VARCHAR(191) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_ai_route_audit_capability_created (capability_key, created_at),
  CONSTRAINT fk_ai_route_audit_route FOREIGN KEY (route_id) REFERENCES app_ai_capability_routes(route_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS app_ai_provider_attempts (
  attempt_id VARCHAR(64) PRIMARY KEY,
  internal_request_id VARCHAR(64) NOT NULL,
  job_id VARCHAR(64) NOT NULL,
  capability_key VARCHAR(100) NOT NULL,
  route_id VARCHAR(64) NULL,
  route_version BIGINT NULL,
  provider_key VARCHAR(32) NOT NULL,
  provider_model_id VARCHAR(191) NOT NULL,
  internal_model_key VARCHAR(64) NOT NULL,
  attempt_number INT NOT NULL,
  provider_task_id VARCHAR(191) NULL,
  state ENUM('planned','submitting','accepted','processing','completed','rejected','failed','ambiguous','cancelled') NOT NULL DEFAULT 'planned',
  submit_started_at DATETIME NULL,
  submit_finished_at DATETIME NULL,
  last_polled_at DATETIME NULL,
  completed_at DATETIME NULL,
  estimated_cost DECIMAL(20,6) NULL,
  actual_cost DECIMAL(20,6) NULL,
  credit_used DECIMAL(20,6) NULL,
  cost_currency VARCHAR(16) NULL,
  cost_unit VARCHAR(32) NULL,
  safe_cost_metadata JSON NULL,
  processing_time_ms BIGINT NULL,
  error_code VARCHAR(100) NULL,
  safe_error_summary VARCHAR(500) NULL,
  version BIGINT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_ai_attempt_job_number (job_id, attempt_number),
  INDEX idx_ai_attempt_state_created (state, created_at),
  INDEX idx_ai_attempt_provider_capability (provider_key, capability_key, created_at),
  INDEX idx_ai_attempt_provider_task (provider_key, provider_task_id),
  CONSTRAINT fk_ai_attempt_job FOREIGN KEY (job_id) REFERENCES app_video_generations(id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_attempt_route FOREIGN KEY (route_id) REFERENCES app_ai_capability_routes(route_id),
  CONSTRAINT fk_ai_attempt_provider FOREIGN KEY (provider_key) REFERENCES app_ai_providers(provider_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS app_ai_provider_health (
  provider_key VARCHAR(32) NOT NULL,
  capability_key VARCHAR(100) NOT NULL,
  circuit_state ENUM('CLOSED','OPEN','HALF_OPEN') NOT NULL DEFAULT 'CLOSED',
  failure_threshold INT NOT NULL DEFAULT 5,
  cooldown_seconds INT NOT NULL DEFAULT 300,
  half_open_max_attempts INT NOT NULL DEFAULT 1,
  half_open_attempts INT NOT NULL DEFAULT 0,
  consecutive_failures INT NOT NULL DEFAULT 0,
  last_success_at DATETIME NULL,
  last_failure_at DATETIME NULL,
  opened_at DATETIME NULL,
  retry_after DATETIME NULL,
  average_latency_ms DECIMAL(20,3) NULL,
  success_count BIGINT NOT NULL DEFAULT 0,
  failure_count BIGINT NOT NULL DEFAULT 0,
  version BIGINT NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (provider_key, capability_key),
  CONSTRAINT fk_ai_health_provider FOREIGN KEY (provider_key) REFERENCES app_ai_providers(provider_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
