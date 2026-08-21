-- Migration: 044_admin_and_audit_tables.sql
-- Purpose: Move admin accounts and audit logs from plain disk files into indexed MySQL tables.

CREATE TABLE IF NOT EXISTS app_admins (
  id VARCHAR(191) PRIMARY KEY,
  username VARCHAR(191) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(64) NOT NULL DEFAULT 'superadmin',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_app_admins_username (username),
  INDEX idx_app_admins_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
