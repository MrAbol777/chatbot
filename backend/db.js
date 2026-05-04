const fs = require('fs');
const path = require('path');

const DB_FILE_PATH = path.join(__dirname, 'data.json');

const createEmptyDB = () => ({
  users: [],
  events: [],
  errors: []
});

const ensureDBFile = () => {
  if (!fs.existsSync(DB_FILE_PATH)) {
    fs.writeFileSync(DB_FILE_PATH, JSON.stringify(createEmptyDB(), null, 2), 'utf8');
  }
};

const readDB = () => {
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
  const trimmed = value.trim();
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
    if (nextPhone) {
      existingUser.phone = nextPhone;
    }
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
  ensureUserExists,
  logEvent,
  logError,
  getStats
};
