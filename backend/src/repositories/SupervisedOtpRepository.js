const bcrypt = require('bcryptjs');

const CONFIG_ID = 'default';

const normalizeDigits = (value) =>
  String(value ?? '')
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
    .trim();

const toIsoOrNull = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

class SupervisedOtpRepository {
  constructor(db) {
    this.db = db;
  }

  async ensureConfig() {
    await this.db.init();
    const [rows] = await this.db.query('SELECT * FROM app_supervised_otp_config WHERE id = ? LIMIT 1', [CONFIG_ID]);
    if (rows[0]) return rows[0];

    const now = new Date();
    await this.db.query(
      `INSERT INTO app_supervised_otp_config
        (id, enabled, code_hash, expires_at, max_uses, used_count, created_at, updated_at)
       VALUES (?, 0, NULL, NULL, NULL, 0, ?, ?)`,
      [CONFIG_ID, now, now]
    );
    return {
      id: CONFIG_ID,
      enabled: 0,
      code_hash: null,
      expires_at: null,
      max_uses: null,
      used_count: 0,
      created_at: now,
      updated_at: now
    };
  }

  sanitizeConfig(row) {
    return {
      enabled: Boolean(row?.enabled),
      hasCode: Boolean(row?.code_hash),
      expires_at: toIsoOrNull(row?.expires_at),
      max_uses: row?.max_uses == null ? null : Number(row.max_uses),
      used_count: Number(row?.used_count || 0),
      updated_at: toIsoOrNull(row?.updated_at)
    };
  }

  async getConfig() {
    return this.sanitizeConfig(await this.ensureConfig());
  }

  async updateConfig({ enabled, code, expires_at: expiresAt, max_uses: maxUses } = {}) {
    const current = await this.ensureConfig();
    const nextEnabled = typeof enabled === 'boolean' ? enabled : Boolean(current.enabled);
    const normalizedCode = normalizeDigits(code);
    const hasNewCode = normalizedCode.length > 0;
    if (hasNewCode && !/^[0-9]{4}$/.test(normalizedCode)) {
      const error = new Error('کد Supervised OTP باید دقیقاً ۴ رقم باشد.');
      error.statusCode = 400;
      throw error;
    }

    const nextExpiresAt = expiresAt ? new Date(expiresAt) : null;
    if (expiresAt && Number.isNaN(nextExpiresAt.getTime())) {
      const error = new Error('تاریخ انقضا معتبر نیست.');
      error.statusCode = 400;
      throw error;
    }

    let nextMaxUses = null;
    if (maxUses !== undefined && maxUses !== null && String(maxUses).trim() !== '') {
      nextMaxUses = Number.parseInt(String(maxUses), 10);
      if (!Number.isFinite(nextMaxUses) || nextMaxUses < 1) {
        const error = new Error('سقف استفاده باید عددی مثبت باشد.');
        error.statusCode = 400;
        throw error;
      }
    }

    const codeHash = hasNewCode ? await bcrypt.hash(normalizedCode, 10) : current.code_hash;
    const usedCount = hasNewCode ? 0 : Number(current.used_count || 0);
    const now = new Date();

    await this.db.query(
      `UPDATE app_supervised_otp_config
       SET enabled = ?, code_hash = ?, expires_at = ?, max_uses = ?, used_count = ?, updated_at = ?
       WHERE id = ?`,
      [nextEnabled ? 1 : 0, codeHash || null, nextExpiresAt, nextMaxUses, usedCount, now, CONFIG_ID]
    );

    return this.getConfig();
  }

  async resetUsedCount() {
    await this.ensureConfig();
    await this.db.query('UPDATE app_supervised_otp_config SET used_count = 0, updated_at = ? WHERE id = ?', [new Date(), CONFIG_ID]);
    return this.getConfig();
  }

  async deleteCode() {
    await this.ensureConfig();
    await this.db.query(
      'UPDATE app_supervised_otp_config SET enabled = 0, code_hash = NULL, expires_at = NULL, max_uses = NULL, used_count = 0, updated_at = ? WHERE id = ?',
      [new Date(), CONFIG_ID]
    );
    return this.getConfig();
  }

  async verifyAndConsume(code) {
    const normalizedCode = normalizeDigits(code);
    if (!/^[0-9]{4}$/.test(normalizedCode)) return { valid: false, reason: 'invalid_code' };

    const config = await this.ensureConfig();
    if (!config.enabled) return { valid: false, reason: 'disabled' };
    if (!config.code_hash) return { valid: false, reason: 'not_configured' };
    if (config.expires_at && new Date(config.expires_at).getTime() <= Date.now()) {
      return { valid: false, reason: 'expired' };
    }
    if (config.max_uses != null && Number(config.used_count || 0) >= Number(config.max_uses)) {
      return { valid: false, reason: 'max_uses_reached' };
    }

    const matches = await bcrypt.compare(normalizedCode, String(config.code_hash));
    if (!matches) return { valid: false, reason: 'invalid_code' };

    const [result] = await this.db.query(
      `UPDATE app_supervised_otp_config
       SET used_count = used_count + 1, updated_at = ?
       WHERE id = ?
         AND enabled = 1
         AND code_hash IS NOT NULL
         AND (expires_at IS NULL OR expires_at > ?)
         AND (max_uses IS NULL OR used_count < max_uses)`,
      [new Date(), CONFIG_ID, new Date()]
    );
    if (!result || result.affectedRows !== 1) return { valid: false, reason: 'not_available' };

    return { valid: true, method: 'supervised_otp' };
  }

  async recordUsage({ phone, userId = null, result }) {
    await this.db.init();
    await this.db.query(
      'INSERT INTO app_supervised_otp_usage (phone, user_id, result, used_at) VALUES (?, ?, ?, ?)',
      [String(phone || ''), userId ? String(userId) : null, String(result || 'unknown'), new Date()]
    );
  }

  async listUsage() {
    await this.db.init();
    const [rows] = await this.db.query(
      'SELECT id, phone, user_id, result, used_at FROM app_supervised_otp_usage ORDER BY used_at DESC, id DESC'
    );
    return rows;
  }
}

module.exports = { SupervisedOtpRepository };
