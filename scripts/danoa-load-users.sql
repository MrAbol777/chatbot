-- Purpose: provision clearly labeled, disposable test identities only.
-- The matching benchmark logs in through the production OTP verification API.
SET max_recursive_iterations = 3000;

INSERT INTO app_users (user_id, name, age, phone, is_banned, registered_at, last_active)
WITH RECURSIVE seq AS (
  SELECT 1 AS n
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 3000
)
SELECT
  CONCAT('loadtest-20260911-', LPAD(n, 4, '0')),
  CONCAT('Load Test ', n),
  18,
  CONCAT('0997000', LPAD(n, 4, '0')),
  0,
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM seq
ON DUPLICATE KEY UPDATE
  name = VALUES(name), age = VALUES(age), is_banned = 0, last_active = VALUES(last_active);

INSERT INTO app_auth_otps (phone, code, attempts, blocked_until, created_at, expires_at)
WITH RECURSIVE seq AS (
  SELECT 1 AS n
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 3000
)
SELECT
  CONCAT('0997000', LPAD(n, 4, '0')),
  '739251',
  0,
  NULL,
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP() + INTERVAL 1 HOUR
FROM seq
ON DUPLICATE KEY UPDATE
  code = VALUES(code), attempts = 0, blocked_until = NULL, created_at = VALUES(created_at), expires_at = VALUES(expires_at);
