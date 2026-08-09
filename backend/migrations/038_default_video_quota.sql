-- Give every existing and future plan two successful video generations per Tehran calendar day.
-- This is additive and does not reset or remove existing usage/reservations.
ALTER TABLE app_plans
  MODIFY COLUMN video_limit INT NULL DEFAULT 2;

UPDATE app_plans
SET video_limit = 2,
    updated_at = NOW();
