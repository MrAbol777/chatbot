ALTER TABLE app_viana_oauth_flows
  ADD COLUMN IF NOT EXISTS nonce VARCHAR(128) NOT NULL DEFAULT '' AFTER code_verifier;

ALTER TABLE app_viana_identities
  ADD COLUMN IF NOT EXISTS student_phone VARCHAR(32) NULL AFTER gender,
  ADD COLUMN IF NOT EXISTS guardian_phone VARCHAR(32) NULL AFTER student_phone,
  ADD COLUMN IF NOT EXISTS points INT NULL AFTER guardian_phone,
  ADD COLUMN IF NOT EXISTS synced_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) AFTER points;

CREATE TABLE IF NOT EXISTS app_viana_link_requests (
  link_hash CHAR(64) PRIMARY KEY,
  environment_key VARCHAR(32) NOT NULL,
  client_id VARCHAR(191) NOT NULL,
  subject VARCHAR(191) NOT NULL,
  candidate_user_id VARCHAR(191) NOT NULL,
  first_name VARCHAR(191) NOT NULL,
  last_name VARCHAR(191) NOT NULL,
  date_of_birth DATE NOT NULL,
  grade VARCHAR(64) NULL,
  gender ENUM('MALE','FEMALE') NULL,
  student_phone VARCHAR(32) NULL,
  guardian_phone VARCHAR(32) NULL,
  points INT NULL,
  created_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  INDEX idx_viana_link_requests_expires (expires_at),
  CONSTRAINT fk_viana_link_request_user FOREIGN KEY (candidate_user_id)
    REFERENCES app_users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
