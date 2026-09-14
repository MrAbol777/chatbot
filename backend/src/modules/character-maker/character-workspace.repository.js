'use strict';

const { v4: uuidv4 } = require('uuid');

const safeJson = (value, fallback = {}) => {
  try { return typeof value === 'string' ? JSON.parse(value) : value || fallback; } catch { return fallback; }
};

const withAssetReferences = (workspace, workspaceId) => {
  const baseReference = `dana://character-workspaces/${workspaceId}`;
  const analysis = workspace?.analysis;
  if (!analysis) return { ...workspace, reference: baseReference };
  return {
    ...workspace,
    reference: baseReference,
    analysis: {
      ...analysis,
      characters: (analysis.characters || []).map((character) => ({
        ...character,
        reference: `${baseReference}/assets/${character.assetId}`,
        characterSheetReference: `${baseReference}/assets/${character.sheetAssetId}`
      })),
      setting: analysis.setting ? { ...analysis.setting, reference: `${baseReference}/assets/${analysis.setting.assetId}` } : analysis.setting
    }
  };
};

class CharacterWorkspaceRepository {
  constructor(db) { this.db = db; }

  async create(userId, workspace) {
    await this.db.init();
    const id = `character-${uuidv4()}`;
    const now = new Date();
    await this.db.query(
      `INSERT INTO character_workspaces (workspace_id, user_id, title, scenario, status, workspace, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, String(userId), workspace.title, workspace.scenario, workspace.status, JSON.stringify(workspace), now, now]
    );
    return withAssetReferences({ ...workspace, id, createdAt: now.toISOString(), updatedAt: now.toISOString() }, id);
  }

  async list(userId) {
    await this.db.init();
    const [rows] = await this.db.query(
      'SELECT workspace_id, title, status, created_at, updated_at FROM character_workspaces WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50',
      [String(userId)]
    );
    return rows.map((row) => ({ id: row.workspace_id, reference: `dana://character-workspaces/${row.workspace_id}`, title: row.title, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }));
  }

  async get(userId, id) {
    await this.db.init();
    const [rows] = await this.db.query('SELECT * FROM character_workspaces WHERE workspace_id = ? AND user_id = ? LIMIT 1', [id, String(userId)]);
    if (!rows[0]) return null;
    const row = rows[0];
    return withAssetReferences({ ...safeJson(row.workspace), id: row.workspace_id, title: row.title, scenario: row.scenario, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }, row.workspace_id);
  }

  async update(userId, id, workspace) {
    await this.db.init();
    const now = new Date();
    const [result] = await this.db.query(
      'UPDATE character_workspaces SET title = ?, scenario = ?, status = ?, workspace = ?, updated_at = ? WHERE workspace_id = ? AND user_id = ?',
      [workspace.title, workspace.scenario, workspace.status, JSON.stringify(workspace), now, id, String(userId)]
    );
    if (!result.affectedRows) return null;
    return withAssetReferences({ ...workspace, id, updatedAt: now.toISOString() }, id);
  }
}

module.exports = { CharacterWorkspaceRepository, withAssetReferences };
