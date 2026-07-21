'use strict';

const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
dotenv.config({ path: path.join(__dirname, '../.env') });

const MODEL_KEY = 'metis_kling_v25_turbo_pro';

function databaseOptions(value) {
  const url = new URL(String(value || ''));
  if (!['mysql:', 'mariadb:'].includes(url.protocol) || !url.pathname || url.pathname === '/') throw new Error('DATABASE_URL is required.');
  return { host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.slice(1) };
}

async function main({ env = process.env } = {}) {
  if (env.ALLOW_VIDEO_MODEL_ACTIVATION !== '1') throw new Error('ALLOW_VIDEO_MODEL_ACTIVATION=1 is required.');
  const connection = await mysql.createConnection(databaseOptions(env.DATABASE_URL));
  try {
    const [result] = await connection.query("UPDATE app_video_models SET is_active=1, supports_text_to_video=1, supports_image_to_video=0, updated_at=NOW() WHERE internal_key=?", [MODEL_KEY]);
    if (result.affectedRows !== 1) throw new Error('Configured video model was not found. Apply migrations first.');
    console.log(JSON.stringify({ action: 'model-activation-complete', modelInternalKey: MODEL_KEY, imageToVideoEnabled: false }));
  } finally { await connection.end(); }
}

if (require.main === module) main().catch((error) => { console.error(`Video model activation refused: ${error.message}`); process.exitCode = 1; });
module.exports = { MODEL_KEY, databaseOptions, main };
