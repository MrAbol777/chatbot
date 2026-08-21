const ALLOWED_AUDIENCE_TYPES = new Set(['all', 'some', 'one']);
const ALLOWED_DISPLAY_MODES = new Set([
  'toast',
  'notification',
  'dismissible_modal',
  'required_modal',
  'modal_and_notification'
]);
const ALLOWED_PRIORITIES = new Set(['low', 'normal', 'high']);
const ALLOWED_STATUSES = new Set(['draft', 'scheduled', 'published', 'cancelled', 'expired']);

const toStringOrNull = (value, maxLength = 2048) => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
};

const normalizeUrl = (value) => {
  const text = toStringOrNull(value, 2048);
  if (!text) return null;
  try {
    const parsed = new URL(text, 'https://danoa.invalid');
    if (parsed.protocol === 'javascript:' || parsed.protocol === 'data:') return null;
    if (parsed.origin === 'https://danoa.invalid') {
      return text.startsWith('/') ? text : null;
    }
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? text : null;
  } catch {
    return null;
  }
};

const normalizeUserIds = (value) => Array.from(new Set(
  (Array.isArray(value) ? value : [])
    .map((item) => (typeof item === 'string' || typeof item === 'number' ? String(item).trim() : ''))
    .filter(Boolean)
)).slice(0, 10000);

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const serializeMessage = (row) => ({
  id: String(row.id),
  title: row.title || '',
  message: row.message,
  imageUrl: row.image_url || null,
  actionUrl: row.action_url || null,
  actionLabel: row.action_label || null,
  displayMode: row.display_mode,
  priority: row.priority,
  audienceType: row.audience_type,
  audienceUserIds: parseJsonArray(row.audience_user_ids),
  status: row.status,
  scheduledAt: row.scheduled_at || null,
  expiresAt: row.expires_at || null,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  publishedAt: row.published_at,
  recipientCount: Number(row.recipient_count || 0),
  viewedCount: Number(row.viewed_count || 0),
  clickedCount: Number(row.clicked_count || 0),
  acknowledgedCount: Number(row.acknowledged_count || 0)
});

const serializeRecipient = (row) => ({
  id: String(row.id),
  title: row.title || '',
  message: row.message,
  imageUrl: row.image_url || null,
  actionUrl: row.action_url || null,
  actionLabel: row.action_label || null,
  displayMode: row.display_mode,
  priority: row.priority,
  createdAt: row.created_at,
  publishedAt: row.published_at,
  expiresAt: row.expires_at,
  viewedAt: row.viewed_at,
  dismissedAt: row.dismissed_at,
  acknowledgedAt: row.acknowledged_at,
  clickedAt: row.clicked_at,
  unread: !row.viewed_at && !row.dismissed_at && !row.acknowledged_at
});

function createBroadcastMessagesRepository(db) {
  const getConnection = () => (typeof db.getConnection === 'function' ? db.getConnection() : null);

  const validateInput = (input = {}, { allowDraft = true } = {}) => {
    const message = typeof input.message === 'string' ? input.message.trim() : '';
    const title = toStringOrNull(input.title, 191);
    const audienceType = String(input.audienceType || '').trim().toLowerCase();
    const displayMode = String(input.displayMode || 'notification').trim().toLowerCase();
    const priority = String(input.priority || 'normal').trim().toLowerCase();
    const audienceUserIds = normalizeUserIds(input.audienceUserIds);
    const status = String(input.status || '').trim().toLowerCase();
    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;

    if (!message) throw new Error('MESSAGE_REQUIRED');
    if (message.length > 30000) throw new Error('MESSAGE_TOO_LONG');
    if (!ALLOWED_AUDIENCE_TYPES.has(audienceType)) throw new Error('INVALID_AUDIENCE_TYPE');
    if (!ALLOWED_DISPLAY_MODES.has(displayMode)) throw new Error('INVALID_DISPLAY_MODE');
    if (!ALLOWED_PRIORITIES.has(priority)) throw new Error('INVALID_PRIORITY');
    if (audienceType === 'one' && audienceUserIds.length !== 1) throw new Error('ONE_USER_REQUIRED');
    if (audienceType === 'some' && audienceUserIds.length === 0) throw new Error('USERS_REQUIRED');
    if (audienceType === 'all' && audienceUserIds.length > 0) throw new Error('ALL_USERS_CANNOT_HAVE_IDS');
    if (scheduledAt && Number.isNaN(scheduledAt.getTime())) throw new Error('INVALID_SCHEDULE_DATE');
    if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new Error('INVALID_EXPIRY_DATE');
    if (scheduledAt && scheduledAt.getTime() <= Date.now() && status === 'scheduled') throw new Error('SCHEDULE_MUST_BE_FUTURE');
    if (expiresAt && scheduledAt && expiresAt.getTime() <= scheduledAt.getTime()) throw new Error('EXPIRY_MUST_BE_AFTER_SCHEDULE');
    if (!allowDraft && status === 'draft') throw new Error('INVALID_STATUS');

    return {
      title,
      message,
      imageUrl: normalizeUrl(input.imageUrl),
      actionUrl: normalizeUrl(input.actionUrl),
      actionLabel: toStringOrNull(input.actionLabel, 191),
      displayMode,
      priority,
      audienceType,
      audienceUserIds,
      status: ALLOWED_STATUSES.has(status) ? status : 'draft',
      scheduledAt,
      expiresAt
    };
  };

  const resolveRecipients = async (connection, audienceType, audienceUserIds) => {
    if (audienceType === 'all') {
      const [result] = await connection.query(
        `INSERT IGNORE INTO app_broadcast_recipients (message_id, user_id, delivered_at)
         SELECT ?, user_id, NOW() FROM app_users WHERE is_banned = 0`,
        [connection.__broadcastMessageId]
      );
      return Number(result.affectedRows || 0);
    }

    const ids = normalizeUserIds(audienceUserIds);
    if (!ids.length) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const [result] = await connection.query(
      `INSERT IGNORE INTO app_broadcast_recipients (message_id, user_id, delivered_at)
       SELECT ?, user_id, NOW() FROM app_users WHERE is_banned = 0 AND user_id IN (${placeholders})`,
      [connection.__broadcastMessageId, ...ids]
    );
    return Number(result.affectedRows || 0);
  };

  const insertRecipients = async (connection, messageId, audienceType, audienceUserIds) => {
    connection.__broadcastMessageId = messageId;
    try {
      return await resolveRecipients(connection, audienceType, audienceUserIds);
    } finally {
      delete connection.__broadcastMessageId;
    }
  };

  const create = async (input = {}, createdBy) => {
    await db.init();
    const normalized = validateInput(input);
    const requestedStatus = normalized.status;
    const sendNow = input.sendMode === 'now' || requestedStatus === 'published';
    const status = sendNow ? 'published' : requestedStatus === 'scheduled' ? 'scheduled' : 'draft';
    if (status === 'scheduled' && !normalized.scheduledAt) throw new Error('SCHEDULE_DATE_REQUIRED');
    if (status === 'published' && normalized.scheduledAt && normalized.scheduledAt.getTime() > Date.now()) {
      throw new Error('USE_SCHEDULED_FOR_FUTURE');
    }

    const connection = await getConnection();
    if (!connection) throw new Error('DATABASE_TRANSACTION_UNAVAILABLE');
    try {
      await connection.beginTransaction();
      const [result] = await connection.query(
        `INSERT INTO app_broadcast_messages
          (title, message, image_url, action_url, action_label, display_mode, priority,
           audience_type, audience_user_ids, status, scheduled_at, expires_at, created_by,
           created_at, updated_at, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?)` ,
        [
          normalized.title,
          normalized.message,
          normalized.imageUrl,
          normalized.actionUrl,
          normalized.actionLabel,
          normalized.displayMode,
          normalized.priority,
          normalized.audienceType,
          JSON.stringify(normalized.audienceUserIds),
          status,
          normalized.scheduledAt,
          normalized.expiresAt,
          String(createdBy || '').trim(),
          status === 'published' ? new Date() : null
        ]
      );
      const messageId = Number(result.insertId);
      let recipientCount = 0;
      if (status === 'published') {
        recipientCount = await insertRecipients(connection, messageId, normalized.audienceType, normalized.audienceUserIds);
      }
      await connection.commit();
      return { id: String(messageId), status, recipientCount };
    } catch (error) {
      if (typeof connection.rollback === 'function') await connection.rollback();
      throw error;
    } finally {
      if (typeof connection.release === 'function') connection.release();
    }
  };

  const activateDueMessages = async () => {
    await db.init();
    const connection = await getConnection();
    if (!connection) return 0;
    let activated = 0;
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query(
        `SELECT * FROM app_broadcast_messages
         WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= NOW()
         ORDER BY scheduled_at ASC LIMIT 50 FOR UPDATE`
      );
      for (const row of rows) {
        await connection.query(
          `UPDATE app_broadcast_messages SET status = 'published', published_at = NOW(), updated_at = NOW() WHERE id = ? AND status = 'scheduled'`,
          [row.id]
        );
        await insertRecipients(connection, row.id, row.audience_type, parseJsonArray(row.audience_user_ids));
        activated += 1;
      }
      await connection.query(
        `UPDATE app_broadcast_messages SET status = 'expired', updated_at = NOW()
         WHERE status IN ('published', 'scheduled') AND expires_at IS NOT NULL AND expires_at <= NOW()`
      );
      await connection.commit();
      return activated;
    } catch (error) {
      if (typeof connection.rollback === 'function') await connection.rollback();
      throw error;
    } finally {
      if (typeof connection.release === 'function') connection.release();
    }
  };

  const list = async ({ page = 1, pageSize = 20, status = '', query = '' } = {}) => {
    await activateDueMessages();
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 20));
    const offset = (safePage - 1) * safePageSize;
    const filters = [];
    const params = [];
    if (ALLOWED_STATUSES.has(status)) {
      filters.push('m.status = ?');
      params.push(status);
    }
    if (String(query || '').trim()) {
      filters.push('(m.title LIKE ? OR m.message LIKE ?)');
      const like = `%${String(query).trim().slice(0, 100)}%`;
      params.push(like, like);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const [countRows] = await db.query(`SELECT COUNT(*) AS total FROM app_broadcast_messages m ${where}`, params);
    const [rows] = await db.query(
      `SELECT m.*,
         COUNT(r.user_id) AS recipient_count,
         SUM(r.viewed_at IS NOT NULL) AS viewed_count,
         SUM(r.clicked_at IS NOT NULL) AS clicked_count,
         SUM(r.acknowledged_at IS NOT NULL) AS acknowledged_count
       FROM app_broadcast_messages m
       LEFT JOIN app_broadcast_recipients r ON r.message_id = m.id
       ${where}
       GROUP BY m.id ORDER BY m.created_at DESC LIMIT ? OFFSET ?`,
      [...params, safePageSize, offset]
    );
    return {
      items: rows.map(serializeMessage),
      total: Number(countRows[0]?.total || 0),
      page: safePage,
      pageSize: safePageSize
    };
  };

  const getById = async (id) => {
    await activateDueMessages();
    const [rows] = await db.query(
      `SELECT m.*,
         COUNT(r.user_id) AS recipient_count,
         SUM(r.viewed_at IS NOT NULL) AS viewed_count,
         SUM(r.clicked_at IS NOT NULL) AS clicked_count,
         SUM(r.acknowledged_at IS NOT NULL) AS acknowledged_count
       FROM app_broadcast_messages m
       LEFT JOIN app_broadcast_recipients r ON r.message_id = m.id
       WHERE m.id = ? GROUP BY m.id LIMIT 1`,
      [String(id)]
    );
    return rows[0] ? serializeMessage(rows[0]) : null;
  };

  const cancel = async (id) => {
    await db.init();
    const [result] = await db.query(
      `UPDATE app_broadcast_messages SET status = 'cancelled', updated_at = NOW()
       WHERE id = ? AND status IN ('draft', 'scheduled')`,
      [String(id)]
    );
    return result.affectedRows > 0;
  };

  const remove = async (id) => {
    await db.init();
    const [result] = await db.query(
      `DELETE FROM app_broadcast_messages WHERE id = ? AND status IN ('draft', 'cancelled')`,
      [String(id)]
    );
    return result.affectedRows > 0;
  };

  const listUsers = async ({ page = 1, pageSize = 20, query = '' } = {}) => {
    await db.init();
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.min(50, Math.max(1, Number(pageSize) || 20));
    const offset = (safePage - 1) * safePageSize;
    const filters = ['is_banned = 0'];
    const params = [];
    const text = String(query || '').trim();
    if (text) {
      filters.push('(name LIKE ? OR phone LIKE ? OR user_id LIKE ?)');
      const like = `%${text.slice(0, 100)}%`;
      params.push(like, like, like);
    }
    const where = filters.join(' AND ');
    const [countRows] = await db.query(`SELECT COUNT(*) AS total FROM app_users WHERE ${where}`, params);
    const [rows] = await db.query(
      `SELECT user_id, name, phone, age, registered_at, last_active
       FROM app_users WHERE ${where} ORDER BY last_active DESC, registered_at DESC LIMIT ? OFFSET ?`,
      [...params, safePageSize, offset]
    );
    return {
      items: rows.map((row) => ({
        userId: row.user_id,
        name: row.name,
        phone: row.phone || '',
        age: Number(row.age || 0),
        registeredAt: row.registered_at,
        lastActive: row.last_active
      })),
      total: Number(countRows[0]?.total || 0),
      page: safePage,
      pageSize: safePageSize
    };
  };

  const listForUser = async (userId, limit = 30) => {
    await activateDueMessages();
    await db.query(
      `UPDATE app_broadcast_messages SET status = 'expired', updated_at = NOW()
       WHERE status = 'published' AND expires_at IS NOT NULL AND expires_at <= NOW()`
    );
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 30));
    const [rows] = await db.query(
      `SELECT m.*, r.viewed_at, r.dismissed_at, r.acknowledged_at, r.clicked_at
       FROM app_broadcast_recipients r
       INNER JOIN app_broadcast_messages m ON m.id = r.message_id
       WHERE r.user_id = ? AND m.status = 'published'
         AND (m.expires_at IS NULL OR m.expires_at > NOW())
         AND r.dismissed_at IS NULL AND r.acknowledged_at IS NULL
       ORDER BY CASE m.priority WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, m.published_at DESC
       LIMIT ?`,
      [String(userId), safeLimit]
    );
    return rows.map(serializeRecipient);
  };

  const mark = async (messageId, userId, field) => {
    const allowed = new Set(['viewed_at', 'dismissed_at', 'acknowledged_at', 'clicked_at']);
    if (!allowed.has(field)) throw new Error('INVALID_MESSAGE_ACTION');
    await db.query(
      `UPDATE app_broadcast_recipients SET ${field} = COALESCE(${field}, NOW()) WHERE message_id = ? AND user_id = ?`,
      [String(messageId), String(userId)]
    );
  };

  const getStats = async (id) => {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS recipient_count,
        SUM(viewed_at IS NOT NULL) AS viewed_count,
        SUM(dismissed_at IS NOT NULL) AS dismissed_count,
        SUM(acknowledged_at IS NOT NULL) AS acknowledged_count,
        SUM(clicked_at IS NOT NULL) AS clicked_count
       FROM app_broadcast_recipients WHERE message_id = ?`,
      [String(id)]
    );
    const row = rows[0] || {};
    return {
      recipientCount: Number(row.recipient_count || 0),
      viewedCount: Number(row.viewed_count || 0),
      dismissedCount: Number(row.dismissed_count || 0),
      acknowledgedCount: Number(row.acknowledged_count || 0),
      clickedCount: Number(row.clicked_count || 0)
    };
  };

  return { validateInput, create, activateDueMessages, list, getById, cancel, remove, listUsers, listForUser, mark, getStats };
}

module.exports = {
  createBroadcastMessagesRepository,
  normalizeUserIds,
  serializeMessage,
  serializeRecipient
};
