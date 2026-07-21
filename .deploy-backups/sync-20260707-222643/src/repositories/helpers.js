const fs = require('fs');
const { randomUUID } = require('crypto');

const DAY_MS = 24 * 60 * 60 * 1000;

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
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GUEST_USER_PREFIX = 'guest:';

const normalizeUuid = (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return UUID_PATTERN.test(text) ? text : '';
};

const generateUserId = ({ isGuest, uuid } = {}) => {
  const id = normalizeUuid(uuid) || randomUUID();
  return isGuest ? `${GUEST_USER_PREFIX}${id}` : id;
};
const normalizeConversationId = (value) => (typeof value === 'string' && value.trim() ? value.trim() : 'default');
const safeJsonArray = (value) => (Array.isArray(value) ? value : []);

const getStartOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};
const getDateLabel = (date) =>
  `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
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

const parseAuditLogFile = (auditLogPath, limit = null) => {
  if (!fs.existsSync(auditLogPath)) return [];
  const items = fs
    .readFileSync(auditLogPath, 'utf8')
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
    .reverse();

  if (limit === null || limit === undefined) return items;
  const safeLimit = Math.min(100, Math.max(1, Number.parseInt(String(limit), 10) || 10));
  return items.slice(0, safeLimit);
};

module.exports = {
  DAY_MS,
  nowIso,
  toDate,
  sanitizeAge,
  sanitizeName,
  sanitizePhone,
  GUEST_USER_PREFIX,
  generateUserId,
  normalizeUuid,
  normalizeConversationId,
  safeJsonArray,
  getStartOfToday,
  buildDailySeries,
  parseAuditLogFile
};
