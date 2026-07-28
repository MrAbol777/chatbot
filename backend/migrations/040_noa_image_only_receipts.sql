-- Receipt submission no longer asks users for a transaction ID or an amount.
-- The amount is entered and verified by Finance/Superadmin during review.
ALTER TABLE app_noa_receipts
  DROP CONSTRAINT chk_noa_receipt_declared_toman;

ALTER TABLE app_noa_receipts
  MODIFY COLUMN declared_toman DECIMAL(24,2) NULL;
