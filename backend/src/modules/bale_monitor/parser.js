const INTERVAL_RE = /^(\d+)([smh])$/i;

function parseCommand(text) {
  if (typeof text !== 'string' || !text.trim().startsWith('/')) return null;
  const parts = text.trim().split(/\s+/);
  return { name: parts[0].toLowerCase(), args: parts.slice(1) };
}

function validateUrl(raw) {
  const value = String(raw || '').trim();
  if (!/^https?:\/\//i.test(value)) {
    throw new Error('URL باید با http:// یا https:// شروع شود.');
  }
  return value;
}

function parseInterval(raw, min, max) {
  const m = String(raw || '').trim().match(INTERVAL_RE);
  if (!m) throw new Error('فرمت interval نامعتبر است. مثال: 30s یا 5m یا 1h');
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const factor = unit === 's' ? 1 : unit === 'm' ? 60 : 3600;
  const seconds = n * factor;
  if (seconds < min || seconds > max) {
    throw new Error('Interval باید بین 10 ثانیه تا 24 ساعت باشد.');
  }
  return seconds;
}

function parseDailyTime(raw) {
  const value = String(raw || '').trim();
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(value)) {
    throw new Error('فرمت زمان نامعتبر است. مثال: 14:30');
  }
  return value;
}

function parseId(raw) {
  const id = Number(String(raw || '').trim());
  if (!Number.isInteger(id) || id <= 0) throw new Error('id نامعتبر است.');
  return id;
}

module.exports = { parseCommand, validateUrl, parseInterval, parseDailyTime, parseId };
