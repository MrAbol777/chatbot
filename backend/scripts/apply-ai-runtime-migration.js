'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function applyAiRuntimeMigration() {
  const value = String(process.env.DATABASE_URL || '').trim();
  if (!value.startsWith('mysql://')) throw new Error('DATABASE_URL must be a MySQL URL.');

  const url = new URL(value);
  const connection = await mysql.createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1)
  });

  try {
    const sql = fs.readFileSync(
      path.join(__dirname, '../migrations/049_replace_unavailable_ai_preview_model.sql'),
      'utf8'
    );
    const [result] = await connection.query(sql);
    console.log(`[AI_RUNTIME] migration applied; updated settings: ${Number(result.affectedRows || 0)}`);
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  applyAiRuntimeMigration().catch((error) => {
    console.error('[AI_RUNTIME] migration failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { applyAiRuntimeMigration };
