CREATE TABLE IF NOT EXISTS app_chat_turns (
  turn_id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  conversation_id VARCHAR(191) NOT NULL,
  client_message_id VARCHAR(191) NULL,
  user_message MEDIUMTEXT NOT NULL,
  intent VARCHAR(32) NOT NULL,
  status ENUM('streaming', 'completed', 'cancelled', 'failed') NOT NULL DEFAULT 'streaming',
  reply MEDIUMTEXT NULL,
  model VARCHAR(191) NULL,
  token_usage JSON NULL,
  error_code VARCHAR(100) NULL,
  quota_charged TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  completed_at DATETIME NULL,
  INDEX idx_chat_turns_user_conversation (user_id, conversation_id),
  INDEX idx_chat_turns_status (status),
  INDEX idx_chat_turns_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS app_chat_attempts (
  attempt_id VARCHAR(64) PRIMARY KEY,
  turn_id VARCHAR(64) NOT NULL,
  status ENUM('streaming', 'completed', 'cancelled', 'failed') NOT NULL DEFAULT 'streaming',
  error_code VARCHAR(100) NULL,
  started_at DATETIME NOT NULL,
  finished_at DATETIME NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_chat_attempts_turn_id (turn_id),
  INDEX idx_chat_attempts_status (status),
  CONSTRAINT fk_chat_attempts_turn FOREIGN KEY (turn_id) REFERENCES app_chat_turns(turn_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
