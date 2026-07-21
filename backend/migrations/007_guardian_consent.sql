-- Migration: 007_guardian_consent
-- Purpose: Store explicit guardian consent for child accounts.
-- Date: 2026-07-02

SET NAMES utf8mb4;
SET time_zone = '+00:00';

SET @guardian_consent_at_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'app_children'
    AND COLUMN_NAME = 'guardian_consent_at'
);
SET @add_guardian_consent_at_sql = IF(
  @guardian_consent_at_exists = 0,
  'ALTER TABLE app_children ADD COLUMN guardian_consent_at DATETIME NULL AFTER safety_level',
  'SELECT 1'
);
PREPARE add_guardian_consent_at_stmt FROM @add_guardian_consent_at_sql;
EXECUTE add_guardian_consent_at_stmt;
DEALLOCATE PREPARE add_guardian_consent_at_stmt;

SET @guardian_consent_version_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'app_children'
    AND COLUMN_NAME = 'guardian_consent_version'
);
SET @add_guardian_consent_version_sql = IF(
  @guardian_consent_version_exists = 0,
  'ALTER TABLE app_children ADD COLUMN guardian_consent_version VARCHAR(32) NULL AFTER guardian_consent_at',
  'SELECT 1'
);
PREPARE add_guardian_consent_version_stmt FROM @add_guardian_consent_version_sql;
EXECUTE add_guardian_consent_version_stmt;
DEALLOCATE PREPARE add_guardian_consent_version_stmt;

-- Existing child rows predate this explicit consent step. Keep them nullable until re-consent.
