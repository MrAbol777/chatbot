-- Admin-managed Noa balances may be negative. Reservations remain non-negative.
ALTER TABLE app_noa_wallets DROP CONSTRAINT chk_noa_wallet_available;
ALTER TABLE app_noa_transaction_logs DROP CONSTRAINT chk_noa_log_balances;
ALTER TABLE app_noa_transaction_logs
  ADD CONSTRAINT chk_noa_log_reserved_balances
  CHECK (reserved_before >= 0 AND reserved_after >= 0);

CREATE TABLE IF NOT EXISTS app_noa_user_notifications (
  notification_id CHAR(36) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  transaction_id CHAR(36) NOT NULL,
  message VARCHAR(500) NOT NULL,
  delivered_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_noa_user_notification_pending (user_id, delivered_at, created_at),
  CONSTRAINT fk_noa_user_notification_user
    FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE RESTRICT,
  CONSTRAINT fk_noa_user_notification_transaction
    FOREIGN KEY (transaction_id) REFERENCES app_noa_transaction_logs(transaction_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
