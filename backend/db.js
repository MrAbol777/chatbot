const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const AUDIT_LOG_PATH = path.join(__dirname, 'audit.log');
const DAY_MS = 24 * 60 * 60 * 1000;

const databaseUrl = typeof process.env.DATABASE_URL === 'string' ? process.env.DATABASE_URL.trim() : '';
if (!databaseUrl || !databaseUrl.startsWith('mysql://')) {
  throw new Error('DATABASE_URL must be set to a valid mysql:// URL');
}

const parsed = new URL(databaseUrl);
const pool = mysql.createPool({
  host: parsed.hostname,
  port: parsed.port ? Number(parsed.port) : 3306,
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
  database: parsed.pathname.replace(/^\//, ''),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
});

let initPromise = null;
const initDb = async () => {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_users (
        user_id VARCHAR(191) PRIMARY KEY,
        name VARCHAR(191) NOT NULL,
        age INT NOT NULL DEFAULT 0,
        phone VARCHAR(32) NULL,
        is_banned TINYINT(1) NOT NULL DEFAULT 0,
        registered_at DATETIME NOT NULL,
        last_active DATETIME NULL,
        INDEX idx_users_phone (phone)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_events (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(191) NOT NULL,
        event_type VARCHAR(100) NOT NULL,
        category VARCHAR(100) NULL,
        metadata JSON NULL,
        created_at DATETIME NOT NULL,
        INDEX idx_events_user_id (user_id),
        INDEX idx_events_type (event_type),
        INDEX idx_events_created (created_at),
        CONSTRAINT fk_events_user FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_app_errors (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        error_type VARCHAR(100) NOT NULL,
        endpoint VARCHAR(255) NULL,
        status_code INT NULL,
        details TEXT NOT NULL,
        created_at DATETIME NOT NULL,
        INDEX idx_errors_type (error_type),
        INDEX idx_errors_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_conversations (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(191) NOT NULL,
        conversation_id VARCHAR(191) NOT NULL,
        title VARCHAR(255) NULL,
        pinned TINYINT(1) NOT NULL DEFAULT 0,
        messages JSON NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        UNIQUE KEY uq_user_conversation (user_id, conversation_id),
        INDEX idx_conversations_user (user_id),
        INDEX idx_conversations_updated (updated_at),
        CONSTRAINT fk_conversations_user FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  })();

  return initPromise;
};

const nowIso = () => new Date().toISOString();
const toDate = (value) => {
  const ts = new Date(value || 0).getTime();
  return Number.isFinite(ts) && ts > 0 ? new Date(ts) : new Date();
};
const sanitizeAge = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const sanitizeName = (value) => (typeof value === 'string' && value.trim() ? value.trim() : 'کاربر');
const sanitizePhone = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/[-\s]/g, '');
  return /^09[0-9]{9}$/.test(trimmed) ? trimmed : null;
};
const generateUserId = () => `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
const normalizeConversationId = (value) => (typeof value === 'string' && value.trim() ? value.trim() : 'default');
const safeJsonArray = (value) => (Array.isArray(value) ? value : []);

const findUserByPhone = async (phone) => {
  await initDb();
  const normalizedPhone = sanitizePhone(phone);
  if (!normalizedPhone) return null;
  const [rows] = await pool.query('SELECT * FROM app_users WHERE phone = ? LIMIT 1', [normalizedPhone]);
  return rows[0] || null;
};

const isUserBannedByPhone = async (phone) => Boolean((await findUserByPhone(phone))?.is_banned);

const ensureUserExists = async (profile = {}) => {
  await initDb();
  const incomingId = typeof profile.id === 'string' || typeof profile.id === 'number' ? String(profile.id).trim() : '';
  const userId = incomingId || generateUserId();
  const nextName = sanitizeName(profile.name);
  const nextAge = sanitizeAge(profile.age);
  const nextPhone = sanitizePhone(profile.phone);

  const [byIdRows] = await pool.query('SELECT * FROM app_users WHERE user_id = ? LIMIT 1', [userId]);
  const existingUserById = byIdRows[0] || null;
  const [byPhoneRows] = nextPhone ? await pool.query('SELECT * FROM app_users WHERE phone = ? LIMIT 1', [nextPhone]) : [[]];
  const existingUserByPhone = byPhoneRows[0] || null;

  if (existingUserById && existingUserByPhone && existingUserById.user_id !== existingUserByPhone.user_id) {
    const conflictError = new Error('این شماره موبایل قبلا برای حساب دیگری ثبت شده است.');
    conflictError.code = 'PHONE_ALREADY_IN_USE';
    conflictError.userId = existingUserByPhone.user_id;
    throw conflictError;
  }

  const existingUser = existingUserByPhone || existingUserById;
  const timestamp = new Date();

  if (existingUser) {
    await pool.query('UPDATE app_users SET name = ?, age = ?, phone = ?, last_active = ? WHERE user_id = ?', [nextName, nextAge, nextPhone, timestamp, existingUser.user_id]);
    return existingUser.user_id;
  }

  await pool.query(
    'INSERT INTO app_users (user_id, name, age, phone, is_banned, registered_at, last_active) VALUES (?, ?, ?, ?, 0, ?, ?)',
    [userId, nextName, nextAge, nextPhone, timestamp, timestamp]
  );
  return userId;
};

const logEvent = async (userId, eventType, category, metadata) => {
  await initDb();
  if (!userId || !eventType) return;
  const ts = new Date();
  await pool.query('INSERT INTO app_events (user_id, event_type, category, metadata, created_at) VALUES (?, ?, ?, ?, ?)', [String(userId), String(eventType), category ? String(category) : null, JSON.stringify(metadata || {}), ts]);
  await pool.query('UPDATE app_users SET last_active = ? WHERE user_id = ?', [ts, String(userId)]);
};

const logError = async (errorType, endpoint, statusCode, details) => {
  await initDb();
  await pool.query('INSERT INTO app_app_errors (error_type, endpoint, status_code, details, created_at) VALUES (?, ?, ?, ?, ?)', [
    errorType ? String(errorType) : 'unknown',
    endpoint ? String(endpoint) : null,
    Number.isInteger(statusCode) ? statusCode : null,
    typeof details === 'string' ? details.slice(0, 3000) : JSON.stringify(details || {}),
    new Date()
  ]);
};

const getConversationMessages = async (userId, conversationId) => {
  await initDb();
  const normalizedUserId = typeof userId === 'string' || typeof userId === 'number' ? String(userId) : '';
  const normalizedConversationId = normalizeConversationId(conversationId);
  const [rows] = await pool.query('SELECT messages FROM app_conversations WHERE user_id = ? AND conversation_id = ? LIMIT 1', [normalizedUserId, normalizedConversationId]);
  const raw = rows[0]?.messages;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return safeJsonArray(parsed)
    .filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string' && item.content.trim())
    .map((item) => ({ role: item.role, content: item.content }));
};

const saveConversationMessages = async (userId, conversationId, messages) => {
  await initDb();
  if (!userId) return;
  const safeMessages = Array.isArray(messages)
    ? messages.filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string' && item.content.trim()).slice(-100).map((item) => ({ role: item.role, content: item.content.trim() }))
    : [];
  const normalizedUserId = String(userId);
  const normalizedConversationId = normalizeConversationId(conversationId);
  const ts = new Date();

  await pool.query(
    `INSERT INTO app_conversations (user_id, conversation_id, title, pinned, messages, created_at, updated_at)
     VALUES (?, ?, '', 0, ?, ?, ?)
     ON DUPLICATE KEY UPDATE messages = VALUES(messages), updated_at = VALUES(updated_at)`,
    [normalizedUserId, normalizedConversationId, JSON.stringify(safeMessages), ts, ts]
  );
};

const readDB = async () => {
  await initDb();
  const [[users], [events], [errors], [conversations]] = await Promise.all([
    pool.query('SELECT * FROM app_users'),
    pool.query('SELECT * FROM app_events'),
    pool.query('SELECT * FROM app_app_errors'),
    pool.query('SELECT * FROM app_conversations')
  ]);
  return {
    users: users.map((u) => ({ ...u, isBanned: Boolean(u.is_banned) })),
    events: events.map((e) => ({ ...e, metadata: typeof e.metadata === 'string' ? e.metadata : JSON.stringify(e.metadata || {}) })),
    errors,
    conversations: conversations.map((c) => {
      const messages = typeof c.messages === 'string' ? JSON.parse(c.messages || '[]') : c.messages;
      return { ...c, messages: safeJsonArray(messages) };
    })
  };
};

const getStats = async () => {
  const data = await readDB();
  return {
    userCount: data.users.length,
    eventCount: data.events.length,
    errorCount: data.errors.length,
    conversationCount: data.conversations.length,
    latestUsers: data.users.slice(-5),
    latestErrors: data.errors.slice(-5),
    latestConversations: data.conversations.slice(-5).map((item) => ({ user_id: item.user_id, conversation_id: item.conversation_id, message_count: safeJsonArray(item.messages).length, updated_at: item.updated_at || null }))
  };
};

const getStartOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};
const getDateLabel = (date) => `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
const buildDailySeries = (days = 7) => {
  const safeDays = Math.max(1, Number.parseInt(String(days), 10) || 7);
  const todayStart = getStartOfToday();
  const start = todayStart - (safeDays - 1) * DAY_MS;
  const items = [];
  for (let i = 0; i < safeDays; i += 1) {
    const dayStart = start + i * DAY_MS;
    items.push({ date: getDateLabel(new Date(dayStart)), start: dayStart, end: dayStart + DAY_MS, count: 0 });
  }
  return items;
};

const getTotalUsers = async () => (await pool.query('SELECT COUNT(*) AS c FROM app_users'))[0][0].c;
const getActiveUsersToday = async () => (await pool.query("SELECT COUNT(DISTINCT user_id) AS c FROM app_events WHERE event_type='message_sent' AND created_at >= ?", [new Date(Date.now() - DAY_MS)]))[0][0].c;
const getApiCallsToday = async () => (await pool.query("SELECT COUNT(*) AS c FROM app_events WHERE event_type='message_sent' AND created_at >= ?", [new Date(getStartOfToday())]))[0][0].c;
const getErrorCountToday = async () => (await pool.query('SELECT COUNT(*) AS c FROM app_app_errors WHERE created_at >= ?', [new Date(getStartOfToday())]))[0][0].c;

const getUserGrowth = async (days = 7) => {
  const [rows] = await pool.query('SELECT registered_at FROM app_users');
  const series = buildDailySeries(days);
  for (const row of rows) {
    const ts = new Date(row.registered_at || 0).getTime();
    const day = series.find((item) => ts >= item.start && ts < item.end);
    if (day) day.count += 1;
  }
  return series.map(({ date, count }) => ({ date, users: count }));
};
const getApiUsage = async (days = 7) => {
  const [rows] = await pool.query("SELECT created_at FROM app_events WHERE event_type='message_sent'");
  const series = buildDailySeries(days);
  for (const row of rows) {
    const ts = new Date(row.created_at || 0).getTime();
    const day = series.find((item) => ts >= item.start && ts < item.end);
    if (day) day.count += 1;
  }
  return series.map(({ date, count }) => ({ date, calls: count }));
};
const getErrorDistribution = async () => {
  const [rows] = await pool.query('SELECT error_type, COUNT(*) AS count FROM app_app_errors GROUP BY error_type');
  return rows;
};

const getRecentAuditLogs = (limit = 10) => {
  const safeLimit = Math.min(100, Math.max(1, Number.parseInt(String(limit), 10) || 10));
  if (!fs.existsSync(AUDIT_LOG_PATH)) return [];
  return fs.readFileSync(AUDIT_LOG_PATH, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch (_error) { return null; }
  }).filter(Boolean).reverse().slice(0, safeLimit);
};

const listUsersWithConversationStats = async ({ search = '', phone = '', isBanned, page = 1, pageSize = 20 } = {}) => {
  const data = await readDB();
  const normalizedSearch = String(search || '').trim().toLowerCase();
  const normalizedSearchPhone = sanitizePhone(search);
  const normalizedPhone = sanitizePhone(phone);
  const safePage = Math.max(1, Number.parseInt(String(page), 10) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number.parseInt(String(pageSize), 10) || 20));

  const byUser = new Map();
  for (const c of data.conversations) {
    const key = String(c.user_id || '');
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key).push(c);
  }

  let users = data.users.map((user) => {
    const userConversations = byUser.get(String(user.user_id)) || [];
    const lastConversationTime = userConversations.map((item) => item.updated_at || item.created_at || null).filter(Boolean).sort().pop();
    return { ...user, isBanned: Boolean(user.is_banned), conversationCount: userConversations.length, last_activity: user.last_active || lastConversationTime || user.registered_at || null };
  });

  if (normalizedSearch) users = users.filter((user) => {
    const byName = String(user.name || '').toLowerCase().includes(normalizedSearch);
    const byId = String(user.user_id || '').toLowerCase().includes(normalizedSearch);
    const userPhone = sanitizePhone(user.phone) || '';
    const byPhone = normalizedSearchPhone ? userPhone.includes(normalizedSearchPhone) : false;
    return byName || byId || byPhone;
  });
  if (normalizedPhone) users = users.filter((user) => sanitizePhone(user.phone) === normalizedPhone);
  if (typeof isBanned === 'boolean') users = users.filter((user) => Boolean(user.isBanned) === isBanned);

  users.sort((a, b) => new Date(b.last_activity || 0).getTime() - new Date(a.last_activity || 0).getTime());
  const total = users.length;
  const start = (safePage - 1) * safePageSize;
  return { items: users.slice(start, start + safePageSize), total, page: safePage, pageSize: safePageSize };
};

const setUserBanStatus = async (userId, isBanned) => {
  await pool.query('UPDATE app_users SET is_banned = ? WHERE user_id = ?', [Boolean(isBanned) ? 1 : 0, String(userId)]);
  const [rows] = await pool.query('SELECT * FROM app_users WHERE user_id = ? LIMIT 1', [String(userId)]);
  return rows[0] || null;
};

const deleteUserAndConversations = async (userId) => {
  const targetId = String(userId);
  const [existingRows] = await pool.query('SELECT user_id FROM app_users WHERE user_id = ? LIMIT 1', [targetId]);
  if (!existingRows[0]) return { deleted: false, conversationCount: 0 };
  const [convCount] = await pool.query('SELECT COUNT(*) AS c FROM app_conversations WHERE user_id = ?', [targetId]);
  await pool.query('DELETE FROM app_users WHERE user_id = ?', [targetId]);
  return { deleted: true, conversationCount: convCount[0].c };
};

const getUserFullProfile = async (userId) => {
  const targetId = String(userId);
  const [users] = await pool.query('SELECT * FROM app_users WHERE user_id = ? LIMIT 1', [targetId]);
  const user = users[0];
  if (!user) return null;
  const [conversationsRows] = await pool.query('SELECT * FROM app_conversations WHERE user_id = ? ORDER BY updated_at DESC', [targetId]);
  const conversations = conversationsRows.map((item) => {
    const messages = typeof item.messages === 'string' ? JSON.parse(item.messages || '[]') : item.messages;
    return { conversation_id: item.conversation_id, title: item.title || `گفتگو ${item.conversation_id}`, message_count: safeJsonArray(messages).length, last_message_at: item.updated_at || item.created_at || null, messages: safeJsonArray(messages) };
  });
  return { ...user, isBanned: Boolean(user.is_banned), conversations };
};

const getUserConversations = async (userId) => {
  const targetId = String(userId || '').trim();
  if (!targetId) return [];
  const [rows] = await pool.query('SELECT * FROM app_conversations WHERE user_id = ? ORDER BY updated_at DESC', [targetId]);
  return rows.map((item) => {
    const messages = typeof item.messages === 'string' ? JSON.parse(item.messages || '[]') : item.messages;
    return { conversation_id: String(item.conversation_id || 'default'), title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : null, pinned: Boolean(item.pinned), created_at: item.created_at || nowIso(), updated_at: item.updated_at || item.created_at || nowIso(), messages: safeJsonArray(messages) };
  });
};

const replaceUserConversations = async (userId, conversations) => {
  const targetId = String(userId || '').trim();
  if (!targetId) return 0;
  const safeConversations = Array.isArray(conversations) ? conversations : [];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM app_conversations WHERE user_id = ?', [targetId]);
    for (const item of safeConversations) {
      const conversationId = typeof item?.conversation_id === 'string' && item.conversation_id.trim() ? item.conversation_id.trim() : 'default';
      const safeMessages = Array.isArray(item?.messages) ? item.messages.filter((msg) => msg && (msg.role === 'user' || msg.role === 'assistant') && typeof msg.content === 'string' && msg.content.trim()).slice(-200).map((msg) => ({ role: msg.role, content: msg.content.trim(), timestamp: typeof msg.timestamp === 'string' ? msg.timestamp : nowIso() })) : [];
      await conn.query('INSERT INTO app_conversations (user_id, conversation_id, title, pinned, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [targetId, conversationId, typeof item?.title === 'string' ? item.title.trim() : '', Boolean(item?.pinned) ? 1 : 0, JSON.stringify(safeMessages), toDate(item?.created_at || nowIso()), toDate(item?.updated_at || item?.created_at || nowIso())]);
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  return safeConversations.length;
};

module.exports = {
  readDB,
  ensureDBFile: () => {},
  ensureUserExists,
  findUserByPhone,
  logEvent,
  logError,
  getStats,
  getConversationMessages,
  saveConversationMessages,
  isUserBannedByPhone,
  listUsersWithConversationStats,
  setUserBanStatus,
  deleteUserAndConversations,
  getUserFullProfile,
  getUserConversations,
  replaceUserConversations,
  getTotalUsers,
  getActiveUsersToday,
  getApiCallsToday,
  getErrorCountToday,
  getUserGrowth,
  getApiUsage,
  getErrorDistribution,
  getRecentAuditLogs,
  dbInfo: { mode: 'mysql', filePath: null }
};

