const mysql = require('mysql2/promise');

class DatabaseClient {
  constructor({ databaseUrl }) {
    if (!databaseUrl || !databaseUrl.startsWith('mysql://')) {
      throw new Error('DATABASE_URL must be set to a valid mysql:// URL');
    }

    const parsed = new URL(databaseUrl);
    this.pool = mysql.createPool({
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 3306,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.replace(/^\//, ''),
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      charset: 'utf8mb4'
    });

    this.initPromise = null;
  }

  async init() {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      console.log('[DB] Connecting to local MySQL...');
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS app_users (
          user_id VARCHAR(191) PRIMARY KEY,
          name VARCHAR(191) NOT NULL,
          age INT NOT NULL DEFAULT 0,
          phone VARCHAR(32) NULL,
          is_banned TINYINT(1) NOT NULL DEFAULT 0,
          registered_at DATETIME NOT NULL,
          last_active DATETIME NULL,
          INDEX idx_users_phone (phone)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS app_guardians (
          guardian_id VARCHAR(191) PRIMARY KEY,
          phone VARCHAR(32) NOT NULL,
          display_name VARCHAR(191) NULL,
          created_at DATETIME NOT NULL,
          updated_at DATETIME NOT NULL,
          UNIQUE KEY uq_app_guardians_phone (phone),
          INDEX idx_app_guardians_updated_at (updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS app_children (
          child_id VARCHAR(191) PRIMARY KEY,
          guardian_id VARCHAR(191) NOT NULL,
          name VARCHAR(191) NOT NULL,
          age INT NOT NULL DEFAULT 0,
          avatar VARCHAR(255) NULL,
          grade VARCHAR(64) NULL,
          safety_level VARCHAR(32) NOT NULL DEFAULT 'standard',
          guardian_consent_at DATETIME NULL,
          guardian_consent_version VARCHAR(32) NULL,
          created_at DATETIME NOT NULL,
          updated_at DATETIME NOT NULL,
          INDEX idx_app_children_guardian_id (guardian_id),
          INDEX idx_app_children_updated_at (updated_at),
          CONSTRAINT fk_app_children_user
            FOREIGN KEY (child_id)
            REFERENCES app_users(user_id)
            ON DELETE CASCADE,
          CONSTRAINT fk_app_children_guardian
            FOREIGN KEY (guardian_id)
            REFERENCES app_guardians(guardian_id)
            ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
      await this.ensureColumn('app_children', 'guardian_consent_at', 'DATETIME NULL AFTER safety_level');
      await this.ensureColumn('app_children', 'guardian_consent_version', 'VARCHAR(32) NULL AFTER guardian_consent_at');

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS app_events (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          user_id VARCHAR(191) NOT NULL,
          event_type VARCHAR(100) NOT NULL,
          category VARCHAR(100) NULL,
          metadata JSON NULL,
          created_at DATETIME NOT NULL,
          INDEX idx_events_user_id (user_id),
          INDEX idx_events_type (event_type),
          INDEX idx_events_created (created_at),
          CONSTRAINT fk_events_user FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS app_app_errors (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          error_type VARCHAR(100) NOT NULL,
          endpoint VARCHAR(255) NULL,
          status_code INT NULL,
          details TEXT NOT NULL,
          created_at DATETIME NOT NULL,
          INDEX idx_errors_type (error_type),
          INDEX idx_errors_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS app_conversations (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          user_id VARCHAR(191) NOT NULL,
          guest_id VARCHAR(64) NULL,
          conversation_id VARCHAR(191) NOT NULL,
          title VARCHAR(255) NULL,
          pinned TINYINT(1) NOT NULL DEFAULT 0,
          messages JSON NULL,
          created_at DATETIME NOT NULL,
          updated_at DATETIME NOT NULL,
          UNIQUE KEY uq_user_conversation (user_id, conversation_id),
          INDEX idx_conversations_user (user_id),
          INDEX idx_conversations_updated (updated_at),
          CONSTRAINT fk_conversations_user FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
      await this.ensureColumn('app_conversations', 'guest_id', 'VARCHAR(64) NULL AFTER user_id');
      await this.ensureIndex('app_conversations', 'idx_app_conversations_guest_id', 'guest_id');

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS guest_message_counts (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          guest_id VARCHAR(64) NOT NULL,
          ip_address VARCHAR(64) NOT NULL,
          message_count INT NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL,
          last_message_at DATETIME NOT NULL,
          UNIQUE KEY uq_guest_message_counts_guest_ip (guest_id, ip_address),
          INDEX idx_guest_message_counts_guest (guest_id),
          INDEX idx_guest_message_counts_ip (ip_address),
          INDEX idx_guest_message_counts_last_message (last_message_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS app_chat_messages (
          message_id BIGINT AUTO_INCREMENT PRIMARY KEY,
          user_id VARCHAR(191) NULL,
          guest_id VARCHAR(64) NULL,
          user_type VARCHAR(32) NOT NULL,
          conversation_id VARCHAR(191) NOT NULL,
          role ENUM('user', 'assistant') NOT NULL,
          content MEDIUMTEXT NOT NULL,
          model VARCHAR(191) NULL,
          response_time_ms INT NULL,
          token_usage JSON NULL,
          error_code VARCHAR(100) NULL,
          limit_status VARCHAR(100) NULL,
          created_at DATETIME NOT NULL,
          INDEX idx_chat_messages_user_id (user_id),
          INDEX idx_chat_messages_guest_id (guest_id),
          INDEX idx_chat_messages_conversation (conversation_id),
          INDEX idx_chat_messages_created_at (created_at),
          INDEX idx_chat_messages_role (role)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
      await this.ensureColumn('app_chat_messages', 'turn_id', 'VARCHAR(64) NULL AFTER conversation_id');
      await this.ensureCompositeIndex('app_chat_messages', 'uq_chat_messages_turn_role', '`turn_id`, `role`', true);

      await this.pool.query(`
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
      `);

      await this.pool.query(`
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
      `);

      await this.pool.query(`
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
      `);

      await this.pool.query(`
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
      `);

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS image_generations (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          user_id VARCHAR(191) NOT NULL,
          task_id VARCHAR(255) NOT NULL UNIQUE,
          prompt TEXT NOT NULL,
          original_prompt TEXT NULL,
          refined_prompt TEXT NULL,
          aspect_ratio VARCHAR(16) NOT NULL DEFAULT '1:1',
          operation ENUM('generate', 'edit') NOT NULL DEFAULT 'generate',
          conversation_id VARCHAR(191) NULL,
          parent_image_id BIGINT NULL,
          idempotency_key VARCHAR(191) NULL,
          status ENUM('QUEUE', 'WAITING', 'RUNNING', 'COMPLETED', 'ERROR', 'CANCELLED') NOT NULL DEFAULT 'QUEUE',
          image_url TEXT NULL,
          local_file_path TEXT NULL,
          mime_type VARCHAR(100) NULL,
          file_size BIGINT NULL,
          provider VARCHAR(64) NULL,
          model_admin_value VARCHAR(191) NULL,
          model_runtime_value VARCHAR(191) NULL,
          remote_url_host VARCHAR(255) NULL,
          metadata JSON NULL,
          error TEXT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          deleted_at DATETIME NULL,
          INDEX idx_image_generations_task_id (task_id),
          INDEX idx_image_generations_user_status (user_id, status),
          INDEX idx_image_generations_owner_created (user_id, created_at),
          INDEX idx_image_generations_owner_deleted_status (user_id, deleted_at, status),
          UNIQUE INDEX uq_image_generations_owner_idempotency (user_id, idempotency_key),
          CONSTRAINT fk_image_generations_user
            FOREIGN KEY (user_id)
            REFERENCES app_users(user_id)
            ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
      await this.ensureColumn('image_generations', 'local_file_path', 'TEXT NULL AFTER image_url');
      await this.ensureColumn('image_generations', 'mime_type', 'VARCHAR(100) NULL AFTER local_file_path');
      await this.ensureColumn('image_generations', 'file_size', 'BIGINT NULL AFTER mime_type');
      await this.ensureColumn('image_generations', 'provider', 'VARCHAR(64) NULL AFTER file_size');
      await this.ensureColumn('image_generations', 'model_admin_value', 'VARCHAR(191) NULL AFTER provider');
      await this.ensureColumn('image_generations', 'model_runtime_value', 'VARCHAR(191) NULL AFTER model_admin_value');
      await this.ensureColumn('image_generations', 'remote_url_host', 'VARCHAR(255) NULL AFTER model_runtime_value');
      await this.ensureColumn('image_generations', 'metadata', 'JSON NULL AFTER remote_url_host');
      await this.ensureColumn('image_generations', 'original_prompt', 'TEXT NULL AFTER prompt');
      await this.ensureColumn('image_generations', 'refined_prompt', 'TEXT NULL AFTER original_prompt');
      await this.ensureColumn('image_generations', 'aspect_ratio', "VARCHAR(16) NOT NULL DEFAULT '1:1' AFTER refined_prompt");
      await this.ensureColumn('image_generations', 'operation', "ENUM('generate', 'edit') NOT NULL DEFAULT 'generate' AFTER aspect_ratio");
      await this.ensureColumn('image_generations', 'conversation_id', 'VARCHAR(191) NULL AFTER operation');
      await this.ensureColumn('image_generations', 'parent_image_id', 'BIGINT NULL AFTER conversation_id');
      await this.ensureColumn('image_generations', 'idempotency_key', 'VARCHAR(191) NULL AFTER parent_image_id');
      await this.ensureColumn('image_generations', 'deleted_at', 'DATETIME NULL AFTER updated_at');
      await this.ensureCompositeIndex('image_generations', 'idx_image_generations_owner_created', '`user_id`, `created_at`');
      await this.ensureCompositeIndex('image_generations', 'idx_image_generations_owner_deleted_status', '`user_id`, `deleted_at`, `status`');
      await this.ensureCompositeIndex('image_generations', 'uq_image_generations_owner_idempotency', '`user_id`, `idempotency_key`', true);

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS app_settings (
          setting_key VARCHAR(191) PRIMARY KEY,
          setting_value JSON NOT NULL,
          category VARCHAR(64) NOT NULL,
          updated_at DATETIME NOT NULL,
          INDEX idx_app_settings_category (category)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS app_supervised_otp_config (
          id VARCHAR(32) PRIMARY KEY,
          enabled TINYINT(1) NOT NULL DEFAULT 0,
          code_hash VARCHAR(255) NULL,
          expires_at DATETIME NULL,
          max_uses INT NULL,
          used_count INT NOT NULL DEFAULT 0,
          created_at DATETIME NOT NULL,
          updated_at DATETIME NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS app_supervised_otp_usage (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          phone VARCHAR(32) NOT NULL,
          user_id VARCHAR(191) NULL,
          result VARCHAR(64) NOT NULL,
          used_at DATETIME NOT NULL,
          INDEX idx_supervised_otp_usage_phone (phone),
          INDEX idx_supervised_otp_usage_user (user_id),
          INDEX idx_supervised_otp_usage_used_at (used_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS app_plans (
          id VARCHAR(64) PRIMARY KEY,
          name VARCHAR(191) NOT NULL,
          icon VARCHAR(64) NOT NULL DEFAULT '✨',
          tagline VARCHAR(255) NULL,
          monthly_price INT NOT NULL DEFAULT 0,
          daily_price INT NOT NULL DEFAULT 0,
          daily_message_limit INT NULL,
          daily_image_limit INT NULL,
          hourly_image_limit INT NULL,
          features JSON NOT NULL,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          sort_order INT NOT NULL DEFAULT 999,
          created_at DATETIME NOT NULL,
          updated_at DATETIME NOT NULL,
          INDEX idx_app_plans_active_sort (is_active, sort_order)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
      await this.ensureColumn('app_plans', 'hourly_image_limit', 'INT NULL AFTER daily_image_limit');

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS app_plan_daily_usage (
          user_id VARCHAR(191) NOT NULL,
          usage_date DATE NOT NULL,
          message_count INT NOT NULL DEFAULT 0,
          image_count INT NOT NULL DEFAULT 0,
          updated_at DATETIME NOT NULL,
          PRIMARY KEY (user_id, usage_date),
          INDEX idx_plan_daily_usage_date (usage_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS app_plan_hourly_usage (
          user_id VARCHAR(191) NOT NULL,
          usage_hour DATETIME NOT NULL,
          image_count INT NOT NULL DEFAULT 0,
          updated_at DATETIME NOT NULL,
          PRIMARY KEY (user_id, usage_hour),
          INDEX idx_plan_hourly_usage_hour (usage_hour)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      console.log('[DB] Connected to local MySQL');
    })();

    return this.initPromise;
  }

  query(sql, params) {
    return this.pool.query(sql, params);
  }

  getConnection() {
    return this.pool.getConnection();
  }

  async ensureColumn(tableName, columnName, definition) {
    const [rows] = await this.pool.query(`SHOW COLUMNS FROM \`${tableName}\` LIKE ?`, [columnName]);
    if (rows.length > 0) return;
    await this.pool.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`);
  }

  async ensureIndex(tableName, indexName, columnName) {
    const [rows] = await this.pool.query(`SHOW INDEX FROM \`${tableName}\` WHERE Key_name = ?`, [indexName]);
    if (rows.length > 0) return;
    await this.pool.query(`ALTER TABLE \`${tableName}\` ADD INDEX \`${indexName}\` (\`${columnName}\`)`);
  }

  async ensureCompositeIndex(tableName, indexName, columnsSql, unique = false) {
    const [rows] = await this.pool.query(`SHOW INDEX FROM \`${tableName}\` WHERE Key_name = ?`, [indexName]);
    if (rows.length > 0) return;
    await this.pool.query(
      `ALTER TABLE \`${tableName}\` ADD ${unique ? 'UNIQUE ' : ''}INDEX \`${indexName}\` (${columnsSql})`
    );
  }
}

module.exports = { DatabaseClient };
