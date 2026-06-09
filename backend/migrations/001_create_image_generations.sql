-- Migration: 001_create_image_generations
-- Purpose: Add image generation task tracking for MetisAI async tasks
-- Date: 2026-06-08

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- Up migration
CREATE TABLE IF NOT EXISTS image_generations (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  task_id VARCHAR(255) NOT NULL UNIQUE,
  prompt TEXT NOT NULL,
  status ENUM('QUEUE', 'IN_PROGRESS', 'COMPLETED', 'ERROR') NOT NULL DEFAULT 'QUEUE',
  image_url TEXT NULL,
  error TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_image_generations_task_id (task_id),
  INDEX idx_image_generations_user_status (user_id, status),

  CONSTRAINT fk_image_generations_user
    FOREIGN KEY (user_id)
    REFERENCES app_users(user_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- Down migration (run this to rollback):
-- ============================================================
-- DROP TABLE IF EXISTS image_generations;
