-- Migration: 006_guardian_child_accounts
-- Purpose: Add parent/guardian accounts and child profiles without changing app_users IDs.
-- Date: 2026-07-02

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS app_guardians (
  guardian_id VARCHAR(191) PRIMARY KEY,
  phone VARCHAR(32) NOT NULL,
  display_name VARCHAR(191) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_app_guardians_phone (phone),
  INDEX idx_app_guardians_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS app_children (
  child_id VARCHAR(191) PRIMARY KEY,
  guardian_id VARCHAR(191) NOT NULL,
  name VARCHAR(191) NOT NULL,
  age INT NOT NULL DEFAULT 0,
  avatar VARCHAR(255) NULL,
  grade VARCHAR(64) NULL,
  safety_level VARCHAR(32) NOT NULL DEFAULT 'standard',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_app_children_guardian_id (guardian_id),
  INDEX idx_app_children_updated_at (updated_at),
  CONSTRAINT fk_app_children_user
    FOREIGN KEY (child_id)
    REFERENCES app_users(user_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_app_children_guardian
    FOREIGN KEY (guardian_id)
    REFERENCES app_guardians(guardian_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Backfill a default guardian and child profile for existing registered users.
INSERT INTO app_guardians (guardian_id, phone, display_name, created_at, updated_at)
SELECT
  UUID(),
  existing_users.phone,
  NULL,
  existing_users.created_at,
  existing_users.updated_at
FROM (
  SELECT
    phone,
    MIN(COALESCE(registered_at, NOW())) AS created_at,
    MAX(COALESCE(last_active, registered_at, NOW())) AS updated_at
  FROM app_users
  WHERE phone IS NOT NULL
    AND phone <> ''
  GROUP BY phone
) existing_users
LEFT JOIN app_guardians g ON g.phone = existing_users.phone
WHERE g.guardian_id IS NULL;

INSERT INTO app_children (child_id, guardian_id, name, age, avatar, grade, safety_level, created_at, updated_at)
SELECT
  u.user_id,
  g.guardian_id,
  u.name,
  u.age,
  NULL,
  NULL,
  'standard',
  COALESCE(u.registered_at, NOW()),
  COALESCE(u.last_active, u.registered_at, NOW())
FROM app_users u
JOIN app_guardians g ON g.phone = u.phone
LEFT JOIN app_children c ON c.child_id = u.user_id
WHERE u.phone IS NOT NULL
  AND u.phone <> ''
  AND c.child_id IS NULL;

-- Down migration:
-- DROP TABLE IF EXISTS app_children;
-- DROP TABLE IF EXISTS app_guardians;
