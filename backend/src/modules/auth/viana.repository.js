const { generateUserId } = require('../../repositories/helpers');
const { normalizeIranMobileToLocal, isValidIranMobileLocal } = require('../../shared/validators/phone.validator');
const { sha256 } = require('./session.repository');

const profileFields = (profile) => [
  profile.firstName, profile.lastName, profile.dateOfBirth, profile.grade, profile.gender,
  profile.studentPhone, profile.guardianPhone, profile.points
];
const asDateOnly = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10));

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
        `SELECT * FROM app_viana_oauth_flows WHERE state_hash = ? AND browser_binding_hash = ? LIMIT 1 FOR UPDATE`,
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

  const updateIdentity = async (connection, row, { profile, age, displayName }) => {
    const timestamp = now();
    await connection.query(
      `UPDATE app_viana_identities
          SET first_name = ?, last_name = ?, date_of_birth = ?, grade = ?, gender = ?, student_phone = ?,
              guardian_phone = ?, points = ?, synced_at = ?, updated_at = ?, last_login_at = ?
        WHERE identity_id = ?`,
      [...profileFields(profile), timestamp, timestamp, timestamp, row.identity_id]
    );
    await connection.query('UPDATE app_users SET name = ?, age = ?, last_active = ? WHERE user_id = ?', [displayName, age, timestamp, row.user_id]);
    return { kind: 'linked', userId: String(row.user_id), isNewUser: false };
  };

  const insertIdentity = async (connection, { clientId, environmentKey, subject, userId, profile, age, displayName, isNewUser }) => {
    const timestamp = now();
    if (isNewUser) {
      await connection.query(
        `INSERT INTO app_users (user_id, name, age, phone, is_banned, registered_at, last_active)
         VALUES (?, ?, ?, NULL, 0, ?, ?)`,
        [userId, displayName, age, timestamp, timestamp]
      );
    } else {
      await connection.query('UPDATE app_users SET name = ?, age = ?, last_active = ? WHERE user_id = ?', [displayName, age, timestamp, userId]);
    }
    await connection.query(
      `INSERT INTO app_viana_identities
        (provider, environment_key, client_id, subject, user_id, first_name, last_name, date_of_birth, grade,
         gender, student_phone, guardian_phone, points, synced_at, created_at, updated_at, last_login_at)
       VALUES ('viana', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [environmentKey, clientId, subject, userId, ...profileFields(profile), timestamp, timestamp, timestamp, timestamp]
    );
    return { kind: 'linked', userId: String(userId), isNewUser };
  };

  const findCandidateUsers = async (connection, profile) => {
    const phones = [profile.guardianPhone, profile.studentPhone]
      .map((phone) => normalizeIranMobileToLocal(phone || ''))
      .filter((phone) => isValidIranMobileLocal(phone));
    const uniquePhones = [...new Set(phones)];
    if (!uniquePhones.length) return [];
    const [rows] = await connection.query(
      `SELECT user_id, phone FROM app_users WHERE is_banned = 0 AND phone IN (${uniquePhones.map(() => '?').join(',')}) LIMIT 3`,
      uniquePhones
    );
    return rows;
  };

  const resolveIdentity = async ({ clientId, environmentKey, profile, age, displayName }, retry = true) => {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query(
        `SELECT * FROM app_viana_identities WHERE provider = 'viana' AND client_id = ? AND subject = ? LIMIT 1 FOR UPDATE`,
        [clientId, profile.sub]
      );
      if (rows[0]) {
        if (rows[0].environment_key !== environmentKey) {
          const error = new Error('Viana identity environment is immutable.');
          error.code = 'VIANA_ENVIRONMENT_MISMATCH';
          throw error;
        }
        const result = await updateIdentity(connection, rows[0], { profile, age, displayName });
        await connection.commit();
        return result;
      }
      const candidates = await findCandidateUsers(connection, profile);
      if (candidates.length === 1) {
        await connection.commit();
        return { kind: 'link_required', candidateUserId: String(candidates[0].user_id) };
      }
      if (candidates.length > 1) {
        await connection.commit();
        return { kind: 'link_conflict' };
      }
      const result = await insertIdentity(connection, {
        clientId, environmentKey, subject: profile.sub, userId: generateUserId({ isGuest: false }), profile, age, displayName, isNewUser: true
      });
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      if (retry && error?.code === 'ER_DUP_ENTRY') return resolveIdentity({ clientId, environmentKey, profile, age, displayName }, false);
      throw error;
    } finally {
      connection.release();
    }
  };

  const createLinkRequest = async ({ rawToken, clientId, environmentKey, profile, candidateUserId, ttlMs = 10 * 60 * 1000 }) => {
    const timestamp = now();
    await db.query(
      `INSERT INTO app_viana_link_requests
        (link_hash, environment_key, client_id, subject, candidate_user_id, first_name, last_name, date_of_birth,
         grade, gender, student_phone, guardian_phone, points, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sha256(rawToken), environmentKey, clientId, profile.sub, candidateUserId, ...profileFields(profile), timestamp, new Date(timestamp.getTime() + ttlMs)]
    );
    await db.query('DELETE FROM app_viana_link_requests WHERE expires_at < ? LIMIT 250', [timestamp]);
  };

  const getLinkRequest = async (rawToken) => {
    if (!rawToken) return null;
    const [rows] = await db.query(
      `SELECT r.link_hash, r.candidate_user_id, r.expires_at, u.phone
         FROM app_viana_link_requests r
         JOIN app_users u ON u.user_id = r.candidate_user_id
        WHERE r.link_hash = ? LIMIT 1`,
      [sha256(rawToken)]
    );
    const row = rows[0];
    if (!row || now().getTime() >= new Date(row.expires_at).getTime()) return null;
    return { candidateUserId: String(row.candidate_user_id), phone: String(row.phone || '') };
  };

  const completeLinkRequest = async ({ rawToken, environmentKey, clientId }) => {
    if (!rawToken) return { valid: false, reason: 'missing' };
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query('SELECT * FROM app_viana_link_requests WHERE link_hash = ? LIMIT 1 FOR UPDATE', [sha256(rawToken)]);
      const request = rows[0];
      if (!request || now().getTime() >= new Date(request.expires_at).getTime() || request.environment_key !== environmentKey || request.client_id !== clientId) {
        await connection.commit();
        return { valid: false, reason: 'expired' };
      }
      const profile = {
        sub: request.subject, firstName: request.first_name, lastName: request.last_name, dateOfBirth: asDateOnly(request.date_of_birth),
        grade: request.grade, gender: request.gender, studentPhone: request.student_phone, guardianPhone: request.guardian_phone, points: request.points
      };
      const age = (() => {
        const [year, month, day] = profile.dateOfBirth.split('-').map(Number);
        const today = now();
        return today.getUTCFullYear() - year - ((today.getUTCMonth() + 1 < month || (today.getUTCMonth() + 1 === month && today.getUTCDate() < day)) ? 1 : 0);
      })();
      const displayName = `${profile.firstName} ${profile.lastName}`.trim();
      const [identities] = await connection.query(
        `SELECT * FROM app_viana_identities WHERE provider = 'viana' AND client_id = ? AND subject = ? LIMIT 1 FOR UPDATE`,
        [clientId, profile.sub]
      );
      let result;
      if (identities[0]) {
        if (String(identities[0].user_id) !== String(request.candidate_user_id)) {
          await connection.commit();
          return { valid: false, reason: 'already_linked' };
        }
        result = await updateIdentity(connection, identities[0], { profile, age, displayName });
      } else {
        result = await insertIdentity(connection, {
          clientId, environmentKey, subject: profile.sub, userId: String(request.candidate_user_id), profile, age, displayName, isNewUser: false
        });
      }
      await connection.query('DELETE FROM app_viana_link_requests WHERE link_hash = ?', [sha256(rawToken)]);
      await connection.commit();
      return { valid: true, userId: result.userId };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  };

  return { completeLinkRequest, consumeFlow, createLinkRequest, getLinkRequest, resolveIdentity, saveFlow };
}

module.exports = { createVianaRepository };
