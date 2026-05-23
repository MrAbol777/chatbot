const path = require('path');
const {
  DAY_MS,
  sanitizePhone,
  safeJsonArray,
  getStartOfToday,
  buildDailySeries,
  parseAuditLogFile
} = require('./helpers');

class AnalyticsRepository {
  constructor(db, { auditLogPath } = {}) {
    this.db = db;
    this.auditLogPath = auditLogPath || path.join(__dirname, '../../audit.log');
  }

  async readDB() {
    await this.db.init();
    const [[users], [events], [errors], [conversations]] = await Promise.all([
      this.db.query('SELECT * FROM app_users'),
      this.db.query('SELECT * FROM app_events'),
      this.db.query('SELECT * FROM app_app_errors'),
      this.db.query('SELECT * FROM app_conversations')
    ]);

    return {
      users: users.map((u) => ({ ...u, isBanned: Boolean(u.is_banned) })),
      events: events.map((e) => ({
        ...e,
        metadata: typeof e.metadata === 'string' ? e.metadata : JSON.stringify(e.metadata || {})
      })),
      errors,
      conversations: conversations.map((c) => {
        const messages = typeof c.messages === 'string' ? JSON.parse(c.messages || '[]') : c.messages;
        return { ...c, messages: safeJsonArray(messages) };
      })
    };
  }

  async getStats() {
    const data = await this.readDB();
    return {
      userCount: data.users.length,
      eventCount: data.events.length,
      errorCount: data.errors.length,
      conversationCount: data.conversations.length,
      latestUsers: data.users.slice(-5),
      latestErrors: data.errors.slice(-5),
      latestConversations: data.conversations.slice(-5).map((item) => ({
        user_id: item.user_id,
        conversation_id: item.conversation_id,
        message_count: safeJsonArray(item.messages).length,
        updated_at: item.updated_at || null
      }))
    };
  }

  async getTotalUsers() {
    await this.db.init();
    return (await this.db.query('SELECT COUNT(*) AS c FROM app_users'))[0][0].c;
  }

  async getActiveUsersToday() {
    await this.db.init();
    return (
      await this.db.query(
        "SELECT COUNT(DISTINCT user_id) AS c FROM app_events WHERE event_type='message_sent' AND created_at >= ?",
        [new Date(Date.now() - DAY_MS)]
      )
    )[0][0].c;
  }

  async getApiCallsToday() {
    await this.db.init();
    return (
      await this.db.query(
        "SELECT COUNT(*) AS c FROM app_events WHERE event_type='message_sent' AND created_at >= ?",
        [new Date(getStartOfToday())]
      )
    )[0][0].c;
  }

  async getErrorCountToday() {
    await this.db.init();
    return (await this.db.query('SELECT COUNT(*) AS c FROM app_app_errors WHERE created_at >= ?', [new Date(getStartOfToday())]))[0][0].c;
  }

  async getUserGrowth(days = 7) {
    await this.db.init();
    const [rows] = await this.db.query('SELECT registered_at FROM app_users');
    const series = buildDailySeries(days);
    for (const row of rows) {
      const ts = new Date(row.registered_at || 0).getTime();
      const day = series.find((item) => ts >= item.start && ts < item.end);
      if (day) day.count += 1;
    }
    return series.map(({ date, count }) => ({ date, users: count }));
  }

  async getApiUsage(days = 7) {
    await this.db.init();
    const [rows] = await this.db.query("SELECT created_at FROM app_events WHERE event_type='message_sent'");
    const series = buildDailySeries(days);
    for (const row of rows) {
      const ts = new Date(row.created_at || 0).getTime();
      const day = series.find((item) => ts >= item.start && ts < item.end);
      if (day) day.count += 1;
    }
    return series.map(({ date, count }) => ({ date, calls: count }));
  }

  async getErrorDistribution() {
    await this.db.init();
    const [rows] = await this.db.query('SELECT error_type, COUNT(*) AS count FROM app_app_errors GROUP BY error_type');
    return rows;
  }

  getRecentAuditLogs(limit = 10) {
    return parseAuditLogFile(this.auditLogPath, limit);
  }

  async listUsersWithConversationStats({ search = '', phone = '', isBanned, page = 1, pageSize = 20 } = {}) {
    const data = await this.readDB();
    const normalizedSearch = String(search || '').trim().toLowerCase();
    const normalizedSearchPhone = sanitizePhone(search);
    const normalizedPhone = sanitizePhone(phone);
    const safePage = Math.max(1, Number.parseInt(String(page), 10) || 1);
    const safePageSize = Math.min(100, Math.max(1, Number.parseInt(String(pageSize), 10) || 20));

    const byUser = new Map();
    for (const c of data.conversations) {
      const key = String(c.user_id || '');
      if (!byUser.has(key)) byUser.set(key, []);
      byUser.get(key).push(c);
    }

    let users = data.users.map((user) => {
      const userConversations = byUser.get(String(user.user_id)) || [];
      const lastConversationTime = userConversations
        .map((item) => item.updated_at || item.created_at || null)
        .filter(Boolean)
        .sort()
        .pop();
      return {
        ...user,
        isBanned: Boolean(user.is_banned),
        conversationCount: userConversations.length,
        last_activity: user.last_active || lastConversationTime || user.registered_at || null
      };
    });

    if (normalizedSearch)
      users = users.filter((user) => {
        const byName = String(user.name || '').toLowerCase().includes(normalizedSearch);
        const byId = String(user.user_id || '').toLowerCase().includes(normalizedSearch);
        const userPhone = sanitizePhone(user.phone) || '';
        const byPhone = normalizedSearchPhone ? userPhone.includes(normalizedSearchPhone) : false;
        return byName || byId || byPhone;
      });
    if (normalizedPhone) users = users.filter((user) => sanitizePhone(user.phone) === normalizedPhone);
    if (typeof isBanned === 'boolean') users = users.filter((user) => Boolean(user.isBanned) === isBanned);

    users.sort((a, b) => new Date(b.last_activity || 0).getTime() - new Date(a.last_activity || 0).getTime());
    const total = users.length;
    const start = (safePage - 1) * safePageSize;
    return { items: users.slice(start, start + safePageSize), total, page: safePage, pageSize: safePageSize };
  }
}

module.exports = { AnalyticsRepository };
