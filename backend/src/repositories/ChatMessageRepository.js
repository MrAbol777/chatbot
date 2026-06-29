const { getGuestIdFromUserId, isGuestUserId } = require('./GuestRepository');

const normalizeContent = (value) => (typeof value === 'string' ? value.trim() : '');
const normalizeNullableString = (value) => {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return text || null;
};

class ChatMessageRepository {
  constructor(db) {
    this.db = db;
  }

  async logMessage({
    userId,
    conversationId,
    role,
    content,
    model = null,
    responseTimeMs = null,
    tokenUsage = null,
    errorCode = null,
    limitStatus = null,
    createdAt = new Date()
  }) {
    await this.db.init();

    const normalizedUserId = normalizeNullableString(userId);
    const guestId = normalizedUserId && isGuestUserId(normalizedUserId) ? getGuestIdFromUserId(normalizedUserId) : null;
    const userType = guestId ? 'guest' : 'registered';
    const storedUserId = guestId ? null : normalizedUserId;
    const storedContent = normalizeContent(content);
    const storedRole = role === 'assistant' ? 'assistant' : 'user';

    if (!storedContent || (!storedUserId && !guestId)) {
      return null;
    }

    const [result] = await this.db.query(
      `INSERT INTO app_chat_messages
       (user_id, guest_id, user_type, conversation_id, role, content, model, response_time_ms, token_usage, error_code, limit_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        storedUserId,
        guestId,
        userType,
        normalizeNullableString(conversationId) || 'default',
        storedRole,
        storedContent,
        normalizeNullableString(model),
        Number.isFinite(Number(responseTimeMs)) ? Math.max(0, Math.round(Number(responseTimeMs))) : null,
        tokenUsage ? JSON.stringify(tokenUsage) : null,
        normalizeNullableString(errorCode),
        normalizeNullableString(limitStatus),
        createdAt
      ]
    );

    return result?.insertId || null;
  }

  async logSuccessfulTurn({
    userId,
    conversationId,
    userMessage,
    assistantResponse,
    model,
    responseTimeMs,
    tokenUsage,
    limitStatus,
    userCreatedAt,
    assistantCreatedAt
  }) {
    const common = { userId, conversationId, model, errorCode: null, limitStatus };
    await this.logMessage({
      ...common,
      role: 'user',
      content: userMessage,
      responseTimeMs: null,
      tokenUsage: null,
      createdAt: userCreatedAt || new Date()
    });

    await this.logMessage({
      ...common,
      role: 'assistant',
      content: assistantResponse,
      responseTimeMs,
      tokenUsage,
      createdAt: assistantCreatedAt || new Date()
    });
  }
}

module.exports = { ChatMessageRepository };
