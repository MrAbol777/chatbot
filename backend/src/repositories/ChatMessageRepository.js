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
    turnId = null,
    role,
    content,
    model = null,
    responseTimeMs = null,
    tokenUsage = null,
    errorCode = null,
    createdAt = new Date()
  }) {
    await this.db.init();

    const normalizedUserId = normalizeNullableString(userId);
    const storedContent = normalizeContent(content);
    const storedRole = role === 'assistant' ? 'assistant' : 'user';

    if (!storedContent || !normalizedUserId) {
      return null;
    }

    const [result] = await this.db.query(
      `INSERT INTO app_chat_messages
       (user_id, user_type, conversation_id, turn_id, role, content, model, response_time_ms, token_usage, error_code, created_at)
       VALUES (?, 'registered', ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE message_id = LAST_INSERT_ID(message_id)`,
      [
        normalizedUserId,
        normalizeNullableString(conversationId) || 'default',
        normalizeNullableString(turnId),
        storedRole,
        storedContent,
        normalizeNullableString(model),
        Number.isFinite(Number(responseTimeMs)) ? Math.max(0, Math.round(Number(responseTimeMs))) : null,
        tokenUsage ? JSON.stringify(tokenUsage) : null,
        normalizeNullableString(errorCode),
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
    userCreatedAt,
    assistantCreatedAt,
    turnId = null
  }) {
    const common = { userId, conversationId, turnId, model, errorCode: null };
    const userMessageId = await this.logMessage({
      ...common,
      role: 'user',
      content: userMessage,
      responseTimeMs: null,
      tokenUsage: null,
      createdAt: userCreatedAt || new Date()
    });

    const assistantMessageId = await this.logMessage({
      ...common,
      role: 'assistant',
      content: assistantResponse,
      responseTimeMs,
      tokenUsage,
      createdAt: assistantCreatedAt || new Date()
    });

    return { userMessageId, assistantMessageId };
  }

  async listConversationMessages({ conversationId, userId = null, limit = 200 }) {
    await this.db.init();
    const normalizedConversationId = normalizeNullableString(conversationId) || 'default';
    const safeLimit = Math.min(500, Math.max(1, Number.parseInt(String(limit), 10) || 200));
    const params = userId
      ? [normalizedConversationId, normalizeNullableString(userId), safeLimit]
      : [normalizedConversationId, safeLimit];
    const sql = userId
      ? `SELECT message_id, role, content, created_at
         FROM app_chat_messages
         WHERE conversation_id = ? AND user_id = ?
         ORDER BY created_at ASC, message_id ASC
         LIMIT ?`
      : `SELECT message_id, role, content, created_at
         FROM app_chat_messages
         WHERE conversation_id = ?
         ORDER BY created_at ASC, message_id ASC
         LIMIT ?`;
    const actualParams = params;
    const [rows] = await this.db.query(sql, actualParams);
    return rows.map((row) => ({
      id: row.message_id,
      role: row.role,
      content: row.content,
      timestamp: row.created_at
    }));
  }
}

module.exports = { ChatMessageRepository };
