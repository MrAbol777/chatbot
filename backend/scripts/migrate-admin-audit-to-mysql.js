const path = require('path');
const fs = require('fs-extra');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

const { DatabaseClient } = require('../src/repositories/DatabaseClient');
const AdminRepository = require('../src/repositories/AdminRepository');

const ADMIN_FILE_PATH = path.join(__dirname, '../admin.json');
const AUDIT_LOG_PATH = path.join(__dirname, '../audit.log');
const BACKUP_DIR = path.join(__dirname, '../../.deploy-backups');

async function migrateAdminAndAudit() {
  console.log('[MIGRATE] Starting admin & audit log migration to MySQL...');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  await fs.ensureDir(BACKUP_DIR);

  // 1. Safe backup
  if (await fs.pathExists(ADMIN_FILE_PATH)) {
    const backupAdminPath = path.join(BACKUP_DIR, `admin.json.backup-${timestamp}`);
    await fs.copy(ADMIN_FILE_PATH, backupAdminPath);
    console.log(`[MIGRATE] Backed up admin.json -> ${backupAdminPath}`);
  }
  if (await fs.pathExists(AUDIT_LOG_PATH)) {
    const backupAuditPath = path.join(BACKUP_DIR, `audit.log.backup-${timestamp}`);
    await fs.copy(AUDIT_LOG_PATH, backupAuditPath);
    console.log(`[MIGRATE] Backed up audit.log -> ${backupAuditPath}`);
  }

  // 2. Connect DB
  const db = new DatabaseClient({
    databaseUrl: process.env.DATABASE_URL || '',
    databaseHost: process.env.LOCAL_DATABASE_HOST || '127.0.0.1'
  });
  await db.init();
  const adminRepo = new AdminRepository(db);

  // 3. Migrate admins from admin.json
  if (await fs.pathExists(ADMIN_FILE_PATH)) {
    const raw = await fs.readFile(ADMIN_FILE_PATH, 'utf8');
    if (raw.trim()) {
      const admins = JSON.parse(raw);
      if (Array.isArray(admins)) {
        for (const admin of admins) {
          if (admin.username && admin.password_hash) {
            await adminRepo.createOrUpdate({
              id: admin.id || '1',
              username: admin.username,
              password_hash: admin.password_hash,
              role: admin.role || 'superadmin',
              created_at: admin.createdAt || new Date(),
              updated_at: new Date()
            });
            console.log(`[MIGRATE] Migrated admin user: ${admin.username}`);
          }
        }
      }
    }
  }

  // 4. Migrate audit logs from audit.log
  if (await fs.pathExists(AUDIT_LOG_PATH)) {
    const raw = await fs.readFile(AUDIT_LOG_PATH, 'utf8');
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    let count = 0;
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        if (item.action) {
          await db.query(
            `INSERT INTO app_admin_audit_logs (admin_username, action, target, details, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            [
              item.adminUsername || item.admin || null,
              item.action,
              item.target || null,
              item.details ? JSON.stringify(item.details) : null,
              item.timestamp ? new Date(item.timestamp) : new Date()
            ]
          );
          count++;
        }
      } catch (_err) {
        // Skip malformed log lines
      }
    }
    console.log(`[MIGRATE] Migrated ${count} audit log records into app_admin_audit_logs.`);
  }

  await db.close();
  console.log('[MIGRATE] Admin & audit migration completed successfully.');
}

if (require.main === module) {
  migrateAdminAndAudit().catch((err) => {
    console.error('[MIGRATE] Error during migration:', err);
    process.exit(1);
  });
}

module.exports = { migrateAdminAndAudit };
