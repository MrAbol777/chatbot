-- Migration: 002_alter_image_generations_status_enum
-- Purpose: Add WAITING, RUNNING, CANCELLED to match MetisAI async status values
-- Date: 2026-06-09

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- Up migration
ALTER TABLE `image_generations`
  MODIFY COLUMN `status` ENUM('QUEUE', 'WAITING', 'RUNNING', 'COMPLETED', 'ERROR', 'CANCELLED') NOT NULL DEFAULT 'QUEUE';

-- ============================================================
-- Down migration (run this to rollback):
-- ============================================================
-- ALTER TABLE `image_generations`
--   MODIFY COLUMN `status` ENUM('QUEUE', 'IN_PROGRESS', 'COMPLETED', 'ERROR') NOT NULL DEFAULT 'QUEUE';
