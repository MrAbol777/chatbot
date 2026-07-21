class InputOptimizationRepository {
  constructor(db) { this.db = db; }

  async findByOperation({ operationType, operationId }) {
    if (!operationType || !operationId) return null;
    await this.db.init();
    const [rows] = await this.db.query(
      'SELECT * FROM input_optimizations WHERE operation_type = ? AND operation_id = ? LIMIT 1',
      [String(operationType).slice(0, 64), String(operationId).slice(0, 191)]
    );
    return rows[0] || null;
  }

  async upsert(record) {
    await this.db.init();
    const now = new Date();
    await this.db.query(
      `INSERT INTO input_optimizations
       (operation_type, operation_id, conversation_id, turn_id, attempt_id, image_generation_id, user_id, guest_id,
        original_input, optimized_input, source_language, target_language, ambiguity_level, needs_clarification,
        clarification_question_fa, status, model, optimizer_version, latency_ms, retry_count, fallback_used, error_code, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE optimized_input=VALUES(optimized_input), source_language=VALUES(source_language),
        target_language=VALUES(target_language), ambiguity_level=VALUES(ambiguity_level), needs_clarification=VALUES(needs_clarification),
        clarification_question_fa=VALUES(clarification_question_fa), status=VALUES(status), model=VALUES(model),
        optimizer_version=VALUES(optimizer_version), latency_ms=VALUES(latency_ms), retry_count=VALUES(retry_count),
        fallback_used=VALUES(fallback_used), error_code=VALUES(error_code), metadata=VALUES(metadata), updated_at=VALUES(updated_at)`,
      [
        record.operationType, record.operationId, record.conversationId || null, record.turnId || null, record.attemptId || null,
        record.imageGenerationId || null, record.userId || null, record.guestId || null, record.originalText || '',
        record.optimizedTextEn || null, record.sourceLanguage || null, 'en', record.ambiguityLevel || 'none',
        record.needsClarification ? 1 : 0, record.clarificationQuestionFa || null, record.status, record.model || null,
        record.optimizerVersion || '1', record.latencyMs || 0, record.retryCount || 0, record.fallbackUsed ? 1 : 0,
        record.errorCode || null, JSON.stringify(record.metadata || {}), now, now
      ]
    );
  }

  async listForAdmin({ conversationId = '', status = '', limit = 50 } = {}) {
    await this.db.init();
    const values = []; const where = [];
    if (conversationId) { where.push('conversation_id = ?'); values.push(String(conversationId).slice(0, 191)); }
    if (status) { where.push('status = ?'); values.push(String(status).slice(0, 32)); }
    values.push(Math.min(100, Math.max(1, Number(limit) || 50)));
    const [rows] = await this.db.query(
      `SELECT id, operation_type, operation_id, conversation_id, turn_id, attempt_id, image_generation_id, user_id, guest_id,
              original_input, optimized_input, source_language, target_language, ambiguity_level, needs_clarification,
              clarification_question_fa, status, model, optimizer_version, latency_ms, retry_count, fallback_used, error_code,
              created_at, updated_at
       FROM input_optimizations ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC, id DESC LIMIT ?`, values
    );
    return rows;
  }
}

module.exports = { InputOptimizationRepository };
