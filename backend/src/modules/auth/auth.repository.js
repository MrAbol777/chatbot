const bcrypt = require('bcryptjs');
const { getIranMobileVariants } = require('../../shared/validators/phone.validator');
const { generateUserId } = require('../../repositories/helpers');

const DEFAULT_MAX_WRONG_ATTEMPTS = 5;
const OTP_BCRYPT_ROUNDS = 10;

function createAuthRepository({
  userRepository,
  dbPool,
  db,
  otpExpireSeconds = 120,
  settingsRepository,
  otpRequestWindowSeconds = 600,
  maxOtpRequestsPerWindow = 3,
  maxWrongAttempts = DEFAULT_MAX_WRONG_ATTEMPTS,
  nowMs = () => Date.now(),
  logger = console
}) {
  const otpStore = new Map();
  const otpRequestStore = new Map();
  const requestWindowMs = (Number.isFinite(Number(otpRequestWindowSeconds)) ? Number(otpRequestWindowSeconds) : 600) * 1000;
  const requestLimit = Number.isFinite(Number(maxOtpRequestsPerWindow)) ? Number(maxOtpRequestsPerWindow) : 3;
  let otpTablePromise = null;
  let otpRequestTablePromise = null;

  const getOtpExpireMs = async () => {
    if (!settingsRepository || typeof settingsRepository.get !== 'function') {
      return (Number.isFinite(Number(otpExpireSeconds)) ? Number(otpExpireSeconds) : 120) * 1000;
    }
    const value = await settingsRepository.get('auth.otp.expire_seconds');
    return (Number.isFinite(Number(value)) ? Number(value) : Number.isFinite(Number(otpExpireSeconds)) ? Number(otpExpireSeconds) : 120) * 1000;
  };

  const getOtpResendCooldownMs = async () => {
    if (!settingsRepository || typeof settingsRepository.get !== 'function') {
      return 0;
    }
    const value = await settingsRepository.get('auth.otp.resend_cooldown_ms');
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  };

  const ensureOtpTable = async () => {
    if (!dbPool || typeof dbPool.query !== 'function') return;
    if (otpTablePromise) return otpTablePromise;

    otpTablePromise = (async () => {
      await dbPool.query(`
        CREATE TABLE IF NOT EXISTS app_auth_otps (
          phone VARCHAR(32) PRIMARY KEY,
          code VARCHAR(100) NOT NULL,
          attempts INT NOT NULL DEFAULT 0,
          blocked_until DATETIME NULL,
          created_at DATETIME NOT NULL,
          expires_at DATETIME NOT NULL,
          INDEX idx_auth_otps_expires_at (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
      // Older deployments used VARCHAR(16) because the OTP itself was stored.
      // Widen the column so it can hold a bcrypt hash without a separate risky migration window.
      await dbPool.query('ALTER TABLE app_auth_otps MODIFY code VARCHAR(100) NOT NULL');
    })();

    return otpTablePromise;
  };

  const ensureOtpRequestTable = async () => {
    if (!dbPool || typeof dbPool.query !== 'function') return;
    if (otpRequestTablePromise) return otpRequestTablePromise;

    otpRequestTablePromise = dbPool.query(`
      CREATE TABLE IF NOT EXISTS app_auth_otp_request_limits (
        phone VARCHAR(32) PRIMARY KEY,
        request_count INT NOT NULL DEFAULT 0,
        window_started_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    return otpRequestTablePromise;
  };

  const withTransaction = async (work) => {
    if (!dbPool || typeof dbPool.query !== 'function') {
      throw new Error('Database pool is unavailable');
    }
    if (typeof dbPool.getConnection !== 'function') {
      return work(dbPool, false);
    }

    const connection = await dbPool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection, true);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  };

  const hashOtp = (code) => bcrypt.hash(String(code || '').trim(), OTP_BCRYPT_ROUNDS);
  const otpMatches = async (candidate, storedValue) => {
    const normalizedCandidate = String(candidate || '').trim();
    const stored = String(storedValue || '').trim();
    if (!normalizedCandidate || !stored) return false;
    if (stored.startsWith('$2')) return bcrypt.compare(normalizedCandidate, stored);
    // Transitional compatibility for rows written before this hardening change.
    // Only exact equality is accepted; legacy suffix/leading-zero matching is intentionally removed.
    return stored === normalizedCandidate;
  };

  const normalizeUser = (user) => {
    if (!user) return null;
    return {
      ...user,
      isBanned: Boolean(user.isBanned || user.is_banned)
    };
  };

  const findUserByPhone = async (phone) => {
    if (userRepository && typeof userRepository.findUserByPhone === 'function') {
      return normalizeUser(await userRepository.findUserByPhone(phone));
    }

    if (dbPool && typeof dbPool.query === 'function') {
      const [rows] = await dbPool.query('SELECT * FROM app_users WHERE phone = ? LIMIT 1', [phone]);
      return normalizeUser(rows[0] || null);
    }

    if (db && typeof db.findUserByPhone === 'function') {
      return normalizeUser(await db.findUserByPhone(phone));
    }

    return null;
  };

  const saveOtp = async (phone, code) => {
    const otpExpireMs = await getOtpExpireMs();
    const normalizedCode = String(code || '').trim();
    const codeHash = await hashOtp(normalizedCode);

    if (dbPool && typeof dbPool.query === 'function') {
      await ensureOtpTable();
      const variants = getIranMobileVariants(phone);
      const keys = variants.length ? variants : [phone];
      const createdAt = new Date(nowMs());
      const expiresAt = new Date(nowMs() + otpExpireMs);

      await withTransaction(async (connection) => {
        for (const variant of keys) {
          await connection.query(
            `INSERT INTO app_auth_otps (phone, code, attempts, blocked_until, created_at, expires_at)
             VALUES (?, ?, 0, NULL, ?, ?)
             ON DUPLICATE KEY UPDATE code = VALUES(code), attempts = 0, blocked_until = NULL, created_at = VALUES(created_at), expires_at = VALUES(expires_at)`,
            [variant, codeHash, createdAt, expiresAt]
          );
        }
      });
      return { expiresIn: Math.floor(otpExpireMs / 1000) };
    }

    const entry = {
      codeHash,
      createdAt: nowMs(),
      expiresAt: nowMs() + otpExpireMs,
      attempts: 0,
      blockedUntil: 0
    };
    const variants = getIranMobileVariants(phone);

    for (const variant of variants.length ? variants : [phone]) {
      otpStore.set(variant, { ...entry });
    }

    logger.log?.('[AuthRepository] saveOtp keys', { keys: variants.length ? variants : [phone], codeLength: normalizedCode.length });
    return { expiresIn: Math.floor(otpExpireMs / 1000) };
  };

  const checkAndRecordOtpRequest = async (phone) => {
    const variants = getIranMobileVariants(phone);
    const key = variants[0] || phone;
    const currentTime = nowMs();
    const resendCooldownMs = await getOtpResendCooldownMs();

    if (dbPool && typeof dbPool.query === 'function') {
      await ensureOtpRequestTable();
      return withTransaction(async (connection) => {
        const timestamp = new Date(currentTime);
        const initialUpdatedAt = new Date(Math.max(0, currentTime - resendCooldownMs - 1000));
        // Create the lock row first. Concurrent callers for the same phone then serialize here.
        await connection.query(
          `INSERT INTO app_auth_otp_request_limits (phone, request_count, window_started_at, updated_at)
           VALUES (?, 0, ?, ?)
           ON DUPLICATE KEY UPDATE phone = VALUES(phone)`,
          [key, timestamp, initialUpdatedAt]
        );
        const [rows] = await connection.query(
          'SELECT * FROM app_auth_otp_request_limits WHERE phone = ? LIMIT 1 FOR UPDATE',
          [key]
        );
        const row = rows[0];
        const windowStartMs = row ? new Date(row.window_started_at).getTime() : 0;
        const updatedAtMs = row ? new Date(row.updated_at).getTime() : 0;

        if (updatedAtMs > 0 && resendCooldownMs > 0 && currentTime - updatedAtMs < resendCooldownMs) {
          return {
            allowed: false,
            retryAfterSeconds: Math.max(1, Math.ceil((resendCooldownMs - (currentTime - updatedAtMs)) / 1000))
          };
        }

        const inWindow = windowStartMs > 0 && currentTime - windowStartMs < requestWindowMs;
        const currentCount = inWindow ? Number(row?.request_count || 0) : 0;
        if (currentCount >= requestLimit) {
          return {
            allowed: false,
            retryAfterSeconds: Math.max(1, Math.ceil((requestWindowMs - (currentTime - windowStartMs)) / 1000))
          };
        }

        if (inWindow) {
          await connection.query(
            'UPDATE app_auth_otp_request_limits SET request_count = request_count + 1, updated_at = ? WHERE phone = ?',
            [timestamp, key]
          );
        } else {
          await connection.query(
            'UPDATE app_auth_otp_request_limits SET request_count = 1, window_started_at = ?, updated_at = ? WHERE phone = ?',
            [timestamp, timestamp, key]
          );
        }

        return { allowed: true, retryAfterSeconds: 0 };
      });
    }

    const entry = otpRequestStore.get(key);
    if (entry && resendCooldownMs > 0 && currentTime - entry.updatedAt < resendCooldownMs) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((resendCooldownMs - (currentTime - entry.updatedAt)) / 1000)
      };
    }
    if (entry && currentTime - entry.windowStartedAt < requestWindowMs) {
      if (entry.count >= requestLimit) {
        return {
          allowed: false,
          retryAfterSeconds: Math.ceil((requestWindowMs - (currentTime - entry.windowStartedAt)) / 1000)
        };
      }
      otpRequestStore.set(key, { ...entry, count: entry.count + 1, updatedAt: currentTime });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    otpRequestStore.set(key, { count: 1, windowStartedAt: currentTime, updatedAt: currentTime });
    return { allowed: true, retryAfterSeconds: 0 };
  };

  const verifyOtp = async (phone, code) => {
    const otpExpireMs = await getOtpExpireMs();
    const candidateCode = String(code || '').trim();

    if (dbPool && typeof dbPool.query === 'function') {
      await ensureOtpTable();
      const variants = getIranMobileVariants(phone);
      const keys = variants.length ? variants : [phone];
      const placeholders = keys.map(() => '?').join(',');

      return withTransaction(async (connection) => {
        const [rows] = await connection.query(
          `SELECT * FROM app_auth_otps WHERE phone IN (${placeholders}) FOR UPDATE`,
          keys
        );
        const currentTime = nowMs();
        const activeRows = rows.filter((row) => new Date(row.expires_at).getTime() >= currentTime);
        const row = activeRows[0] || rows[0] || null;

        if (!row) return { valid: false, reason: 'not_found' };

        if (row.blocked_until && new Date(row.blocked_until).getTime() > currentTime) {
          return {
            valid: false,
            reason: 'too_many_attempts',
            retryAfterSeconds: Math.ceil((new Date(row.blocked_until).getTime() - currentTime) / 1000)
          };
        }

        if (new Date(row.expires_at).getTime() < currentTime) {
          await connection.query(`DELETE FROM app_auth_otps WHERE phone IN (${placeholders})`, keys);
          return { valid: false, reason: 'expired' };
        }

        const matches = await otpMatches(candidateCode, row.code);
        if (!matches) {
          const attempts = Number(row.attempts || 0) + 1;
          if (attempts >= maxWrongAttempts) {
            const blockedUntil = new Date(currentTime + otpExpireMs);
            await connection.query(
              `UPDATE app_auth_otps SET attempts = ?, blocked_until = ? WHERE phone IN (${placeholders})`,
              [attempts, blockedUntil, ...keys]
            );
            return { valid: false, reason: 'too_many_attempts', retryAfterSeconds: Math.ceil(otpExpireMs / 1000) };
          }

          await connection.query(
            `UPDATE app_auth_otps SET attempts = ? WHERE phone IN (${placeholders})`,
            [attempts, ...keys]
          );
          return {
            valid: false,
            reason: 'invalid_code',
            remainingAttempts: Math.max(0, maxWrongAttempts - attempts)
          };
        }

        await connection.query(`DELETE FROM app_auth_otps WHERE phone IN (${placeholders})`, keys);
        return { valid: true };
      });
    }

    const variants = getIranMobileVariants(phone);
    const matchedKey = variants.find((variant) => otpStore.has(variant));
    const lookupKey = matchedKey || phone;
    const entry = otpStore.get(lookupKey);

    if (!entry) return { valid: false, reason: 'not_found' };

    const currentTime = nowMs();
    if (entry.blockedUntil && currentTime < entry.blockedUntil) {
      return {
        valid: false,
        reason: 'too_many_attempts',
        retryAfterSeconds: Math.ceil((entry.blockedUntil - currentTime) / 1000)
      };
    }

    if (currentTime > entry.expiresAt) {
      for (const variant of variants) otpStore.delete(variant);
      return { valid: false, reason: 'expired' };
    }

    const matches = await bcrypt.compare(candidateCode, entry.codeHash);
    if (!matches) {
      entry.attempts += 1;
      if (entry.attempts >= maxWrongAttempts) {
        entry.blockedUntil = currentTime + otpExpireMs;
        for (const variant of variants) otpStore.set(variant, { ...entry });
        return { valid: false, reason: 'too_many_attempts', retryAfterSeconds: Math.ceil(otpExpireMs / 1000) };
      }

      for (const variant of variants) otpStore.set(variant, { ...entry });
      return {
        valid: false,
        reason: 'invalid_code',
        remainingAttempts: Math.max(0, maxWrongAttempts - entry.attempts)
      };
    }

    for (const variant of variants) otpStore.delete(variant);
    return { valid: true };
  };

  const createUser = async (profile) => {
    if (userRepository && typeof userRepository.ensureUserExists === 'function') {
      return userRepository.ensureUserExists(profile);
    }

    if (db && typeof db.ensureUserExists === 'function') {
      return db.ensureUserExists(profile);
    }

    if (dbPool && typeof dbPool.query === 'function') {
      const timestamp = new Date();
      if (!profile.phone) throw new Error('PHONE_REQUIRED_FOR_USER');
      const userId = generateUserId();
      await dbPool.query(
        `INSERT INTO app_users (user_id, name, age, phone, is_banned, registered_at, last_active)
         VALUES (?, ?, ?, ?, 0, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), age = VALUES(age), phone = VALUES(phone), last_active = VALUES(last_active)`,
        [userId, profile.name, Number(profile.age) || 0, profile.phone || null, timestamp, timestamp]
      );
      return userId;
    }

    throw new Error('No db wrapper or dbPool was provided to auth repository');
  };

  return {
    findUserByPhone,
    checkAndRecordOtpRequest,
    saveOtp,
    verifyOtp,
    createUser
  };
}

module.exports = { createAuthRepository };
