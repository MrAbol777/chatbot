-- Migration 045: Allow zero-amount notice and review transaction log entries in Noa ledger
-- Enables zero-delta audit rows for receipt review notices linking to user notifications

ALTER TABLE app_noa_transaction_logs DROP CONSTRAINT IF EXISTS chk_noa_log_amount;
ALTER TABLE app_noa_transaction_logs ADD CONSTRAINT chk_noa_log_amount CHECK (amount >= 0);
