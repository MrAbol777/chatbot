const { generateUserId } = require('../../repositories/helpers');
const { sha256 } = require('./session.repository');

function createVianaRepository({ db, now = () => new Date() }) {
  const saveFlow = async ({ state, browserBinding, codeVerifier, nonce, environmentKey, ttlMs = 10 * 60 * 1000 }) => {
    const timestamp = now();
    const expiresAt = new Date(timestamp.getTime() + ttlMs);
    await db.query(
      `INSERT INTO app_viana_oauth_flows
        (state_hash, browser_binding_hash, code_verifier, nonce, environment_key, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [sha256(state), sha256(browserBinding), codeVerifier, nonce, environmentKey, timestamp, expiresAt]
    );
    await db.query('DELETE FROM app_viana_oauth_flows WHERE expires_at < ? LIMIT 250', [timestamp]);
    return { expiresAt };
  };

  const consumeFlow = async ({ state, browserBinding, environmentKey }) => {
    if (!state || !browserBinding) return { valid: false, reason: 'missing' };
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query(
        `SELECT * FROM app_viana_oauth_flows
          WHERE state_hash = ? AND browser_binding_hash = ?
          LIMIT 1 FOR UPDATE`,
        [sha256(state), sha256(browserBinding)]
      );
      const row = rows[0];
      if (!row) {
        await connection.commit();
        return { valid: false, reason: 'unknown_or_replayed' };
      }
      await connection.query('DELETE FROM app_viana_oauth_flows WHERE state_hash = ?', [sha256(state)]);
      await connection.commit();
      if (row.environment_key !== environmentKey) return { valid: false, reason: 'environment_mismatch' };
      if (now().getTime() >= new Date(row.expires_at).getTime()) return { valid: false, reason: 'expired' };
      return { valid: true, codeVerifier: row.code_verifier, nonce: row.nonce };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  };

  const updateExistingIdentity = async (connection, row, { profile, environmentKey, age, displayName }) => {
    if (row.environment_key !== environmentKey) {
      const error = new Error('Viana identity environment is immutable.');
      error.code = 'VIANA_ENVIRONMENT_MISMATCH';
      throw error;
    }
    const timestamp = now();
    await connection.query(
      `UPDATE app_viana_identities
          SET first_name = ?, last_name = ?, date_of_birth = ?, grade = ?, gender = ?,
              updated_at = ?, last_login_at = ?
        WHERE identity_id = ?`,
      [
        profile.firstName,
        profile.lastName,
        profile.dateOfBirth,
        profile.grade,
        profile.gender,
        timestamp,
        timestamp,
        row.identity_id
      ]
    );
    await connection.query('UPDATE app_users SET name = ?, age = ?, last_active = ? WHERE user_id = ?', [
      displayName,
      age,
      timestamp,
      row.user_id
    ]);
    return { userId: String(row.user_id), isNewUser: false };
  };

  const findOrCreateIdentity = async ({ clientId, environmentKey, profile, age, displayName }, retry = true) => {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query(
        `SELECT * FROM app_viana_identities
          WHERE provider = 'viana' AND client_id = ? AND subject = ?
          LIMIT 1 FOR UPDATE`,
        [clientId, profile.id]
      );
      if (rows[0]) {
        const result = await updateExistingIdentity(connection, rows[0], {
          profile,
          environmentKey,
          age,
          displayName
        });
        await connection.commit();
        return result;
      }

const userId = generateUserId();
      const timestamp = now();
      await connection.query(
        `INSERT INTO app_users (user_id, name, age, phone, is_banned, registered_at, last_active)
         VALUES (?, ?, ?, NULL, 0, ?, ?)`,
        [userId, displayName, age, timestamp, timestamp]
      );
      await connection.query(
        `INSERT INTO app_viana_identities
          (provider, environment_key, client_id, subject, user_id, first_name, last_name,
           date_of_birth, grade, gender, created_at, updated_at, last_login_at)
         VALUES ('viana', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          environmentKey,
          clientId,
          profile.id,
          userId,
          profile.firstName,
          profile.lastName,
          profile.dateOfBirth,
          profile.grade,
          profile.gender,
          timestamp,
          timestamp,
          timestamp
        ]
      );
      await connection.commit();
      return { userId, isNewUser: true };
    } catch (error) {
      await connection.rollback();
      if (retry && error?.code === 'ER_DUP_ENTRY') {
        return findOrCreateIdentity({ clientId, environmentKey, profile, age, displayName }, false);
      }
      throw error;
    } finally {
      connection.release();
    }
  };

  return { consumeFlow, findOrCreateIdentity, saveFlow };
}

module.exports = { createVianaRepository };
