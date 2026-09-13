'use strict';

/**
 * Makes the character library available on both fresh local databases and
 * existing deployments.  This mirrors the bounded schema ownership used by
 * newer modules, so the workspace does not rely on a manual migration during
 * normal application startup.
 */
async function ensureCharacterWorkspaceSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS character_workspaces (
      workspace_id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      title VARCHAR(191) NOT NULL,
      scenario MEDIUMTEXT NOT NULL,
      status ENUM('review','generating','completed','error') NOT NULL DEFAULT 'review',
      workspace JSON NOT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      INDEX idx_character_workspaces_user_updated (user_id, updated_at),
      INDEX idx_character_workspaces_user_status (user_id, status),
      CONSTRAINT fk_character_workspaces_user FOREIGN KEY (user_id)
        REFERENCES app_users(user_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

module.exports = { ensureCharacterWorkspaceSchema };
