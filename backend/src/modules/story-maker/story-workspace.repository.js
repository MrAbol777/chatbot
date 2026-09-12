'use strict';

const { v4: uuidv4 } = require('uuid');

const safeJson = (value, fallback = {}) => {
  try { return typeof value === 'string' ? JSON.parse(value) : value || fallback; } catch { return fallback; }
};

class StoryWorkspaceRepository {
  constructor(db) { this.db = db; }

  async create(userId, workspace) {
    await this.db.init();
    const id = `story-${uuidv4()}`;
    const now = new Date();
    await this.db.query(
      `INSERT INTO story_workspaces (workspace_id, user_id, title, idea, status, workspace, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, String(userId), workspace.title, workspace.idea, workspace.status, JSON.stringify(workspace), now, now]
    );
    return { ...workspace, id, createdAt: now.toISOString(), updatedAt: now.toISOString() };
  }

  async list(userId) {
    await this.db.init();
    const [rows] = await this.db.query(
      'SELECT workspace_id, title, idea, status, created_at, updated_at FROM story_workspaces WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50',
      [String(userId)]
    );
    return rows.map((row) => ({ id: row.workspace_id, title: row.title, idea: row.idea, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }));
  }

  async get(userId, id) {
    await this.db.init();
    const [rows] = await this.db.query('SELECT * FROM story_workspaces WHERE workspace_id = ? AND user_id = ? LIMIT 1', [id, String(userId)]);
    if (!rows[0]) return null;
    const row = rows[0];
    return { ...safeJson(row.workspace), id: row.workspace_id, title: row.title, idea: row.idea, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  async update(userId, id, workspace) {
    await this.db.init();
    const now = new Date();
    const [result] = await this.db.query(
      'UPDATE story_workspaces SET title = ?, idea = ?, status = ?, workspace = ?, updated_at = ? WHERE workspace_id = ? AND user_id = ?',
      [workspace.title, workspace.idea, workspace.status, JSON.stringify(workspace), now, id, String(userId)]
    );
    if (!result.affectedRows) return null;
    return { ...workspace, id, updatedAt: now.toISOString() };
  }
}

module.exports = { StoryWorkspaceRepository };
