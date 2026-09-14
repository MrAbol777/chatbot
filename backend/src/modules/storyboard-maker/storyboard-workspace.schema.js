'use strict';

async function ensureStoryboardWorkspaceSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS storyboard_workspaces (
      workspace_id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      title VARCHAR(191) NOT NULL,
      script MEDIUMTEXT NOT NULL,
      status ENUM('review','generating','completed','error') NOT NULL DEFAULT 'review',
      workspace JSON NOT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      INDEX idx_storyboard_workspaces_user_updated (user_id, updated_at),
      INDEX idx_storyboard_workspaces_user_status (user_id, status),
      CONSTRAINT fk_storyboard_workspaces_user FOREIGN KEY (user_id)
        REFERENCES app_users(user_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

module.exports = { ensureStoryboardWorkspaceSchema };
