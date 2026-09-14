'use strict';

const { v4: uuidv4 } = require('uuid');

const safeJson = (value, fallback = {}) => {
  try { return typeof value === 'string' ? JSON.parse(value) : value || fallback; } catch { return fallback; }
};

class StoryboardWorkspaceRepository {
  constructor(db) { this.db = db; }

  async create(userId, workspace) {
    await this.db.init();
    const id = `storyboard-${uuidv4()}`;
    const now = new Date();
    await this.db.query(
      `INSERT INTO storyboard_workspaces (workspace_id, user_id, title, script, status, workspace, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, String(userId), workspace.title, workspace.script, workspace.status, JSON.stringify(workspace), now, now]
    );
    return { ...workspace, id, createdAt: now.toISOString(), updatedAt: now.toISOString() };
  }

  async list(userId) {
    await this.db.init();
    const [rows] = await this.db.query(
      'SELECT workspace_id, title, script, status, created_at, updated_at FROM storyboard_workspaces WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50',
      [String(userId)]
    );
    return rows.map((row) => ({ id: row.workspace_id, title: row.title, script: row.script, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }));
  }

  async get(userId, id) {
    await this.db.init();
    const [rows] = await this.db.query('SELECT * FROM storyboard_workspaces WHERE workspace_id = ? AND user_id = ? LIMIT 1', [id, String(userId)]);
    if (!rows[0]) return null;
    const row = rows[0];
    return { ...safeJson(row.workspace), id: row.workspace_id, title: row.title, script: row.script, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  async update(userId, id, workspace) {
    await this.db.init();
    const now = new Date();
    const [result] = await this.db.query(
      'UPDATE storyboard_workspaces SET title = ?, script = ?, status = ?, workspace = ?, updated_at = ? WHERE workspace_id = ? AND user_id = ?',
      [workspace.title, workspace.script, workspace.status, JSON.stringify(workspace), now, id, String(userId)]
    );
    if (!result.affectedRows) return null;
    return { ...workspace, id, updatedAt: now.toISOString() };
  }
}

module.exports = { StoryboardWorkspaceRepository };
