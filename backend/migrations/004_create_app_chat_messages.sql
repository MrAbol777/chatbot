-- Migration: 004_create_app_chat_messages
-- Purpose: Store per-message chat analytics for admin CSV exports.

CREATE TABLE IF NOT EXISTS app_chat_messages (
  message_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(191) NULL,
  guest_id VARCHAR(64) NULL,
  user_type VARCHAR(32) NOT NULL,
  conversation_id VARCHAR(191) NOT NULL,
  role ENUM('user', 'assistant') NOT NULL,
  content MEDIUMTEXT NOT NULL,
  model VARCHAR(191) NULL,
  response_time_ms INT NULL,
  token_usage JSON NULL,
  error_code VARCHAR(100) NULL,
  limit_status VARCHAR(100) NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_chat_messages_user_id (user_id),
  INDEX idx_chat_messages_guest_id (guest_id),
  INDEX idx_chat_messages_conversation (conversation_id),
  INDEX idx_chat_messages_created_at (created_at),
  INDEX idx_chat_messages_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
