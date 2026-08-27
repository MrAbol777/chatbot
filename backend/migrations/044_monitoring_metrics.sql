CREATE TABLE IF NOT EXISTS app_request_metrics (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(64) NOT NULL,
  method VARCHAR(12) NOT NULL,
  route VARCHAR(191) NOT NULL,
  status_code SMALLINT UNSIGNED NOT NULL,
  duration_ms INT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_request_metrics_created (created_at),
  INDEX idx_request_metrics_route_created (route, created_at),
  INDEX idx_request_metrics_status_created (status_code, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
