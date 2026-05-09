const fs = require('fs');
const path = require('path');

const DEFAULT_DB_FILE_PATH = path.join(__dirname, 'data.json');
const FALLBACK_DB_FILE_PATH = '/tmp/hemraz-data.json';

const createEmptyDB = () => ({
  users: [],
  events: [],
  errors: []
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
      errors: Array.isArray(inMemoryDB.errors) ? inMemoryDB.errors : []
    };
  }
  ensureDBFile();

  try {
    const raw = fs.readFileSync(DB_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw || '{}');

    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
      errors: Array.isArray(parsed.errors) ? parsed.errors : []
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
      errors: Array.isArray(data.errors) ? data.errors : []
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

const generateUserId = () => `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;

const ensureUserExists = (profile = {}) => {
  const data = readDB();
  const timestamp = nowIso();

  const incomingId =
    typeof profile.id === 'string' || typeof profile.id === 'number' ? String(profile.id).trim() : '';
  const userId = incomingId || generateUserId();

  const nextName = sanitizeName(profile.name);
  const nextAge = sanitizeAge(profile.age);
  const nextPhone = sanitizePhone(profile.phone);

  const existingUser = data.users.find((item) => item.user_id === userId);

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
    latestUsers: data.users.slice(-5),
    latestErrors: data.errors.slice(-5)
  };
};

ensureDBFile();

module.exports = {
  readDB,
  ensureDBFile,
  ensureUserExists,
  logEvent,
  logError,
  getStats,
  dbInfo: {
    mode: DB_STORAGE_MODE,
    filePath: DB_FILE_PATH
  }
};
