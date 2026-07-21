CREATE TABLE IF NOT EXISTS conversation_documents (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  conversation_id VARCHAR(64) NOT NULL,
  file_name VARCHAR(191) NOT NULL,
  storage_key VARCHAR(191) NOT NULL,
  version INT NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'ready',
  last_writer_status VARCHAR(32) NULL,
  last_writer_model VARCHAR(191) NULL,
  last_writer_duration_ms INT NULL,
  last_error_code VARCHAR(100) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_conversation_documents_conversation_id (conversation_id),
  INDEX idx_conversation_documents_conversation_id (conversation_id),
  INDEX idx_conversation_documents_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS conversation_document_updates (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  conversation_id VARCHAR(64) NOT NULL,
  document_version INT NOT NULL,
  source_user_message_id VARCHAR(191) NULL,
  source_assistant_message_id VARCHAR(191) NULL,
  update_status VARCHAR(32) NOT NULL,
  error_code VARCHAR(100) NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_conversation_document_updates_conversation_id (conversation_id),
  INDEX idx_conversation_document_updates_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
