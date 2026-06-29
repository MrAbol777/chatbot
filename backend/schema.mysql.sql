-- MySQL schema for Danoa backend
-- Recommended: create a dedicated database (not `mysql` system DB)
-- Example:
--   CREATE DATABASE IF NOT EXISTS danoaa_app CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--   USE danoaa_app;

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS app_users (
  user_id VARCHAR(191) PRIMARY KEY,
  name VARCHAR(191) NOT NULL,
  age INT NOT NULL DEFAULT 0,
  phone VARCHAR(32) NULL,
  is_banned TINYINT(1) NOT NULL DEFAULT 0,
  registered_at DATETIME NOT NULL,
  last_active DATETIME NULL,
  INDEX idx_app_users_phone (phone),
  INDEX idx_app_users_last_active (last_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS app_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  category VARCHAR(100) NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_app_events_user_id (user_id),
  INDEX idx_app_events_type (event_type),
  INDEX idx_app_events_created_at (created_at),
  CONSTRAINT fk_app_events_user
    FOREIGN KEY (user_id)
    REFERENCES app_users(user_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS app_app_errors (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  error_type VARCHAR(100) NOT NULL,
  endpoint VARCHAR(255) NULL,
  status_code INT NULL,
  details TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_app_errors_type (error_type),
  INDEX idx_app_errors_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS app_conversations (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  guest_id VARCHAR(64) NULL,
  conversation_id VARCHAR(191) NOT NULL,
  title VARCHAR(255) NULL,
  pinned TINYINT(1) NOT NULL DEFAULT 0,
  messages JSON NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_app_conversations_user_conversation (user_id, conversation_id),
  INDEX idx_app_conversations_user_id (user_id),
  INDEX idx_app_conversations_guest_id (guest_id),
  INDEX idx_app_conversations_updated_at (updated_at),
  CONSTRAINT fk_app_conversations_user
    FOREIGN KEY (user_id)
    REFERENCES app_users(user_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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

CREATE TABLE IF NOT EXISTS image_generations (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  task_id VARCHAR(255) NOT NULL UNIQUE,
  prompt TEXT NOT NULL,
  status ENUM('QUEUE', 'WAITING', 'RUNNING', 'COMPLETED', 'ERROR', 'CANCELLED') NOT NULL DEFAULT 'QUEUE',
  image_url TEXT NULL,
  error TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_image_generations_task_id (task_id),
  INDEX idx_image_generations_user_status (user_id, status),
  CONSTRAINT fk_image_generations_user
    FOREIGN KEY (user_id)
    REFERENCES app_users(user_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
