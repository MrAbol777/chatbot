-- Migration: 005_image_generation_hourly_limits
-- Purpose: Make image generation hourly limits database-driven per plan.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

SET @hourly_image_limit_column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'app_plans'
    AND COLUMN_NAME = 'hourly_image_limit'
);
SET @add_hourly_image_limit_column_sql = IF(
  @hourly_image_limit_column_exists = 0,
  'ALTER TABLE app_plans ADD COLUMN hourly_image_limit INT NULL AFTER daily_image_limit',
  'SELECT 1'
);
PREPARE add_hourly_image_limit_column_stmt FROM @add_hourly_image_limit_column_sql;
EXECUTE add_hourly_image_limit_column_stmt;
DEALLOCATE PREPARE add_hourly_image_limit_column_stmt;

CREATE TABLE IF NOT EXISTS app_plan_hourly_usage (
  user_id VARCHAR(191) NOT NULL,
  usage_hour DATETIME NOT NULL,
  image_count INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (user_id, usage_hour),
  INDEX idx_plan_hourly_usage_hour (usage_hour)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Down migration:
-- DROP TABLE IF EXISTS app_plan_hourly_usage;
-- ALTER TABLE app_plans DROP COLUMN hourly_image_limit;
