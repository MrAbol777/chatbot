const mysql = require('mysql2/promise');
const { ensureNoaSchema } = require('../modules/noa/noa.schema');
const { ensureAuthSessionSchema } = require('../modules/auth/auth.schema');

class DatabaseClient {
  constructor({ databaseUrl, databaseHost }) {
    if (!databaseUrl || !databaseUrl.startsWith('mysql://')) {
      throw new Error('DATABASE_URL must be set to a valid mysql:// URL');
    }

    const parsed = new URL(databaseUrl);
    this.host = String(databaseHost || process.env.DATABASE_HOST || process.env.LOCAL_DATABASE_HOST || parsed.hostname).trim() || parsed.hostname;
    this.port = parsed.port ? Number(parsed.port) : 3306;
    this.pool = mysql.createPool({
      host: this.host,
      port: this.port,
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
      console.log(`[DB] Connecting to MySQL at ${this.host}:${this.port}...`);
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
          conversation_id VARCHAR(191) NOT NULL,
          title VARCHAR(255) NULL,
          generated_title VARCHAR(255) NULL,
          title_source ENUM('default','generated','manual') NOT NULL DEFAULT 'default',
          title_generation_status ENUM('pending','generating','completed','fallback','failed') NULL DEFAULT NULL,
          title_model VARCHAR(191) NULL,
          title_generator_version VARCHAR(32) NULL,
          title_generation_latency_ms INT NULL,
          title_generated_at DATETIME NULL,
          title_manually_updated_at DATETIME NULL,
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
      await this.ensureColumn('app_conversations', 'generated_title', 'VARCHAR(255) NULL AFTER title');
      await this.ensureColumn('app_conversations', 'title_source', "ENUM('default','generated','manual') NOT NULL DEFAULT 'default' AFTER generated_title");
      await this.ensureColumn('app_conversations', 'title_generation_status', "ENUM('pending','generating','completed','fallback','failed') NULL DEFAULT NULL AFTER title_source");
      await this.ensureColumn('app_conversations', 'title_model', 'VARCHAR(191) NULL AFTER title_generation_status');
      await this.ensureColumn('app_conversations', 'title_generator_version', 'VARCHAR(32) NULL AFTER title_model');
      await this.ensureColumn('app_conversations', 'title_generation_latency_ms', 'INT NULL AFTER title_generator_version');
      await this.ensureColumn('app_conversations', 'title_generated_at', 'DATETIME NULL AFTER title_generation_latency_ms');
      await this.ensureColumn('app_conversations', 'title_manually_updated_at', 'DATETIME NULL AFTER title_generated_at');
      await this.ensureCompositeIndex('app_conversations', 'idx_app_conversations_title_generation', '`title_generation_status`, `updated_at`');
      await this.ensureCompositeIndex('app_conversations', 'idx_app_conversations_title_source', '`title_source`, `updated_at`');

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS app_chat_messages (
          message_id BIGINT AUTO_INCREMENT PRIMARY KEY,
          user_id VARCHAR(191) NOT NULL,
          user_type VARCHAR(32) NOT NULL DEFAULT 'registered',
          conversation_id VARCHAR(191) NOT NULL,
          role ENUM('user', 'assistant') NOT NULL,
          content MEDIUMTEXT NOT NULL,
          model VARCHAR(191) NULL,
          response_time_ms INT NULL,
          token_usage JSON NULL,
          error_code VARCHAR(100) NULL,
          created_at DATETIME NOT NULL,
          INDEX idx_chat_messages_user_id (user_id),
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
        CREATE TABLE IF NOT EXISTS input_optimizations (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          operation_type VARCHAR(64) NOT NULL,
          operation_id VARCHAR(191) NOT NULL,
          conversation_id VARCHAR(191) NULL,
          turn_id VARCHAR(64) NULL,
          attempt_id VARCHAR(64) NULL,
          image_generation_id BIGINT NULL,
          user_id VARCHAR(191) NOT NULL,
          original_input MEDIUMTEXT NOT NULL,
          optimized_input MEDIUMTEXT NULL,
          source_language VARCHAR(16) NULL,
          target_language VARCHAR(16) NOT NULL DEFAULT 'en',
          ambiguity_level ENUM('none','low','high') NOT NULL DEFAULT 'none',
          needs_clarification TINYINT(1) NOT NULL DEFAULT 0,
          clarification_question_fa TEXT NULL,
          status ENUM('pending','completed','clarification_required','fallback','failed','cancelled','disabled') NOT NULL DEFAULT 'pending',
          model VARCHAR(191) NULL,
          optimizer_version VARCHAR(32) NOT NULL DEFAULT '1',
          latency_ms INT NULL,
          retry_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
          fallback_used TINYINT(1) NOT NULL DEFAULT 0,
          error_code VARCHAR(100) NULL,
          metadata JSON NULL,
          created_at DATETIME NOT NULL,
          updated_at DATETIME NOT NULL,
          UNIQUE KEY uq_input_optimizations_operation (operation_type, operation_id),
          INDEX idx_input_optimizations_user_created (user_id, created_at),
          INDEX idx_input_optimizations_conversation_created (conversation_id, created_at),
          INDEX idx_input_optimizations_status_created (status, created_at)
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
        CREATE TABLE IF NOT EXISTS app_admins (
          id VARCHAR(191) PRIMARY KEY,
          username VARCHAR(191) NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          role VARCHAR(64) NOT NULL DEFAULT 'superadmin',
          created_at DATETIME NOT NULL,
          updated_at DATETIME NOT NULL,
          UNIQUE KEY uq_app_admins_username (username),
          INDEX idx_app_admins_role (role)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS app_admin_audit_logs (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          admin_username VARCHAR(191) NULL,
          action VARCHAR(100) NOT NULL,
          target VARCHAR(191) NULL,
          details JSON NULL,
          created_at DATETIME NOT NULL,
          INDEX idx_admin_audit_created (created_at),
          INDEX idx_admin_audit_action (action),
          INDEX idx_admin_audit_username (admin_username)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      await ensureNoaSchema(this.pool);
      await ensureAuthSessionSchema(this.pool);

      console.log(`[DB] Connected to MySQL at ${this.host}:${this.port}`);
    })();

    return this.initPromise;
  }

  query(sql, params) {
    return this.pool.query(sql, params);
  }

  getConnection() {
    return this.pool.getConnection();
  }

  async close() {
    await this.pool.end();
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
