const fs = require('fs');
const path = require('path');

const DEFAULT_DB_FILE_PATH = path.join(__dirname, 'data.json');
const FALLBACK_DB_FILE_PATH = '/tmp/hemraz-data.json';
const AUDIT_LOG_PATH = path.join(__dirname, 'audit.log');

const createEmptyDB = () => ({
  users: [],
  events: [],
  errors: [],
  conversations: []
});

let inMemoryDB = createEmptyDB();

const ensureParentDir = (filePath) => {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
};

const isWritableFilePath = (filePath) => {
  try {
    ensureParentDir(filePath);
    const probe = `${filePath}.write-test`;
    fs.writeFileSync(probe, 'ok', 'utf8');
    fs.unlinkSync(probe);
    return true;
  } catch (_error) {
    return false;
  }
};

const resolveDbFilePath = () => {
  const envPath = typeof process.env.DB_FILE_PATH === 'string' ? process.env.DB_FILE_PATH.trim() : '';
  const databaseUrl = typeof process.env.DATABASE_URL === 'string' ? process.env.DATABASE_URL.trim() : '';
  const databaseUrlPath = databaseUrl.startsWith('file:') ? databaseUrl.slice('file:'.length).trim() : '';
  const normalizedDatabaseUrlPath = databaseUrlPath
    ? path.isAbsolute(databaseUrlPath)
      ? databaseUrlPath
      : path.join(__dirname, databaseUrlPath)
    : '';
  const candidates = [envPath, normalizedDatabaseUrlPath, DEFAULT_DB_FILE_PATH, FALLBACK_DB_FILE_PATH].filter(
    Boolean
  );

  for (const candidate of candidates) {
    if (isWritableFilePath(candidate)) {
      return candidate;
    }
  }

  // Last resort to avoid crashing at boot in strict/containerized environments.
  return null;
};

const DB_FILE_PATH = resolveDbFilePath();
const DB_STORAGE_MODE = DB_FILE_PATH ? 'file' : 'memory';

const ensureDBFile = () => {
  if (!DB_FILE_PATH) {
    return;
  }
  ensureParentDir(DB_FILE_PATH);
  if (!fs.existsSync(DB_FILE_PATH)) {
    fs.writeFileSync(DB_FILE_PATH, JSON.stringify(createEmptyDB(), null, 2), 'utf8');
  }
};

const readDB = () => {
  if (!DB_FILE_PATH) {
    return {
      users: Array.isArray(inMemoryDB.users) ? inMemoryDB.users : [],
      events: Array.isArray(inMemoryDB.events) ? inMemoryDB.events : [],
      errors: Array.isArray(inMemoryDB.errors) ? inMemoryDB.errors : [],
      conversations: Array.isArray(inMemoryDB.conversations) ? inMemoryDB.conversations : []
    };
  }
  ensureDBFile();

  try {
    const raw = fs.readFileSync(DB_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw || '{}');

    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
      errors: Array.isArray(parsed.errors) ? parsed.errors : [],
      conversations: Array.isArray(parsed.conversations) ? parsed.conversations : []
    };
  } catch (_error) {
    const fallback = createEmptyDB();
    fs.writeFileSync(DB_FILE_PATH, JSON.stringify(fallback, null, 2), 'utf8');
    return fallback;
  }
};

const writeDB = (data) => {
  if (!DB_FILE_PATH) {
    inMemoryDB = {
      users: Array.isArray(data.users) ? data.users : [],
      events: Array.isArray(data.events) ? data.events : [],
      errors: Array.isArray(data.errors) ? data.errors : [],
      conversations: Array.isArray(data.conversations) ? data.conversations : []
    };
    return;
  }
  fs.writeFileSync(DB_FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
};

const nowIso = () => new Date().toISOString();

const sanitizeAge = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const sanitizeName = (value) => {
  if (typeof value !== 'string') {
    return 'کاربر';
  }
  const trimmed = value.trim();
  return trimmed || 'کاربر';
};

const sanitizePhone = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().replace(/[-\s]/g, '');
  return /^09[0-9]{9}$/.test(trimmed) ? trimmed : null;
};

const findUserByPhone = (phone) => {
  const normalizedPhone = sanitizePhone(phone);
  if (!normalizedPhone) {
    return null;
  }

  const data = readDB();
  return data.users.find((item) => sanitizePhone(item?.phone) === normalizedPhone) || null;
};

const isUserBannedByPhone = (phone) => {
  const user = findUserByPhone(phone);
  return Boolean(user?.isBanned);
};

const generateUserId = () => `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
const normalizeConversationId = (value) => {
  if (typeof value !== 'string') {
    return 'default';
  }
  const trimmed = value.trim();
  return trimmed || 'default';
};

const ensureUserExists = (profile = {}) => {
  const data = readDB();
  const timestamp = nowIso();

  const incomingId =
    typeof profile.id === 'string' || typeof profile.id === 'number' ? String(profile.id).trim() : '';
  const userId = incomingId || generateUserId();

  const nextName = sanitizeName(profile.name);
  const nextAge = sanitizeAge(profile.age);
  const nextPhone = sanitizePhone(profile.phone);

  const existingUserById = data.users.find((item) => item.user_id === userId);
  const existingUserByPhone = nextPhone
    ? data.users.find((item) => sanitizePhone(item?.phone) === nextPhone)
    : null;
  const hasPhoneConflict =
    Boolean(existingUserById) &&
    Boolean(existingUserByPhone) &&
    existingUserById.user_id !== existingUserByPhone.user_id;

  if (hasPhoneConflict) {
    const conflictError = new Error('این شماره موبایل قبلا برای حساب دیگری ثبت شده است.');
    conflictError.code = 'PHONE_ALREADY_IN_USE';
    conflictError.userId = existingUserByPhone.user_id;
    throw conflictError;
  }

  const existingUser = existingUserByPhone || existingUserById;

  if (existingUser) {
    existingUser.name = nextName;
    existingUser.age = nextAge;
    existingUser.phone = nextPhone;
    existingUser.last_active = timestamp;
  } else {
    data.users.push({
      user_id: userId,
      name: nextName,
      age: nextAge,
      phone: nextPhone,
      registered_at: timestamp,
      last_active: timestamp
    });
  }

  writeDB(data);
  return userId;
};

const logEvent = (userId, eventType, category, metadata) => {
  if (!userId || !eventType) {
    return;
  }

  const data = readDB();
  const timestamp = nowIso();

  data.events.push({
    user_id: String(userId),
    event_type: String(eventType),
    category: category ? String(category) : null,
    metadata: JSON.stringify(metadata || {}),
    created_at: timestamp
  });

  const existingUser = data.users.find((item) => item.user_id === String(userId));
  if (existingUser) {
    existingUser.last_active = timestamp;
  }

  writeDB(data);
};

const logError = (errorType, endpoint, statusCode, details) => {
  const data = readDB();

  data.errors.push({
    error_type: errorType ? String(errorType) : 'unknown',
    endpoint: endpoint ? String(endpoint) : null,
    status_code: Number.isInteger(statusCode) ? statusCode : null,
    details: typeof details === 'string' ? details.slice(0, 3000) : JSON.stringify(details || {}),
    created_at: nowIso()
  });

  writeDB(data);
};

const getStats = () => {
  const data = readDB();

  return {
    userCount: data.users.length,
    eventCount: data.events.length,
    errorCount: data.errors.length,
    conversationCount: data.conversations.length,
    latestUsers: data.users.slice(-5),
    latestErrors: data.errors.slice(-5),
    latestConversations: data.conversations.slice(-5).map((item) => ({
      user_id: item.user_id,
      conversation_id: item.conversation_id,
      message_count: Array.isArray(item.messages) ? item.messages.length : 0,
      updated_at: item.updated_at || null
    }))
  };
};

const DAY_MS = 24 * 60 * 60 * 1000;

const toValidTime = (value) => {
  const ts = new Date(value || 0).getTime();
  return Number.isFinite(ts) ? ts : 0;
};

const getStartOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};

const getDateLabel = (date) => {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const buildDailySeries = (days = 7) => {
  const safeDays = Math.max(1, Number.parseInt(String(days), 10) || 7);
  const todayStart = getStartOfToday();
  const start = todayStart - (safeDays - 1) * DAY_MS;
  const items = [];

  for (let i = 0; i < safeDays; i += 1) {
    const dayStart = start + i * DAY_MS;
    items.push({
      date: getDateLabel(new Date(dayStart)),
      start: dayStart,
      end: dayStart + DAY_MS,
      count: 0
    });
  }
  return items;
};

const getTotalUsers = () => {
  const data = readDB();
  return data.users.length;
};

const getActiveUsersToday = () => {
  const data = readDB();
  const last24h = Date.now() - DAY_MS;
  const activeUserIds = new Set();

  for (const event of data.events) {
    if (event.event_type !== 'message_sent') continue;
    if (toValidTime(event.created_at) >= last24h) {
      activeUserIds.add(String(event.user_id || ''));
    }
  }

  return activeUserIds.size;
};

const getApiCallsToday = () => {
  const data = readDB();
  const startOfToday = getStartOfToday();
  return data.events.filter((event) => event.event_type === 'message_sent' && toValidTime(event.created_at) >= startOfToday)
    .length;
};

const getErrorCountToday = () => {
  const data = readDB();
  const startOfToday = getStartOfToday();
  return data.errors.filter((item) => toValidTime(item.created_at) >= startOfToday).length;
};

const getUserGrowth = (days = 7) => {
  const data = readDB();
  const series = buildDailySeries(days);

  for (const user of data.users) {
    const ts = toValidTime(user.registered_at);
    const day = series.find((item) => ts >= item.start && ts < item.end);
    if (day) day.count += 1;
  }

  return series.map(({ date, count }) => ({ date, users: count }));
};

const getApiUsage = (days = 7) => {
  const data = readDB();
  const series = buildDailySeries(days);

  for (const event of data.events) {
    if (event.event_type !== 'message_sent') continue;
    const ts = toValidTime(event.created_at);
    const day = series.find((item) => ts >= item.start && ts < item.end);
    if (day) day.count += 1;
  }

  return series.map(({ date, count }) => ({ date, calls: count }));
};

const getErrorDistribution = () => {
  const data = readDB();
  const distribution = new Map();

  for (const item of data.errors) {
    const key = item.error_type ? String(item.error_type) : 'unknown';
    distribution.set(key, (distribution.get(key) || 0) + 1);
  }

  return [...distribution.entries()].map(([error_type, count]) => ({ error_type, count }));
};

const getRecentAuditLogs = (limit = 10) => {
  const safeLimit = Math.min(100, Math.max(1, Number.parseInt(String(limit), 10) || 10));
  if (!fs.existsSync(AUDIT_LOG_PATH)) {
    return [];
  }

  const raw = fs.readFileSync(AUDIT_LOG_PATH, 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_error) {
        return null;
      }
    })
    .filter(Boolean)
    .reverse()
    .slice(0, safeLimit);
};

const getConversationMessages = (userId, conversationId) => {
  const data = readDB();
  const normalizedUserId = typeof userId === 'string' || typeof userId === 'number' ? String(userId) : '';
  const normalizedConversationId = normalizeConversationId(conversationId);
  const conversation = data.conversations.find(
    (item) => item.user_id === normalizedUserId && item.conversation_id === normalizedConversationId
  );

  if (!conversation || !Array.isArray(conversation.messages)) {
    return [];
  }

  return conversation.messages
    .filter(
      (item) =>
        item &&
        (item.role === 'user' || item.role === 'assistant') &&
        typeof item.content === 'string' &&
        item.content.trim().length > 0
    )
    .map((item) => ({
      role: item.role,
      content: item.content
    }));
};

const saveConversationMessages = (userId, conversationId, messages) => {
  if (!userId) {
    return;
  }

  const safeMessages = Array.isArray(messages)
    ? messages
        .filter(
          (item) =>
            item &&
            (item.role === 'user' || item.role === 'assistant') &&
            typeof item.content === 'string' &&
            item.content.trim().length > 0
        )
        .slice(-100)
        .map((item) => ({
          role: item.role,
          content: item.content.trim()
        }))
    : [];

  const data = readDB();
  const timestamp = nowIso();
  const normalizedUserId = String(userId);
  const normalizedConversationId = normalizeConversationId(conversationId);
  const existingConversation = data.conversations.find(
    (item) => item.user_id === normalizedUserId && item.conversation_id === normalizedConversationId
  );

  if (existingConversation) {
    existingConversation.messages = safeMessages;
    existingConversation.updated_at = timestamp;
  } else {
    data.conversations.push({
      user_id: normalizedUserId,
      conversation_id: normalizedConversationId,
      messages: safeMessages,
      created_at: timestamp,
      updated_at: timestamp
    });
  }

  writeDB(data);
};

const listUsersWithConversationStats = ({
  search = '',
  phone = '',
  isBanned,
  page = 1,
  pageSize = 20
} = {}) => {
  const data = readDB();
  const normalizedSearch = String(search || '').trim().toLowerCase();
  const normalizedPhone = sanitizePhone(phone);
  const safePage = Math.max(1, Number.parseInt(String(page), 10) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number.parseInt(String(pageSize), 10) || 20));

  const conversationMap = new Map();
  for (const conversation of data.conversations) {
    const key = String(conversation.user_id || '');
    if (!conversationMap.has(key)) {
      conversationMap.set(key, []);
    }
    conversationMap.get(key).push(conversation);
  }

  let users = data.users.map((user) => {
    const userConversations = conversationMap.get(String(user.user_id)) || [];
    const conversationCount = userConversations.length;
    const lastConversationTime = userConversations
      .map((item) => item.updated_at || item.created_at || null)
      .filter(Boolean)
      .sort()
      .pop();
    return {
      ...user,
      isBanned: Boolean(user.isBanned),
      conversationCount,
      last_activity: user.last_active || lastConversationTime || user.registered_at || null
    };
  });

  if (normalizedSearch) {
    users = users.filter((user) => String(user.name || '').toLowerCase().includes(normalizedSearch));
  }

  if (normalizedPhone) {
    users = users.filter((user) => sanitizePhone(user.phone) === normalizedPhone);
  }

  if (typeof isBanned === 'boolean') {
    users = users.filter((user) => Boolean(user.isBanned) === isBanned);
  }

  users.sort((a, b) => new Date(b.last_activity || 0).getTime() - new Date(a.last_activity || 0).getTime());

  const total = users.length;
  const start = (safePage - 1) * safePageSize;
  const items = users.slice(start, start + safePageSize);

  return { items, total, page: safePage, pageSize: safePageSize };
};

const setUserBanStatus = (userId, isBanned) => {
  const data = readDB();
  const target = data.users.find((user) => String(user.user_id) === String(userId));
  if (!target) {
    return null;
  }
  target.isBanned = Boolean(isBanned);
  writeDB(data);
  return target;
};

const deleteUserAndConversations = (userId) => {
  const data = readDB();
  const targetId = String(userId);
  const userIndex = data.users.findIndex((user) => String(user.user_id) === targetId);
  if (userIndex < 0) {
    return { deleted: false, conversationCount: 0 };
  }
  data.users.splice(userIndex, 1);
  const beforeCount = data.conversations.length;
  data.conversations = data.conversations.filter((conversation) => String(conversation.user_id) !== targetId);
  const conversationCount = beforeCount - data.conversations.length;
  writeDB(data);
  return { deleted: true, conversationCount };
};

const getUserFullProfile = (userId) => {
  const data = readDB();
  const targetId = String(userId);
  const user = data.users.find((item) => String(item.user_id) === targetId);
  if (!user) {
    return null;
  }
  const conversations = data.conversations
    .filter((item) => String(item.user_id) === targetId)
    .map((item) => ({
      conversation_id: item.conversation_id,
      title: item.title || `گفتگو ${item.conversation_id}`,
      message_count: Array.isArray(item.messages) ? item.messages.length : 0,
      last_message_at: item.updated_at || item.created_at || null,
      messages: Array.isArray(item.messages) ? item.messages : []
    }))
    .sort((a, b) => new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime());

  return {
    ...user,
    isBanned: Boolean(user.isBanned),
    conversations
  };
};

ensureDBFile();

module.exports = {
  readDB,
  ensureDBFile,
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
  getTotalUsers,
  getActiveUsersToday,
  getApiCallsToday,
  getErrorCountToday,
  getUserGrowth,
  getApiUsage,
  getErrorDistribution,
  getRecentAuditLogs,
  dbInfo: {
    mode: DB_STORAGE_MODE,
    filePath: DB_FILE_PATH
  }
};
