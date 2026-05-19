const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const sourcePath = path.join(__dirname, '..', 'data.json');
const databaseUrl = (process.env.DATABASE_URL || '').trim();

if (!databaseUrl.startsWith('mysql://')) {
  throw new Error('DATABASE_URL must be a mysql:// URL');
}

const parsed = new URL(databaseUrl);
const pool = mysql.createPool({
  host: parsed.hostname,
  port: parsed.port ? Number(parsed.port) : 3306,
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
  database: parsed.pathname.replace(/^\//, ''),
  waitForConnections: true,
  connectionLimit: 5,
  charset: 'utf8mb4'
});

const sanitizePhone = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/[-\s]/g, '');
  return /^09[0-9]{9}$/.test(trimmed) ? trimmed : null;
};

const toDate = (value) => {
  const ts = new Date(value || 0).getTime();
  return Number.isFinite(ts) && ts > 0 ? new Date(ts) : new Date();
};

async function main() {
  if (!fs.existsSync(sourcePath)) throw new Error(`Missing data file: ${sourcePath}`);
  const raw = fs.readFileSync(sourcePath, 'utf8');
  const data = JSON.parse(raw || '{}');

  const users = Array.isArray(data.users) ? data.users : [];
  const events = Array.isArray(data.events) ? data.events : [];
  const errors = Array.isArray(data.errors) ? data.errors : [];
  const conversations = Array.isArray(data.conversations) ? data.conversations : [];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (const u of users) {
      const userId = String(u?.user_id || '').trim();
      if (!userId) continue;
      await conn.query(
        `INSERT INTO app_users (user_id, name, age, phone, is_banned, registered_at, last_active)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name=VALUES(name), age=VALUES(age), phone=VALUES(phone), is_banned=VALUES(is_banned), registered_at=VALUES(registered_at), last_active=VALUES(last_active)`,
        [
          userId,
          typeof u?.name === 'string' && u.name.trim() ? u.name.trim() : 'کاربر',
          Number.isFinite(Number(u?.age)) ? Number(u.age) : 0,
          sanitizePhone(u?.phone),
          Boolean(u?.isBanned || u?.is_banned) ? 1 : 0,
          toDate(u?.registered_at),
          u?.last_active ? toDate(u.last_active) : null
        ]
      );
    }

    for (const e of events) {
      const userId = String(e?.user_id || '').trim();
      if (!userId) continue;
      const [existRows] = await conn.query('SELECT user_id FROM app_users WHERE user_id = ? LIMIT 1', [userId]);
      if (!existRows[0]) continue;

      let metadata = {};
      if (typeof e?.metadata === 'string' && e.metadata.trim()) {
        try { metadata = JSON.parse(e.metadata); } catch (_error) { metadata = { raw: e.metadata }; }
      }

      await conn.query(
        'INSERT INTO app_events (user_id, event_type, category, metadata, created_at) VALUES (?, ?, ?, ?, ?)',
        [userId, String(e?.event_type || 'unknown'), e?.category ? String(e.category) : null, JSON.stringify(metadata), toDate(e?.created_at)]
      );
    }

    for (const er of errors) {
      await conn.query(
        'INSERT INTO app_app_errors (error_type, endpoint, status_code, details, created_at) VALUES (?, ?, ?, ?, ?)',
        [
          String(er?.error_type || 'unknown'),
          er?.endpoint ? String(er.endpoint) : null,
          Number.isInteger(er?.status_code) ? er.status_code : null,
          typeof er?.details === 'string' ? er.details.slice(0, 3000) : JSON.stringify(er?.details || {}),
          toDate(er?.created_at)
        ]
      );
    }

    for (const c of conversations) {
      const userId = String(c?.user_id || '').trim();
      if (!userId) continue;
      const [existRows] = await conn.query('SELECT user_id FROM app_users WHERE user_id = ? LIMIT 1', [userId]);
      if (!existRows[0]) continue;

      const conversationId = typeof c?.conversation_id === 'string' && c.conversation_id.trim() ? c.conversation_id.trim() : 'default';
      const messages = Array.isArray(c?.messages) ? c.messages : [];

      await conn.query(
        `INSERT INTO app_conversations (user_id, conversation_id, title, pinned, messages, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE title=VALUES(title), pinned=VALUES(pinned), messages=VALUES(messages), created_at=VALUES(created_at), updated_at=VALUES(updated_at)`,
        [
          userId,
          conversationId,
          typeof c?.title === 'string' ? c.title.trim() : '',
          Boolean(c?.pinned) ? 1 : 0,
          JSON.stringify(messages),
          toDate(c?.created_at),
          toDate(c?.updated_at || c?.created_at)
        ]
      );
    }

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  console.log(`Migration completed: users=${users.length}, events=${events.length}, errors=${errors.length}, conversations=${conversations.length}`);
}

main()
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });

