const path = require('path');
const fs = require('fs-extra');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

const { DatabaseClient } = require('../src/repositories/DatabaseClient');

const ADMIN_FILE_PATH = path.join(__dirname, '../admin.json');
const AUDIT_LOG_PATH = path.join(__dirname, '../audit.log');
const BACKUP_DIR = path.join(__dirname, '../../.deploy-backups');

async function rollbackAdminAndAudit() {
  console.log('[ROLLBACK] Starting admin & audit rollback...');

  // 1. Find latest backup
  if (await fs.pathExists(BACKUP_DIR)) {
    const files = await fs.readdir(BACKUP_DIR);
    const adminBackups = files.filter((f) => f.startsWith('admin.json.backup-')).sort().reverse();
    const auditBackups = files.filter((f) => f.startsWith('audit.log.backup-')).sort().reverse();

    if (adminBackups.length > 0) {
      const latestAdminBackup = path.join(BACKUP_DIR, adminBackups[0]);
      await fs.copy(latestAdminBackup, ADMIN_FILE_PATH);
      console.log(`[ROLLBACK] Restored admin.json from ${latestAdminBackup}`);
    }

    if (auditBackups.length > 0) {
      const latestAuditBackup = path.join(BACKUP_DIR, auditBackups[0]);
      await fs.copy(latestAuditBackup, AUDIT_LOG_PATH);
      console.log(`[ROLLBACK] Restored audit.log from ${latestAuditBackup}`);
    }
  }

  // 2. Optionally truncate or drop MySQL tables if DB available
  try {
    const db = new DatabaseClient({
      databaseUrl: process.env.DATABASE_URL || '',
      databaseHost: process.env.LOCAL_DATABASE_HOST || '127.0.0.1'
    });
    await db.init();
    await db.query('DROP TABLE IF EXISTS app_admin_audit_logs');
    await db.query('DROP TABLE IF EXISTS app_admins');
    await db.close();
    console.log('[ROLLBACK] Dropped app_admin_audit_logs and app_admins tables from MySQL.');
  } catch (err) {
    console.warn('[ROLLBACK] DB tables drop skipped (DB not reachable):', err.message);
  }

  console.log('[ROLLBACK] Rollback completed successfully.');
}

if (require.main === module) {
  rollbackAdminAndAudit().catch((err) => {
    console.error('[ROLLBACK] Error during rollback:', err);
    process.exit(1);
  });
}

module.exports = { rollbackAdminAndAudit };
