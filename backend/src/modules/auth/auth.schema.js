async function ensureAuthSessionSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_viana_oauth_flows (
      state_hash CHAR(64) PRIMARY KEY,
      browser_binding_hash CHAR(64) NOT NULL,
      code_verifier VARCHAR(128) NOT NULL,
      environment_key VARCHAR(32) NOT NULL,
      created_at DATETIME(6) NOT NULL,
      expires_at DATETIME(6) NOT NULL,
      INDEX idx_viana_oauth_flows_expires (expires_at),
      INDEX idx_viana_oauth_flows_binding (browser_binding_hash)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS app_viana_identities (
      identity_id BIGINT AUTO_INCREMENT PRIMARY KEY,
      provider VARCHAR(32) NOT NULL,
      environment_key VARCHAR(32) NOT NULL,
      client_id VARCHAR(191) NOT NULL,
      subject VARCHAR(191) NOT NULL,
      user_id VARCHAR(191) NOT NULL,
      first_name VARCHAR(191) NOT NULL,
      last_name VARCHAR(191) NOT NULL,
      date_of_birth DATE NOT NULL,
      grade VARCHAR(64) NULL,
      gender ENUM('MALE','FEMALE') NULL,
      created_at DATETIME(6) NOT NULL,
      updated_at DATETIME(6) NOT NULL,
      last_login_at DATETIME(6) NOT NULL,
      UNIQUE KEY uq_viana_identity_provider_client_subject (provider, client_id, subject),
      INDEX idx_viana_identity_user (user_id),
      CONSTRAINT fk_viana_identity_user FOREIGN KEY (user_id)
        REFERENCES app_users(user_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS app_auth_sessions (
      session_hash CHAR(64) PRIMARY KEY,
      csrf_token_hash CHAR(64) NOT NULL,
      user_id VARCHAR(191) NOT NULL,
      provider VARCHAR(32) NOT NULL,
      created_at DATETIME(6) NOT NULL,
      last_activity_at DATETIME(6) NOT NULL,
      absolute_expires_at DATETIME(6) NOT NULL,
      INDEX idx_auth_sessions_user (user_id),
      INDEX idx_auth_sessions_expiry (absolute_expires_at),
      INDEX idx_auth_sessions_activity (last_activity_at),
      CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id)
        REFERENCES app_users(user_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

module.exports = { ensureAuthSessionSchema };
