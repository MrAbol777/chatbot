const { GUEST_USER_PREFIX, generateUserId, normalizeUuid } = require('./helpers');

const normalizeGuestId = (value) => {
  return normalizeUuid(value);
};

const toGuestUserId = (guestId) => generateUserId({ isGuest: true, uuid: guestId });
const isGuestUserId = (value) => typeof value === 'string' && value.startsWith(GUEST_USER_PREFIX);
const getGuestIdFromUserId = (value) => (isGuestUserId(value) ? value.slice(GUEST_USER_PREFIX.length) : '');

class GuestRepository {
  constructor(db) {
    this.db = db;
  }

  async ensureGuestUser(guestId) {
    await this.db.init();
    const safeGuestId = normalizeGuestId(guestId);
    if (!safeGuestId) return null;

    const userId = toGuestUserId(safeGuestId);
    const timestamp = new Date();
    await this.db.query(
      `INSERT INTO app_users (user_id, name, age, phone, is_banned, registered_at, last_active)
       VALUES (?, 'مهمان', 0, NULL, 0, ?, ?)
       ON DUPLICATE KEY UPDATE last_active = VALUES(last_active)`,
      [userId, timestamp, timestamp]
    );
    return userId;
  }

  async migrateGuestToUser({ guestId, userId }) {
    await this.db.init();
    const safeGuestId = normalizeGuestId(guestId);
    const targetUserId = typeof userId === 'string' || typeof userId === 'number' ? String(userId).trim() : '';
    if (!safeGuestId || !targetUserId || isGuestUserId(targetUserId)) {
      return { migratedConversations: 0 };
    }

    const guestUserId = toGuestUserId(safeGuestId);
    const conn = await this.db.getConnection();

    try {
      await conn.beginTransaction();

      const [guestRows] = await conn.query(
        `SELECT conversation_id, title, pinned, messages, created_at, updated_at
         FROM app_conversations
         WHERE guest_id = ? OR user_id = ?`,
        [safeGuestId, guestUserId]
      );

      let migratedConversations = 0;
      for (const item of guestRows) {
        await conn.query(
          `INSERT INTO app_conversations (user_id, guest_id, conversation_id, title, pinned, messages, created_at, updated_at)
           VALUES (?, NULL, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             title = VALUES(title),
             pinned = VALUES(pinned),
             messages = VALUES(messages),
             updated_at = GREATEST(updated_at, VALUES(updated_at)),
             guest_id = NULL`,
          [
            targetUserId,
            item.conversation_id,
            item.title || '',
            Boolean(item.pinned) ? 1 : 0,
            typeof item.messages === 'string' ? item.messages : JSON.stringify(item.messages || []),
            item.created_at || new Date(),
            item.updated_at || item.created_at || new Date()
          ]
        );
        migratedConversations += 1;
      }

      await conn.query('DELETE FROM app_conversations WHERE guest_id = ? OR user_id = ?', [safeGuestId, guestUserId]);
      await conn.query('DELETE FROM app_users WHERE user_id = ?', [guestUserId]);

      await conn.commit();
      return { migratedConversations };
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }
}

module.exports = {
  GuestRepository,
  GUEST_USER_PREFIX,
  getGuestIdFromUserId,
  isGuestUserId,
  normalizeGuestId,
  toGuestUserId
};
