const {
  nowIso,
  toDate,
  normalizeConversationId,
  safeJsonArray
} = require('./helpers');

class ConversationRepository {
  constructor(db) {
    this.db = db;
  }

  async getConversationMessages(userId, conversationId) {
    await this.db.init();
    const normalizedUserId = typeof userId === 'string' || typeof userId === 'number' ? String(userId) : '';
    const normalizedConversationId = normalizeConversationId(conversationId);
    const [rows] = await this.db.query(
      'SELECT messages FROM app_conversations WHERE user_id = ? AND conversation_id = ? LIMIT 1',
      [normalizedUserId, normalizedConversationId]
    );
    const raw = rows[0]?.messages;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return safeJsonArray(parsed)
      .filter(
        (item) =>
          item &&
          (item.role === 'user' || item.role === 'assistant') &&
          typeof item.content === 'string' &&
          item.content.trim()
      )
      .map((item) => ({ role: item.role, content: item.content }));
  }

  async saveConversationMessages(userId, conversationId, messages) {
    await this.db.init();
    if (!userId) return;
    const safeMessages = Array.isArray(messages)
      ? messages
          .filter(
            (item) =>
              item &&
              (item.role === 'user' || item.role === 'assistant') &&
              typeof item.content === 'string' &&
              item.content.trim()
          )
          .slice(-100)
          .map((item) => ({ role: item.role, content: item.content.trim() }))
      : [];

    const normalizedUserId = String(userId);
    const normalizedConversationId = normalizeConversationId(conversationId);
    const ts = new Date();

    await this.db.query(
      `INSERT INTO app_conversations (user_id, conversation_id, title, pinned, messages, created_at, updated_at)
       VALUES (?, ?, '', 0, ?, ?, ?)
       ON DUPLICATE KEY UPDATE messages = VALUES(messages), updated_at = VALUES(updated_at)`,
      [normalizedUserId, normalizedConversationId, JSON.stringify(safeMessages), ts, ts]
    );
  }

  async getUserConversations(userId) {
    await this.db.init();
    const targetId = String(userId || '').trim();
    if (!targetId) return [];

    const [rows] = await this.db.query('SELECT * FROM app_conversations WHERE user_id = ? ORDER BY updated_at DESC', [
      targetId
    ]);

    return rows.map((item) => {
      const messages = typeof item.messages === 'string' ? JSON.parse(item.messages || '[]') : item.messages;
      return {
        conversation_id: String(item.conversation_id || 'default'),
        title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : null,
        pinned: Boolean(item.pinned),
        created_at: item.created_at || nowIso(),
        updated_at: item.updated_at || item.created_at || nowIso(),
        messages: safeJsonArray(messages)
      };
    });
  }

  async replaceUserConversations(userId, conversations) {
    await this.db.init();
    const targetId = String(userId || '').trim();
    if (!targetId) return 0;

    const safeConversations = Array.isArray(conversations) ? conversations : [];
    const conn = await this.db.getConnection();

    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM app_conversations WHERE user_id = ?', [targetId]);

      for (const item of safeConversations) {
        const conversationId =
          typeof item?.conversation_id === 'string' && item.conversation_id.trim()
            ? item.conversation_id.trim()
            : 'default';
        const safeMessages = Array.isArray(item?.messages)
          ? item.messages
              .filter(
                (msg) =>
                  msg &&
                  (msg.role === 'user' || msg.role === 'assistant') &&
                  typeof msg.content === 'string' &&
                  msg.content.trim()
              )
              .slice(-200)
              .map((msg) => ({
                role: msg.role,
                content: msg.content.trim(),
                timestamp: typeof msg.timestamp === 'string' ? msg.timestamp : nowIso(),
                images: Array.isArray(msg.images)
                  ? msg.images
                      .filter((image) => image && typeof image.url === 'string' && image.url.trim())
                      .slice(0, 5)
                      .map((image) => ({
                        url: image.url.trim(),
                        alt: typeof image.alt === 'string' ? image.alt.trim() : ''
                      }))
                  : undefined
              }))
          : [];

        await conn.query(
          'INSERT INTO app_conversations (user_id, conversation_id, title, pinned, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [
            targetId,
            conversationId,
            typeof item?.title === 'string' ? item.title.trim() : '',
            Boolean(item?.pinned) ? 1 : 0,
            JSON.stringify(safeMessages),
            toDate(item?.created_at || nowIso()),
            toDate(item?.updated_at || item?.created_at || nowIso())
          ]
        );
      }

      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }

    return safeConversations.length;
  }
}

module.exports = { ConversationRepository };
