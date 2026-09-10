-- Support center: user reports and admin replies in one trackable conversation.
-- This migration is also applied at boot through ensureSupportSchema for new environments.

CREATE TABLE IF NOT EXISTS app_support_tickets (
  ticket_id CHAR(36) PRIMARY KEY,
  ticket_code VARCHAR(32) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  context JSON NULL,
  category ENUM('technical', 'account', 'billing', 'suggestion', 'other') NOT NULL DEFAULT 'technical',
  priority ENUM('normal', 'high', 'urgent') NOT NULL DEFAULT 'normal',
  status ENUM('open', 'in_progress', 'waiting_user', 'resolved', 'closed') NOT NULL DEFAULT 'open',
  assigned_admin_username VARCHAR(191) NULL,
  last_message_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  resolved_at DATETIME(6) NULL,
  UNIQUE KEY uq_support_ticket_code (ticket_code),
  INDEX idx_support_tickets_user_updated (user_id, updated_at),
  INDEX idx_support_tickets_status_updated (status, updated_at),
  INDEX idx_support_tickets_assignee_status (assigned_admin_username, status),
  CONSTRAINT fk_support_tickets_user FOREIGN KEY (user_id)
    REFERENCES app_users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS app_support_messages (
  message_id CHAR(36) PRIMARY KEY,
  ticket_id CHAR(36) NOT NULL,
  author_type ENUM('user', 'admin', 'system') NOT NULL,
  author_id VARCHAR(191) NULL,
  body TEXT NOT NULL,
  is_internal TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL,
  INDEX idx_support_messages_ticket_created (ticket_id, created_at),
  CONSTRAINT fk_support_messages_ticket FOREIGN KEY (ticket_id)
    REFERENCES app_support_tickets(ticket_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
