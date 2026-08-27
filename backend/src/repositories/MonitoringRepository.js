'use strict';

const OPTIONAL_SCHEMA_ERRORS = new Set(['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR']);

class MonitoringRepository {
  constructor(db) {
    this.db = db;
    this.recordedRequests = 0;
  }

  async optionalRows(sql, params = []) {
    try {
      await this.db.init();
      return (await this.db.query(sql, params))[0];
    } catch (error) {
      if (OPTIONAL_SCHEMA_ERRORS.has(error?.code)) return [];
      throw error;
    }
  }

  async recordRequest({ requestId, method, route, statusCode, durationMs }) {
    await this.db.init();
    await this.db.query(
      `INSERT INTO app_request_metrics
       (request_id, method, route, status_code, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, NOW(6))`,
      [
        String(requestId || 'unknown').slice(0, 64),
        String(method || 'GET').slice(0, 12),
        String(route || '/api/unknown').slice(0, 191),
        Math.max(0, Math.min(599, Number(statusCode) || 500)),
        Math.max(0, Math.min(2_147_483_647, Math.round(Number(durationMs) || 0)))
      ]
    );

    this.recordedRequests += 1;
    if (this.recordedRequests % 1000 === 0) {
      await this.db.query('DELETE FROM app_request_metrics WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)');
    }
  }

  async ping() {
    const startedAt = process.hrtime.bigint();
    await this.db.init();
    await this.db.query('SELECT 1 AS ok');
    return Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000);
  }

  async getTotalUsers() {
    const rows = await this.optionalRows('SELECT COUNT(*) AS total FROM app_users');
    return Number(rows[0]?.total || 0);
  }

  async getActiveUsers(from, to) {
    const rows = await this.optionalRows(
      `SELECT COUNT(DISTINCT user_id) AS total
       FROM app_chat_messages
       WHERE role='user' AND created_at >= ? AND created_at < ?`,
      [from, to]
    );
    return Number(rows[0]?.total || 0);
  }

  async getRequestRows(from, to, limit = 50000) {
    return this.optionalRows(
      `SELECT route, method, status_code, duration_ms, created_at
       FROM app_request_metrics
       WHERE created_at >= ? AND created_at < ?
       ORDER BY created_at ASC
       LIMIT ?`,
      [from, to, Math.min(50000, Math.max(1, Number(limit) || 50000))]
    );
  }

  async getChatRows(from, to, limit = 50000) {
    return this.optionalRows(
      `SELECT model, response_time_ms, token_usage, error_code, created_at
       FROM app_chat_messages
       WHERE role='assistant' AND created_at >= ? AND created_at < ?
       ORDER BY created_at ASC
       LIMIT ?`,
      [from, to, Math.min(50000, Math.max(1, Number(limit) || 50000))]
    );
  }

  async getImageRows(from, to, limit = 30000) {
    return this.optionalRows(
      `SELECT status, provider, model_runtime_value AS model,
              TIMESTAMPDIFF(MICROSECOND, created_at, updated_at) / 1000 AS duration_ms,
              created_at, updated_at
       FROM image_generations
       WHERE deleted_at IS NULL AND created_at >= ? AND created_at < ?
       ORDER BY created_at ASC
       LIMIT ?`,
      [from, to, Math.min(30000, Math.max(1, Number(limit) || 30000))]
    );
  }

  async getVideoRows(from, to, limit = 30000) {
    return this.optionalRows(
      `SELECT status, provider, model_key AS model,
              CASE
                WHEN completed_at IS NOT NULL THEN TIMESTAMPDIFF(MICROSECOND, created_at, completed_at) / 1000
                WHEN failed_at IS NOT NULL THEN TIMESTAMPDIFF(MICROSECOND, created_at, failed_at) / 1000
                ELSE NULL
              END AS duration_ms,
              created_at, updated_at
       FROM app_video_generations
       WHERE created_at >= ? AND created_at < ?
       ORDER BY created_at ASC
       LIMIT ?`,
      [from, to, Math.min(30000, Math.max(1, Number(limit) || 30000))]
    );
  }

  async getProviderAttempts(from, to, limit = 30000) {
    return this.optionalRows(
      `SELECT provider_key, capability_key, internal_model_key, state,
              processing_time_ms, actual_cost, cost_currency, created_at
       FROM app_ai_provider_attempts
       WHERE created_at >= ? AND created_at < ?
       ORDER BY created_at ASC
       LIMIT ?`,
      [from, to, Math.min(30000, Math.max(1, Number(limit) || 30000))]
    );
  }

  async getProviderHealth() {
    return this.optionalRows(
      `SELECT provider_key, capability_key, circuit_state, consecutive_failures,
              average_latency_ms, success_count, failure_count, retry_after, updated_at
       FROM app_ai_provider_health
       ORDER BY provider_key, capability_key`
    );
  }

  async getNoaSnapshot(from, to) {
    const [captured, unresolved] = await Promise.all([
      this.optionalRows(
        `SELECT action_key, COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS total
         FROM app_noa_reservations
         WHERE status='captured' AND captured_at >= ? AND captured_at < ?
         GROUP BY action_key
         ORDER BY amount DESC`,
        [from, to]
      ),
      this.optionalRows(
        `SELECT COUNT(*) AS total, COALESCE(SUM(amount), 0) AS amount
         FROM app_noa_reservations
         WHERE status='reserved' AND expires_at IS NOT NULL AND expires_at < NOW(6)`
      )
    ]);
    return {
      captured: captured.map((row) => ({
        actionKey: row.action_key || 'unknown',
        amount: Number(row.amount || 0),
        total: Number(row.total || 0)
      })),
      unresolved: {
        total: Number(unresolved[0]?.total || 0),
        amount: Number(unresolved[0]?.amount || 0)
      }
    };
  }

  async getQueueSnapshot() {
    const [imageStatuses, videoStatuses, staleImages, staleVideos] = await Promise.all([
      this.optionalRows(
        `SELECT status, COUNT(*) AS total
         FROM image_generations
         WHERE deleted_at IS NULL
         GROUP BY status`
      ),
      this.optionalRows(
        `SELECT status, COUNT(*) AS total
         FROM app_video_generations
         GROUP BY status`
      ),
      this.optionalRows(
        `SELECT COUNT(*) AS total
         FROM image_generations
         WHERE deleted_at IS NULL
           AND status IN ('QUEUE','WAITING','RUNNING')
           AND updated_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE)`
      ),
      this.optionalRows(
        `SELECT COUNT(*) AS total
         FROM app_video_generations
         WHERE status IN ('queued','routing','submitting','submitted','processing','storing','provider_status_unknown')
           AND updated_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE)`
      )
    ]);

    return {
      images: Object.fromEntries(imageStatuses.map((row) => [String(row.status || 'unknown').toLowerCase(), Number(row.total || 0)])),
      videos: Object.fromEntries(videoStatuses.map((row) => [String(row.status || 'unknown').toLowerCase(), Number(row.total || 0)])),
      staleImages: Number(staleImages[0]?.total || 0),
      staleVideos: Number(staleVideos[0]?.total || 0)
    };
  }

  async getRecentErrors(from, to, limit = 8) {
    return this.optionalRows(
      `SELECT error_type, endpoint, status_code, created_at
       FROM app_app_errors
       WHERE created_at >= ? AND created_at < ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [from, to, Math.min(20, Math.max(1, Number(limit) || 8))]
    );
  }

  async getTopErrors(from, to, limit = 6) {
    return this.optionalRows(
      `SELECT error_type, COUNT(*) AS total
       FROM app_app_errors
       WHERE created_at >= ? AND created_at < ?
       GROUP BY error_type
       ORDER BY total DESC
       LIMIT ?`,
      [from, to, Math.min(20, Math.max(1, Number(limit) || 6))]
    );
  }
}

module.exports = { MonitoringRepository };
