const normalizeId = (value) => (typeof value === 'string' ? value.trim() : '');
const VALID_RATINGS = new Set(['up', 'down']);

class ChatFeedbackRepository {
  constructor(db) {
    this.db = db;
  }

  // Stores one rating per (user, turn). A null rating clears it.
  async setFeedback({ userId, turnId, conversationId, rating }) {
    await this.db.init();
    const owner = normalizeId(userId);
    const turn = normalizeId(turnId);
    if (!owner || !turn) throw Object.assign(new Error('INVALID_FEEDBACK_TARGET'), { code: 'INVALID_FEEDBACK_TARGET' });

    if (rating === null || rating === undefined) {
      await this.db.query('DELETE FROM app_chat_feedback WHERE user_id = ? AND turn_id = ?', [owner, turn]);
      return { turnId: turn, rating: null };
    }
    if (!VALID_RATINGS.has(rating)) throw Object.assign(new Error('INVALID_RATING'), { code: 'INVALID_RATING' });

    const now = new Date();
    await this.db.query(
      `INSERT INTO app_chat_feedback (user_id, turn_id, conversation_id, rating, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE rating = VALUES(rating), updated_at = VALUES(updated_at)`,
      [owner, turn, normalizeId(conversationId) || 'default', rating, now, now]
    );
    return { turnId: turn, rating };
  }

  async listForConversation(userId, conversationId) {
    await this.db.init();
    const [rows] = await this.db.query(
      'SELECT turn_id, rating FROM app_chat_feedback WHERE user_id = ? AND conversation_id = ?',
      [normalizeId(userId), normalizeId(conversationId)]
    );
    return rows.map((row) => ({ turnId: row.turn_id, rating: row.rating }));
  }
}

module.exports = { ChatFeedbackRepository };
