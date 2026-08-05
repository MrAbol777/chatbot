const path = require('path');
const dotenv = require('dotenv');
const { DatabaseClient } = require('../src/repositories/DatabaseClient');
const { ensureAuthSessionSchema } = require('../src/modules/auth/auth.schema');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function ensureColumn(db, table, column, definition) {
  const [rows] = await db.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
  if (!rows.length) await db.query(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

async function main() {
  const db = new DatabaseClient({ databaseUrl: process.env.DATABASE_URL });
  try {
    await db.init();
    await ensureAuthSessionSchema(db);
    await ensureColumn(db, 'app_viana_oauth_flows', 'nonce', "nonce VARCHAR(128) NOT NULL DEFAULT '' AFTER code_verifier");
    await ensureColumn(db, 'app_viana_identities', 'student_phone', 'student_phone VARCHAR(32) NULL AFTER gender');
    await ensureColumn(db, 'app_viana_identities', 'guardian_phone', 'guardian_phone VARCHAR(32) NULL AFTER student_phone');
    await ensureColumn(db, 'app_viana_identities', 'points', 'points INT NULL AFTER guardian_phone');
    await ensureColumn(db, 'app_viana_identities', 'synced_at', 'synced_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) AFTER points');
    console.log('[migration 043] Viana student sync and confirmed account linking are ready.');
  } finally {
    await db.pool.end();
  }
}

main().catch((error) => {
  console.error('[migration 043] Failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
