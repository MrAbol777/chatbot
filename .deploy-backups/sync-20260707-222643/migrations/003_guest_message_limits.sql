-- Migration: 003_guest_message_limits
-- Purpose: Track guest message limits and mark guest-owned conversations.
-- Date: 2026-06-27

SET NAMES utf8mb4;
SET time_zone = '+00:00';

SET @guest_id_column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'app_conversations'
    AND COLUMN_NAME = 'guest_id'
);
SET @add_guest_id_column_sql = IF(
  @guest_id_column_exists = 0,
  'ALTER TABLE app_conversations ADD COLUMN guest_id VARCHAR(64) NULL AFTER user_id',
  'SELECT 1'
);
PREPARE add_guest_id_column_stmt FROM @add_guest_id_column_sql;
EXECUTE add_guest_id_column_stmt;
DEALLOCATE PREPARE add_guest_id_column_stmt;

SET @guest_id_index_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'app_conversations'
    AND INDEX_NAME = 'idx_app_conversations_guest_id'
);
SET @add_guest_id_index_sql = IF(
  @guest_id_index_exists = 0,
  'ALTER TABLE app_conversations ADD INDEX idx_app_conversations_guest_id (guest_id)',
  'SELECT 1'
);
PREPARE add_guest_id_index_stmt FROM @add_guest_id_index_sql;
EXECUTE add_guest_id_index_stmt;
DEALLOCATE PREPARE add_guest_id_index_stmt;

CREATE TABLE IF NOT EXISTS guest_message_counts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  guest_id VARCHAR(64) NOT NULL,
  ip_address VARCHAR(64) NOT NULL,
  message_count INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  last_message_at DATETIME NOT NULL,
  UNIQUE KEY uq_guest_message_counts_guest_ip (guest_id, ip_address),
  INDEX idx_guest_message_counts_guest_id (guest_id),
  INDEX idx_guest_message_counts_ip_address (ip_address),
  INDEX idx_guest_message_counts_last_message_at (last_message_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Down migration:
-- DROP TABLE IF EXISTS guest_message_counts;
-- ALTER TABLE app_conversations DROP INDEX idx_app_conversations_guest_id;
-- ALTER TABLE app_conversations DROP COLUMN guest_id;
