-- Migration: 010_enable_default_image_limits
-- Purpose: Seed guest image limits while preserving null/0 semantics.
-- Semantics:
--   NULL = unlimited
--   0 = disabled
--   positive number = quota

SET NAMES utf8mb4;
SET time_zone = '+00:00';

INSERT INTO app_settings (setting_key, setting_value, category, updated_at)
SELECT 'guest.image_limit_daily', '0', 'guest', NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM app_settings WHERE setting_key = 'guest.image_limit_daily'
);

INSERT INTO app_settings (setting_key, setting_value, category, updated_at)
SELECT 'guest.image_limit_hourly', '0', 'guest', NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM app_settings WHERE setting_key = 'guest.image_limit_hourly'
);
