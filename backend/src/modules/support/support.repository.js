const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const CATEGORIES = new Set(['technical', 'account', 'billing', 'suggestion', 'other']);
const STATUSES = new Set(['open', 'in_progress', 'waiting_user', 'resolved', 'closed']);
const PAGE_SIZE = 30;

const now = () => new Date();
const cleanText = (value, max) => String(value || '').trim().slice(0, max);
const normalizeId = (value) => {
  const id = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : '';
};
const makeCode = () => `SUP-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

function mapMessage(row) {
  return {
    id: row.message_id,
    authorType: row.author_type,
    authorId: row.author_id || null,
    authorName: row.author_type === 'admin' ? 'پشتیبانی دانوآ' : row.author_type === 'system' ? 'دانوآ' : 'شما',
    body: row.body,
    isInternal: Boolean(row.is_internal),
    createdAt: row.created_at
  };
}

function mapTicket(row, messages = []) {
  return {
    id: row.ticket_id,
    code: row.ticket_code,
    userId: row.user_id,
    userName: row.user_name || null,
    userPhone: row.user_phone || null,
    userAge: row.user_age == null ? null : Number(row.user_age),
    subject: row.subject,
    category: row.category,
    priority: row.priority,
    status: row.status,
    assignedAdminUsername: row.assigned_admin_username || null,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    context: row.context || null,
    messages
  };
}

class SupportRepository {
  constructor(db) {
    this.db = db;
  }

  async createTicket({ userId, subject, category = 'technical', message, context = null }) {
    const cleanUserId = cleanText(userId, 191);
    const cleanSubject = cleanText(subject, 255);
    const cleanMessage = cleanText(message, 10000);
    const cleanCategory = CATEGORIES.has(category) ? category : 'other';
    if (!cleanUserId) throw new Error('USER_REQUIRED');
    if (!cleanSubject) throw new Error('SUBJECT_REQUIRED');
    if (!cleanMessage) throw new Error('MESSAGE_REQUIRED');

    const ticketId = uuidv4();
    const messageId = uuidv4();
    const timestamp = now();
    const connection = await this.db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        `INSERT INTO app_support_tickets
          (ticket_id, ticket_code, user_id, subject, context, category, priority, status, last_message_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'normal', 'open', ?, ?, ?)`,
        [ticketId, makeCode(), cleanUserId, cleanSubject, context ? JSON.stringify(context) : null, cleanCategory, timestamp, timestamp, timestamp]
      );
      await connection.query(
        `INSERT INTO app_support_messages
          (message_id, ticket_id, author_type, author_id, body, created_at)
         VALUES (?, ?, 'user', ?, ?, ?)`,
        [messageId, ticketId, cleanUserId, cleanMessage, timestamp]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return this.getForUser(ticketId, cleanUserId);
  }

  async listForUser(userId) {
    const [rows] = await this.db.query(
      `SELECT * FROM app_support_tickets WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100`,
      [String(userId)]
    );
    return rows.map((row) => mapTicket(row));
  }

  async getForUser(ticketId, userId) {
    const id = normalizeId(ticketId);
    if (!id) return null;
    const [rows] = await this.db.query(
      `SELECT * FROM app_support_tickets WHERE ticket_id = ? AND user_id = ? LIMIT 1`,
      [id, String(userId)]
    );
    if (!rows[0]) return null;
    const [messages] = await this.db.query(
      `SELECT * FROM app_support_messages WHERE ticket_id = ? AND is_internal = 0 ORDER BY created_at ASC`,
      [id]
    );
    return mapTicket(rows[0], messages.map(mapMessage));
  }

  async addUserMessage(ticketId, userId, body) {
    const id = normalizeId(ticketId);
    const cleanBody = cleanText(body, 10000);
    if (!id) throw new Error('TICKET_NOT_FOUND');
    if (!cleanBody) throw new Error('MESSAGE_REQUIRED');
    const timestamp = now();
    const [result] = await this.db.query(
      `UPDATE app_support_tickets SET status = 'open', resolved_at = NULL, updated_at = ?, last_message_at = ?
       WHERE ticket_id = ? AND user_id = ?`,
      [timestamp, timestamp, id, String(userId)]
    );
    if (Number(result.affectedRows) !== 1) throw new Error('TICKET_NOT_FOUND');
    await this.db.query(
      `INSERT INTO app_support_messages (message_id, ticket_id, author_type, author_id, body, created_at)
       VALUES (?, ?, 'user', ?, ?, ?)`,
      [uuidv4(), id, String(userId), cleanBody, timestamp]
    );
    return this.getForUser(id, userId);
  }

  async listForAdmin({ status, query, page = 1, pageSize = PAGE_SIZE }) {
    const cleanStatus = STATUSES.has(status) ? status : '';
    const cleanQuery = cleanText(query, 120);
    const size = Math.min(Math.max(Number(pageSize) || PAGE_SIZE, 1), 100);
    const currentPage = Math.max(Number(page) || 1, 1);
    const where = [];
    const params = [];
    if (cleanStatus) { where.push('t.status = ?'); params.push(cleanStatus); }
    if (cleanQuery) {
      where.push('(t.ticket_code LIKE ? OR t.subject LIKE ? OR u.name LIKE ? OR u.user_id LIKE ?)');
      const like = `%${cleanQuery}%`;
      params.push(like, like, like, like);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [countRows] = await this.db.query(
      `SELECT COUNT(*) AS total FROM app_support_tickets t JOIN app_users u ON u.user_id = t.user_id ${clause}`,
      params
    );
    const [rows] = await this.db.query(
      `SELECT t.*, u.name AS user_name, u.phone AS user_phone, u.age AS user_age
       FROM app_support_tickets t JOIN app_users u ON u.user_id = t.user_id
       ${clause} ORDER BY FIELD(t.status, 'open', 'in_progress', 'waiting_user', 'resolved', 'closed'), t.updated_at DESC
       LIMIT ? OFFSET ?`,
      [...params, size, (currentPage - 1) * size]
    );
    return {
      items: rows.map((row) => mapTicket(row)),
      page: currentPage,
      pageSize: size,
      total: Number(countRows[0]?.total || 0)
    };
  }

  async getForAdmin(ticketId) {
    const id = normalizeId(ticketId);
    if (!id) return null;
    const [rows] = await this.db.query(
      `SELECT t.*, u.name AS user_name, u.phone AS user_phone, u.age AS user_age
       FROM app_support_tickets t JOIN app_users u ON u.user_id = t.user_id WHERE t.ticket_id = ? LIMIT 1`,
      [id]
    );
    if (!rows[0]) return null;
    const [messages] = await this.db.query(
      `SELECT * FROM app_support_messages WHERE ticket_id = ? ORDER BY created_at ASC`,
      [id]
    );
    return mapTicket(rows[0], messages.map(mapMessage));
  }

  async addAdminMessage(ticketId, adminUsername, body, isInternal = false) {
    const id = normalizeId(ticketId);
    const cleanBody = cleanText(body, 10000);
    if (!id) throw new Error('TICKET_NOT_FOUND');
    if (!cleanBody) throw new Error('MESSAGE_REQUIRED');
    const timestamp = now();
    const [ticketRows] = await this.db.query('SELECT ticket_id FROM app_support_tickets WHERE ticket_id = ? LIMIT 1', [id]);
    if (!ticketRows[0]) throw new Error('TICKET_NOT_FOUND');
    await this.db.query(
      `INSERT INTO app_support_messages (message_id, ticket_id, author_type, author_id, body, is_internal, created_at)
       VALUES (?, ?, 'admin', ?, ?, ?, ?)`,
      [uuidv4(), id, cleanText(adminUsername, 191), cleanBody, isInternal ? 1 : 0, timestamp]
    );
    await this.db.query(
      `UPDATE app_support_tickets SET updated_at = ?, last_message_at = ?, assigned_admin_username = ?, status = ?
       WHERE ticket_id = ?`,
      [timestamp, timestamp, cleanText(adminUsername, 191), isInternal ? 'in_progress' : 'waiting_user', id]
    );
    return this.getForAdmin(id);
  }

  async updateStatus(ticketId, adminUsername, status) {
    const id = normalizeId(ticketId);
    if (!id || !STATUSES.has(status)) throw new Error('INVALID_STATUS');
    const timestamp = now();
    const [result] = await this.db.query(
      `UPDATE app_support_tickets SET status = ?, assigned_admin_username = ?, updated_at = ?, resolved_at = ? WHERE ticket_id = ?`,
      [status, cleanText(adminUsername, 191), timestamp, status === 'resolved' || status === 'closed' ? timestamp : null, id]
    );
    if (Number(result.affectedRows) !== 1) throw new Error('TICKET_NOT_FOUND');
    return this.getForAdmin(id);
  }
}

module.exports = { SupportRepository, CATEGORIES, STATUSES };
