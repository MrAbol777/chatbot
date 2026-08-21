async function ensureBroadcastMessageSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_broadcast_messages (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(191) NULL,
      message MEDIUMTEXT NOT NULL,
      image_url VARCHAR(2048) NULL,
      action_url VARCHAR(2048) NULL,
      action_label VARCHAR(191) NULL,
      display_mode ENUM('toast', 'notification', 'dismissible_modal', 'required_modal', 'modal_and_notification') NOT NULL DEFAULT 'notification',
      priority ENUM('low', 'normal', 'high') NOT NULL DEFAULT 'normal',
      audience_type ENUM('all', 'some', 'one') NOT NULL,
      audience_user_ids JSON NULL,
      status ENUM('draft', 'scheduled', 'published', 'cancelled', 'expired') NOT NULL DEFAULT 'draft',
      scheduled_at DATETIME NULL,
      expires_at DATETIME NULL,
      created_by VARCHAR(191) NOT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      published_at DATETIME NULL,
      INDEX idx_broadcast_status_schedule (status, scheduled_at),
      INDEX idx_broadcast_expiry (status, expires_at),
      INDEX idx_broadcast_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS app_broadcast_recipients (
      message_id BIGINT NOT NULL,
      user_id VARCHAR(191) NOT NULL,
      delivered_at DATETIME NOT NULL,
      viewed_at DATETIME NULL,
      dismissed_at DATETIME NULL,
      acknowledged_at DATETIME NULL,
      clicked_at DATETIME NULL,
      PRIMARY KEY (message_id, user_id),
      INDEX idx_broadcast_recipient_user (user_id, delivered_at),
      INDEX idx_broadcast_recipient_unread (user_id, viewed_at, dismissed_at, acknowledged_at),
      CONSTRAINT fk_broadcast_recipient_message FOREIGN KEY (message_id)
        REFERENCES app_broadcast_messages(id) ON DELETE CASCADE,
      CONSTRAINT fk_broadcast_recipient_user FOREIGN KEY (user_id)
        REFERENCES app_users(user_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

module.exports = { ensureBroadcastMessageSchema };
