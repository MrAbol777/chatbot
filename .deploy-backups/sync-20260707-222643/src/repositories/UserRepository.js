const {
  sanitizePhone,
  sanitizeName,
  sanitizeAge,
  generateUserId,
  safeJsonArray
} = require('./helpers');

const DEFAULT_CHILD_SAFETY_LEVEL = 'standard';

const sanitizeSafetyLevel = (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return ['strict', 'standard', 'relaxed'].includes(text) ? text : DEFAULT_CHILD_SAFETY_LEVEL;
};

class UserRepository {
  constructor(db) {
    this.db = db;
  }

  async findUserByPhone(phone) {
    await this.db.init();
    const normalizedPhone = sanitizePhone(phone);
    if (!normalizedPhone) return null;
    const [rows] = await this.db.query(
      `SELECT
         u.*,
         c.child_id,
         c.guardian_id,
         c.avatar,
         c.grade,
         c.safety_level,
         c.guardian_consent_at,
         c.guardian_consent_version,
         g.phone AS guardian_phone
       FROM app_users u
       LEFT JOIN app_children c ON c.child_id = u.user_id
       LEFT JOIN app_guardians g ON g.guardian_id = c.guardian_id
       WHERE u.phone = ?
       ORDER BY u.last_active DESC, u.registered_at DESC
       LIMIT 1`,
      [normalizedPhone]
    );
    return rows[0] || null;
  }

  async findUserById(userId) {
    await this.db.init();
    const targetId = typeof userId === 'string' || typeof userId === 'number' ? String(userId).trim() : '';
    if (!targetId) return null;
    const [rows] = await this.db.query(
      `SELECT
         u.*,
         c.child_id,
         c.guardian_id,
         c.avatar,
         c.grade,
         c.safety_level,
         c.guardian_consent_at,
         c.guardian_consent_version,
         g.phone AS guardian_phone
       FROM app_users u
       LEFT JOIN app_children c ON c.child_id = u.user_id
       LEFT JOIN app_guardians g ON g.guardian_id = c.guardian_id
       WHERE u.user_id = ?
       LIMIT 1`,
      [targetId]
    );
    return rows[0] || null;
  }

  async isUserBannedByPhone(phone) {
    return Boolean((await this.findUserByPhone(phone))?.is_banned);
  }

  async ensureUserExists(profile = {}) {
    await this.db.init();
    const incomingId =
      typeof profile.id === 'string' || typeof profile.id === 'number' ? String(profile.id).trim() : '';
    const nextName = sanitizeName(profile.name);
    const nextAge = sanitizeAge(profile.age);
    const nextPhone = sanitizePhone(profile.phone);

    const isIncomingGuestId = incomingId.startsWith('guest:');
    const userId = nextPhone
      ? generateUserId({ isGuest: false })
      : isIncomingGuestId
        ? incomingId
        : generateUserId({ isGuest: true });

    const [byIdRows] = incomingId
      ? await this.db.query('SELECT * FROM app_users WHERE user_id = ? LIMIT 1', [incomingId])
      : [[]];
    const existingUserById = byIdRows[0] || null;
    const [byPhoneRows] = nextPhone
      ? await this.db.query('SELECT * FROM app_users WHERE phone = ? LIMIT 1', [nextPhone])
      : [[]];
    const existingUserByPhone = byPhoneRows[0] || null;

    const existingUser = existingUserByPhone || (!nextPhone ? existingUserById : null);
    const timestamp = new Date();

    if (existingUser) {
      await this.db.query(
        'UPDATE app_users SET name = ?, age = ?, phone = ?, last_active = ? WHERE user_id = ?',
        [nextName, nextAge, nextPhone, timestamp, existingUser.user_id]
      );
      if (nextPhone) {
        await this.ensureGuardianChildLink({
          userId: existingUser.user_id,
          phone: nextPhone,
          name: nextName,
          age: nextAge,
          avatar: profile.avatar,
          grade: profile.grade,
          safetyLevel: profile.safetyLevel || profile.safety_level,
          guardianConsent: profile.guardianConsent,
          guardianConsentVersion: profile.guardianConsentVersion
        });
      }
      return existingUser.user_id;
    }

    await this.db.query(
      'INSERT INTO app_users (user_id, name, age, phone, is_banned, registered_at, last_active) VALUES (?, ?, ?, ?, 0, ?, ?)',
      [userId, nextName, nextAge, nextPhone, timestamp, timestamp]
    );
    if (nextPhone) {
      await this.ensureGuardianChildLink({
        userId,
        phone: nextPhone,
        name: nextName,
        age: nextAge,
        avatar: profile.avatar,
        grade: profile.grade,
        safetyLevel: profile.safetyLevel || profile.safety_level,
        guardianConsent: profile.guardianConsent,
        guardianConsentVersion: profile.guardianConsentVersion
      });
    }
    return userId;
  }

  async ensureGuardianByPhone(phone) {
    await this.db.init();
    const normalizedPhone = sanitizePhone(phone);
    if (!normalizedPhone) return null;

    const timestamp = new Date();
    const [existingRows] = await this.db.query('SELECT guardian_id FROM app_guardians WHERE phone = ? LIMIT 1', [
      normalizedPhone
    ]);
    const existing = existingRows[0];
    if (existing?.guardian_id) {
      await this.db.query('UPDATE app_guardians SET updated_at = ? WHERE guardian_id = ?', [
        timestamp,
        existing.guardian_id
      ]);
      return existing.guardian_id;
    }

    const guardianId = generateUserId({ isGuest: false });
    await this.db.query(
      'INSERT INTO app_guardians (guardian_id, phone, display_name, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)',
      [guardianId, normalizedPhone, timestamp, timestamp]
    );
    return guardianId;
  }

  async ensureGuardianChildLink({
    userId,
    phone,
    name,
    age,
    avatar,
    grade,
    safetyLevel,
    guardianConsent,
    guardianConsentVersion
  } = {}) {
    await this.db.init();
    const childId = typeof userId === 'string' || typeof userId === 'number' ? String(userId).trim() : '';
    if (!childId) return null;

    const guardianId = await this.ensureGuardianByPhone(phone);
    if (!guardianId) return null;

    const timestamp = new Date();
    const safeName = sanitizeName(name);
    const safeAge = sanitizeAge(age);
    const safeAvatar = typeof avatar === 'string' && avatar.trim() ? avatar.trim().slice(0, 255) : null;
    const safeGrade = typeof grade === 'string' && grade.trim() ? grade.trim().slice(0, 64) : null;
    const safeSafetyLevel = sanitizeSafetyLevel(safetyLevel);
    const consentAt = guardianConsent === true ? timestamp : null;
    const consentVersion =
      guardianConsent === true && typeof guardianConsentVersion === 'string' && guardianConsentVersion.trim()
        ? guardianConsentVersion.trim().slice(0, 32)
        : null;

    await this.db.query(
      `INSERT INTO app_children (child_id, guardian_id, name, age, avatar, grade, safety_level, guardian_consent_at, guardian_consent_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         guardian_id = VALUES(guardian_id),
         name = VALUES(name),
         age = VALUES(age),
         avatar = VALUES(avatar),
         grade = VALUES(grade),
         safety_level = VALUES(safety_level),
         guardian_consent_at = COALESCE(VALUES(guardian_consent_at), guardian_consent_at),
         guardian_consent_version = COALESCE(VALUES(guardian_consent_version), guardian_consent_version),
         updated_at = VALUES(updated_at)`,
      [
        childId,
        guardianId,
        safeName,
        safeAge,
        safeAvatar,
        safeGrade,
        safeSafetyLevel,
        consentAt,
        consentVersion,
        timestamp,
        timestamp
      ]
    );

    return { guardianId, childId };
  }

  async setUserBanStatus(userId, isBanned) {
    await this.db.init();
    await this.db.query('UPDATE app_users SET is_banned = ? WHERE user_id = ?', [
      Boolean(isBanned) ? 1 : 0,
      String(userId)
    ]);
    const [rows] = await this.db.query('SELECT * FROM app_users WHERE user_id = ? LIMIT 1', [String(userId)]);
    return rows[0] || null;
  }

  async deleteUserAndConversations(userId) {
    await this.db.init();
    const targetId = String(userId);
    const [existingRows] = await this.db.query('SELECT user_id FROM app_users WHERE user_id = ? LIMIT 1', [targetId]);
    if (!existingRows[0]) return { deleted: false, conversationCount: 0 };
    const [convCount] = await this.db.query('SELECT COUNT(*) AS c FROM app_conversations WHERE user_id = ?', [targetId]);
    await this.db.query('DELETE FROM app_users WHERE user_id = ?', [targetId]);
    return { deleted: true, conversationCount: convCount[0].c };
  }

  async getUserFullProfile(userId) {
    await this.db.init();
    const targetId = String(userId);
    const [users] = await this.db.query(
      `SELECT
         u.*,
         c.child_id,
         c.guardian_id,
         c.avatar,
         c.grade,
         c.safety_level,
         c.guardian_consent_at,
         c.guardian_consent_version,
         g.phone AS guardian_phone
       FROM app_users u
       LEFT JOIN app_children c ON c.child_id = u.user_id
       LEFT JOIN app_guardians g ON g.guardian_id = c.guardian_id
       WHERE u.user_id = ?
       LIMIT 1`,
      [targetId]
    );
    const user = users[0];
    if (!user) return null;

    const [conversationsRows] = await this.db.query(
      'SELECT * FROM app_conversations WHERE user_id = ? ORDER BY updated_at DESC',
      [targetId]
    );
    const conversations = conversationsRows.map((item) => {
      const messages = typeof item.messages === 'string' ? JSON.parse(item.messages || '[]') : item.messages;
      return {
        conversation_id: item.conversation_id,
        title: item.title || `گفتگو ${item.conversation_id}`,
        message_count: safeJsonArray(messages).length,
        last_message_at: item.updated_at || item.created_at || null,
        messages: safeJsonArray(messages)
      };
    });

    return {
      ...user,
      isBanned: Boolean(user.is_banned),
      guardian: user.guardian_id
        ? {
            id: user.guardian_id,
            phone: user.guardian_phone || user.phone || null
          }
        : null,
      child: {
        id: user.child_id || user.user_id,
        name: user.name,
        age: Number(user.age || 0),
        avatar: user.avatar || null,
        grade: user.grade || null,
        safetyLevel: user.safety_level || DEFAULT_CHILD_SAFETY_LEVEL,
        guardianConsentAt: user.guardian_consent_at || null,
        guardianConsentVersion: user.guardian_consent_version || null
      },
      conversations
    };
  }
}

module.exports = { UserRepository };
