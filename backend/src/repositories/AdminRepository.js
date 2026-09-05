class AdminRepository {
  constructor(db) {
    this.db = db;
  }

  async findByUsername(username) {
    if (!username || typeof username !== 'string') return null;
    const [rows] = await this.db.query(
      `SELECT id, username, password_hash, role, created_at, updated_at
       FROM app_admins
       WHERE username = ?
       LIMIT 1`,
      [username.trim()]
    );
    return rows[0] || null;
  }

  async findById(id) {
    if (id === undefined || id === null || String(id).trim() === '') return null;
    const [rows] = await this.db.query(
      `SELECT id, username, password_hash, role, created_at, updated_at
       FROM app_admins
       WHERE id = ?
       LIMIT 1`,
      [String(id).trim()]
    );
    return rows[0] || null;
  }

  async listAll() {
    const [rows] = await this.db.query(
      `SELECT id, username, password_hash, role, created_at, updated_at
       FROM app_admins
       ORDER BY created_at ASC`
    );
    return rows;
  }

  async createOrUpdate({ id, username, password_hash, role = 'superadmin', created_at = new Date(), updated_at = new Date() }) {
    await this.db.query(
      `INSERT INTO app_admins (id, username, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         password_hash = VALUES(password_hash),
         role = VALUES(role),
         updated_at = VALUES(updated_at)`,
      [String(id), String(username).trim(), password_hash, role, new Date(created_at), new Date(updated_at)]
    );
    return this.findByUsername(username);
  }

  async appendAuditLog({ adminUsername = null, action, target = null, details = null }) {
    if (!action) return null;
    const detailsJson = details ? JSON.stringify(details) : null;
    const [result] = await this.db.query(
      `INSERT INTO app_admin_audit_logs (admin_username, action, target, details, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [adminUsername ? String(adminUsername).trim() : null, String(action).trim(), target ? String(target).trim() : null, detailsJson, new Date()]
    );
    return { id: result.insertId, action, created_at: new Date() };
  }

  async revokeSession({ sessionHash, adminUsername = null, adminId = null }) {
    const target = String(sessionHash || '').trim();
    if (!target) return false;
    await this.appendAuditLog({
      adminUsername,
      action: 'admin_session_revoked',
      target,
      details: adminId === undefined || adminId === null ? {} : { adminId: String(adminId) }
    });
    return true;
  }

  async isSessionRevoked(sessionHash) {
    const target = String(sessionHash || '').trim();
    if (!target) return true;
    const [rows] = await this.db.query(
      `SELECT id
       FROM app_admin_audit_logs
       WHERE action = 'admin_session_revoked' AND target = ?
       LIMIT 1`,
      [target]
    );
    return Boolean(rows[0]);
  }

  async listAuditLogs({ page = 1, pageSize = 20, action = '', adminUsername = '' } = {}) {
    const safePage = Math.max(1, Number.parseInt(String(page), 10) || 1);
    const safePageSize = Math.min(100, Math.max(1, Number.parseInt(String(pageSize), 10) || 20));
    const offset = (safePage - 1) * safePageSize;

    const whereClauses = [];
    const params = [];

    if (action && typeof action === 'string' && action.trim()) {
      whereClauses.push('action = ?');
      params.push(action.trim());
    }
    if (adminUsername && typeof adminUsername === 'string' && adminUsername.trim()) {
      whereClauses.push('admin_username = ?');
      params.push(adminUsername.trim());
    }

    const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const [countResult, itemsResult] = await Promise.all([
      this.db.query(`SELECT COUNT(*) AS total FROM app_admin_audit_logs ${where}`, params),
      this.db.query(
        `SELECT id, admin_username AS adminUsername, action, target, details, created_at AS timestamp
         FROM app_admin_audit_logs
         ${where}
         ORDER BY id DESC
         LIMIT ? OFFSET ?`,
        [...params, safePageSize, offset]
      )
    ]);

    const countRows = Array.isArray(countResult) ? countResult[0] : countResult;
    const rows = Array.isArray(itemsResult) ? itemsResult[0] : itemsResult;
    const total = (Array.isArray(countRows) ? countRows[0]?.total : countRows?.total) || 0;

    const items = rows.map((row) => ({
      id: row.id,
      adminUsername: row.adminUsername,
      action: row.action,
      target: row.target,
      details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details || {},
      timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp
    }));

    return {
      items,
      total: Number(total || 0),
      page: safePage,
      pageSize: safePageSize
    };
  }
}

module.exports = AdminRepository;
