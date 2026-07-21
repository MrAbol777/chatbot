'use strict';

const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const { databaseOptions } = require('./admin-enable-video-model');
dotenv.config({ path: path.join(__dirname, '../.env') });

function args(values = process.argv.slice(2)) {
  const read = (name) => values.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
  const plan = String(read('plan') || '').trim();
  const rawLimit = read('daily') ?? read('limit');
  const limit = Number(rawLimit);
  if (!/^[a-z0-9_-]{1,64}$/i.test(plan) || !Number.isSafeInteger(limit) || limit < 0) throw new Error('Use --plan=<existing-plan> --daily=<non-negative-integer>.');
  return { plan, limit };
}

async function main({ env = process.env, argv = process.argv.slice(2) } = {}) {
  if (env.ALLOW_VIDEO_QUOTA_CONFIGURATION !== '1') throw new Error('ALLOW_VIDEO_QUOTA_CONFIGURATION=1 is required.');
  const { plan, limit } = args(argv);
  const connection = await mysql.createConnection(databaseOptions(env.DATABASE_URL));
  try {
    const [result] = await connection.query('UPDATE app_plans SET video_limit=?, updated_at=NOW() WHERE id=?', [limit, plan]);
    if (result.affectedRows !== 1) throw new Error('Plan was not found; no plan was created.');
    console.log(JSON.stringify({ action: 'video-quota-configured', plan, dailyVideoLimit: limit }));
  } finally { await connection.end(); }
}

if (require.main === module) main().catch((error) => { console.error(`Video quota configuration refused: ${error.message}`); process.exitCode = 1; });
module.exports = { args, main };
