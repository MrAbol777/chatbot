const crypto = require('crypto');

const sha256 = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

function createSessionRepository({
  db,
  csrfSecret,
  idleTimeoutSeconds,
  absoluteTimeoutSeconds,
  now = () => new Date(),
  touchIntervalMs = 5 * 60 * 1000
}) {
  if (!db || typeof db.query !== 'function') throw new Error('db is required for session repository');
  if (!csrfSecret) throw new Error('csrfSecret is required for session repository');

  const deriveCsrfToken = (rawSessionToken) =>
    crypto.createHmac('sha256', csrfSecret).update(`danoa-csrf:${rawSessionToken}`).digest('base64url');

  const create = async ({ userId, provider = 'viana', previousRawToken = '' }) => {
    const rawToken = randomToken();
    const csrfToken = deriveCsrfToken(rawToken);
    const timestamp = now();
    const absoluteExpiresAt = new Date(timestamp.getTime() + absoluteTimeoutSeconds * 1000);
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      if (previousRawToken) {
        await connection.query('DELETE FROM app_auth_sessions WHERE session_hash = ?', [sha256(previousRawToken)]);
      }
      await connection.query(
        `INSERT INTO app_auth_sessions
          (session_hash, csrf_token_hash, user_id, provider, created_at, last_activity_at, absolute_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [sha256(rawToken), sha256(csrfToken), String(userId), provider, timestamp, timestamp, absoluteExpiresAt]
      );
      await connection.commit();
      return { rawToken, csrfToken, absoluteExpiresAt };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  };

  const resolve = async (rawToken, { touch = true } = {}) => {
    if (!rawToken) return null;
    const [rows] = await db.query(
      `SELECT s.*, u.name, u.age, u.phone, u.is_banned,
              i.grade, i.gender
         FROM app_auth_sessions s
         JOIN app_users u ON u.user_id = s.user_id
         LEFT JOIN app_viana_identities i
           ON i.user_id = s.user_id AND i.provider = s.provider
        WHERE s.session_hash = ?
        LIMIT 1`,
      [sha256(rawToken)]
    );
    const row = rows[0];
    if (!row) return null;

    const current = now();
    const absoluteExpiry = new Date(row.absolute_expires_at);
    const lastActivity = new Date(row.last_activity_at);
    const idleExpiresAt = new Date(lastActivity.getTime() + idleTimeoutSeconds * 1000);
    if (
      !Number.isFinite(absoluteExpiry.getTime()) ||
      !Number.isFinite(idleExpiresAt.getTime()) ||
      current >= absoluteExpiry ||
      current >= idleExpiresAt
    ) {
      await db.query('DELETE FROM app_auth_sessions WHERE session_hash = ?', [sha256(rawToken)]);
      return null;
    }
    if (row.is_banned) return null;

    if (touch && current.getTime() - lastActivity.getTime() >= touchIntervalMs) {
      await db.query(
        'UPDATE app_auth_sessions SET last_activity_at = ? WHERE session_hash = ? AND last_activity_at = ?',
        [current, sha256(rawToken), row.last_activity_at]
      );
    }

    return {
      userId: String(row.user_id),
      provider: row.provider,
      csrfToken: deriveCsrfToken(rawToken),
      csrfTokenHash: row.csrf_token_hash,
      profile: {
        id: String(row.user_id),
        name: row.name,
        age: Number(row.age || 0),
        ...(row.phone ? { phone: row.phone } : {}),
        ...(row.grade !== null && row.grade !== undefined ? { grade: row.grade } : {}),
        ...(row.gender ? { gender: row.gender } : {})
      }
    };
  };

  const revoke = async (rawToken) => {
    if (!rawToken) return false;
    const [result] = await db.query('DELETE FROM app_auth_sessions WHERE session_hash = ?', [sha256(rawToken)]);
    return Number(result.affectedRows || 0) > 0;
  };

  const validateCsrf = (session, suppliedToken) => {
    if (!session || !suppliedToken) return false;
    const expected = Buffer.from(String(session.csrfTokenHash), 'hex');
    const actual = Buffer.from(sha256(suppliedToken), 'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  };

  return { create, deriveCsrfToken, resolve, revoke, validateCsrf };
}

module.exports = { createSessionRepository, randomToken, sha256 };
