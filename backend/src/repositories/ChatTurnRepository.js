const VALID_STATUSES = new Set(['streaming', 'completed', 'cancelled', 'failed']);
const normalizeId = (value) => (typeof value === 'string' ? value.trim() : '');

class ChatTurnRepository {
  constructor(db) {
    this.db = db;
  }

  async getTurn(turnId) {
    await this.db.init();
    const [rows] = await this.db.query('SELECT * FROM app_chat_turns WHERE turn_id = ? LIMIT 1', [normalizeId(turnId)]);
    return rows[0] || null;
  }

  async beginTurn({ turnId, userId, conversationId, clientMessageId, userMessage, intent }) {
    await this.db.init();
    const id = normalizeId(turnId);
    const owner = String(userId || '').trim();
    if (!id || !owner) throw Object.assign(new Error('INVALID_TURN_ID'), { code: 'INVALID_TURN_ID' });
    const now = new Date();
    const [result] = await this.db.query(
      `INSERT IGNORE INTO app_chat_turns
       (turn_id, user_id, conversation_id, client_message_id, user_message, intent, status, quota_charged, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'streaming', 0, ?, ?)`,
      [id, owner, normalizeId(conversationId) || 'default', normalizeId(clientMessageId) || null, String(userMessage || ''), intent, now, now]
    );
    const [rows] = await this.db.query('SELECT * FROM app_chat_turns WHERE turn_id = ? LIMIT 1', [id]);
    const turn = rows[0];
    if (!turn || String(turn.user_id) !== owner) {
      throw Object.assign(new Error('TURN_ID_CONFLICT'), { code: 'TURN_ID_CONFLICT' });
    }
    if (String(turn.user_message || '') !== String(userMessage || '') || String(turn.conversation_id) !== (normalizeId(conversationId) || 'default')) {
      throw Object.assign(new Error('TURN_ID_CONFLICT'), { code: 'TURN_ID_CONFLICT' });
    }
    return { turn, created: Boolean(result?.affectedRows) };
  }

  async beginAttempt({ attemptId, turnId }) {
    await this.db.init();
    const id = normalizeId(attemptId);
    const parentId = normalizeId(turnId);
    if (!id || !parentId) throw Object.assign(new Error('INVALID_ATTEMPT_ID'), { code: 'INVALID_ATTEMPT_ID' });
    const now = new Date();
    try {
      await this.db.query(
        `INSERT INTO app_chat_attempts (attempt_id, turn_id, status, started_at, updated_at)
         VALUES (?, ?, 'streaming', ?, ?)`,
        [id, parentId, now, now]
      );
    } catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY') throw error;
      const conflict = new Error('ATTEMPT_ID_CONFLICT');
      conflict.code = 'ATTEMPT_ID_CONFLICT';
      throw conflict;
    }
    await this.db.query("UPDATE app_chat_turns SET status = 'streaming', error_code = NULL, updated_at = ? WHERE turn_id = ? AND status <> 'completed'", [now, parentId]);
  }

  async finishAttempt({ attemptId, status, errorCode = null }) {
    const safeStatus = VALID_STATUSES.has(status) ? status : 'failed';
    const now = new Date();
    await this.db.query(
      `UPDATE app_chat_attempts SET status = ?, error_code = ?, finished_at = ?, updated_at = ? WHERE attempt_id = ?`,
      [safeStatus, errorCode, now, now, normalizeId(attemptId)]
    );
  }

  async markTurn({ turnId, status, reply = null, model = null, tokenUsage = null, errorCode = null }) {
    const safeStatus = VALID_STATUSES.has(status) ? status : 'failed';
    const now = new Date();
    await this.db.query(
      `UPDATE app_chat_turns
       SET status = ?, reply = ?, model = ?, token_usage = ?, error_code = ?, completed_at = ?, updated_at = ?
       WHERE turn_id = ?`,
      [safeStatus, reply, model, tokenUsage ? JSON.stringify(tokenUsage) : null, errorCode, safeStatus === 'completed' ? now : null, now, normalizeId(turnId)]
    );
  }

  async claimQuota(turnId) {
    const [result] = await this.db.query(
      'UPDATE app_chat_turns SET quota_charged = 1, updated_at = ? WHERE turn_id = ? AND quota_charged = 0',
      [new Date(), normalizeId(turnId)]
    );
    return Number(result?.affectedRows || 0) === 1;
  }
}

module.exports = { ChatTurnRepository };
