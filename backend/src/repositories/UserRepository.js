const {
  sanitizePhone,
  sanitizeName,
  sanitizeAge,
  generateUserId,
  safeJsonArray
} = require('./helpers');

class UserRepository {
  constructor(db) {
    this.db = db;
  }

  async findUserByPhone(phone) {
    await this.db.init();
    const normalizedPhone = sanitizePhone(phone);
    if (!normalizedPhone) return null;
    const [rows] = await this.db.query('SELECT * FROM app_users WHERE phone = ? LIMIT 1', [normalizedPhone]);
    return rows[0] || null;
  }

  async isUserBannedByPhone(phone) {
    return Boolean((await this.findUserByPhone(phone))?.is_banned);
  }

  async ensureUserExists(profile = {}) {
    await this.db.init();
    const incomingId =
      typeof profile.id === 'string' || typeof profile.id === 'number' ? String(profile.id).trim() : '';
    const userId = incomingId || generateUserId();
    const nextName = sanitizeName(profile.name);
    const nextAge = sanitizeAge(profile.age);
    const nextPhone = sanitizePhone(profile.phone);

    const [byIdRows] = await this.db.query('SELECT * FROM app_users WHERE user_id = ? LIMIT 1', [userId]);
    const existingUserById = byIdRows[0] || null;
    const [byPhoneRows] = nextPhone
      ? await this.db.query('SELECT * FROM app_users WHERE phone = ? LIMIT 1', [nextPhone])
      : [[]];
    const existingUserByPhone = byPhoneRows[0] || null;

    if (existingUserById && existingUserByPhone && existingUserById.user_id !== existingUserByPhone.user_id) {
      const conflictError = new Error('این شماره موبایل قبلا برای حساب دیگری ثبت شده است.');
      conflictError.code = 'PHONE_ALREADY_IN_USE';
      conflictError.userId = existingUserByPhone.user_id;
      throw conflictError;
    }

    const existingUser = existingUserByPhone || existingUserById;
    const timestamp = new Date();

    if (existingUser) {
      await this.db.query(
        'UPDATE app_users SET name = ?, age = ?, phone = ?, last_active = ? WHERE user_id = ?',
        [nextName, nextAge, nextPhone, timestamp, existingUser.user_id]
      );
      return existingUser.user_id;
    }

    await this.db.query(
      'INSERT INTO app_users (user_id, name, age, phone, is_banned, registered_at, last_active) VALUES (?, ?, ?, ?, 0, ?, ?)',
      [userId, nextName, nextAge, nextPhone, timestamp, timestamp]
    );
    return userId;
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
    const [users] = await this.db.query('SELECT * FROM app_users WHERE user_id = ? LIMIT 1', [targetId]);
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

    return { ...user, isBanned: Boolean(user.is_banned), conversations };
  }
}

module.exports = { UserRepository };
