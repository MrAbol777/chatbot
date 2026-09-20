'use strict';

const { v4: uuidv4 } = require('uuid');

function safeJson(value, fallback = {}) {
  try { return typeof value === 'string' ? JSON.parse(value) : value || fallback; } catch { return fallback; }
}

class AnimationProjectRepository {
  constructor(db) { this.db = db; }

  async create(userId, project) {
    await this.db.init();
    const id = `animation-${uuidv4()}`;
    const now = new Date();
    await this.db.query(
      `INSERT INTO animation_projects (project_id, user_id, title, idea, stage, status, project, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, String(userId), project.title, project.userInput.idea, project.stage, project.status, JSON.stringify(project), now, now]
    );
    return { ...project, id, createdAt: now.toISOString(), updatedAt: now.toISOString() };
  }

  async list(userId) {
    await this.db.init();
    const [rows] = await this.db.query(
      `SELECT project_id, title, idea, stage, status, created_at, updated_at
       FROM animation_projects WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50`,
      [String(userId)]
    );
    return rows.map((row) => ({ id: row.project_id, title: row.title, idea: row.idea, stage: row.stage, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }));
  }

  async get(userId, id) {
    await this.db.init();
    const [rows] = await this.db.query('SELECT * FROM animation_projects WHERE project_id = ? AND user_id = ? LIMIT 1', [id, String(userId)]);
    if (!rows[0]) return null;
    const row = rows[0];
    return { ...safeJson(row.project), id: row.project_id, title: row.title, stage: row.stage, status: row.status, userInput: { ...safeJson(row.project).userInput, idea: row.idea }, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  async update(userId, id, project) {
    await this.db.init();
    const now = new Date();
    const [result] = await this.db.query(
      `UPDATE animation_projects SET title = ?, idea = ?, stage = ?, status = ?, project = ?, updated_at = ?
       WHERE project_id = ? AND user_id = ?`,
      [project.title, project.userInput.idea, project.stage, project.status, JSON.stringify(project), now, id, String(userId)]
    );
    if (!result.affectedRows) return null;
    return { ...project, id, updatedAt: now.toISOString() };
  }

  async createVideoJob(userId, projectId, payload) {
    await this.db.init();
    const [existing] = await this.db.query(
      `SELECT animation_job_id, generation_id, status, payload, created_at, updated_at FROM animation_video_jobs
       WHERE project_id = ? AND user_id = ? AND status IN ('queued', 'processing') ORDER BY updated_at DESC LIMIT 1`,
      [projectId, String(userId)]
    );
    if (existing[0]) return { id: existing[0].animation_job_id, generationId: existing[0].generation_id, status: existing[0].status, payload: safeJson(existing[0].payload), createdAt: existing[0].created_at, updatedAt: existing[0].updated_at };
    const id = `animation-video-${uuidv4()}`;
    const now = new Date();
    await this.db.query(
      `INSERT INTO animation_video_jobs (animation_job_id, project_id, user_id, generation_id, status, payload, created_at, updated_at)
       VALUES (?, ?, ?, NULL, 'queued', ?, ?, ?)`,
      [id, projectId, String(userId), JSON.stringify(payload), now, now]
    );
    return { id, generationId: null, status: 'queued', payload, createdAt: now.toISOString(), updatedAt: now.toISOString() };
  }

  async updateVideoJob(userId, projectId, status, generationId = '') {
    await this.db.init();
    const now = new Date();
    await this.db.query(
      `UPDATE animation_video_jobs SET status = ?, generation_id = COALESCE(NULLIF(?, ''), generation_id), updated_at = ?
       WHERE project_id = ? AND user_id = ? ORDER BY updated_at DESC LIMIT 1`,
      [status, generationId, now, projectId, String(userId)]
    );
  }

  async getVideoJob(userId, projectId) {
    await this.db.init();
    const [jobs] = await this.db.query(`SELECT * FROM animation_video_jobs WHERE project_id=? AND user_id=? ORDER BY updated_at DESC LIMIT 1`, [projectId, String(userId)]);
    if (!jobs[0]) return null;
    const [scenes] = await this.db.query(`SELECT * FROM animation_video_scenes WHERE animation_job_id=? ORDER BY scene_order`, [jobs[0].animation_job_id]);
    return { id: jobs[0].animation_job_id, projectId: jobs[0].project_id, status: jobs[0].status, payload: safeJson(jobs[0].payload), finalStorageKey: jobs[0].final_storage_key || null, errorCode: jobs[0].safe_error_code || null, errorMessage: jobs[0].safe_error_message || null, scenes: scenes.map((scene) => ({ id: scene.animation_scene_job_id, sourceSceneId: scene.source_scene_id, order: scene.scene_order, status: scene.status, durationSeconds: scene.duration_seconds, generationId: scene.video_generation_id || null, outputStorageKey: scene.output_storage_key || null, errorCode: scene.safe_error_code || null, errorMessage: scene.safe_error_message || null, retryCount: Number(scene.retry_count || 0) })) };
  }

  async retryVideoScene(userId, projectId, sourceSceneId) {
    await this.db.init();
    const [result] = await this.db.query(`UPDATE animation_video_scenes s JOIN animation_video_jobs j ON j.animation_job_id=s.animation_job_id SET s.status='retrying',s.retry_count=s.retry_count+1,s.video_generation_id=NULL,s.output_storage_key=NULL,s.safe_error_code=NULL,s.safe_error_message=NULL,s.updated_at=NOW(),j.status='retrying',j.safe_error_code=NULL,j.safe_error_message=NULL,j.updated_at=NOW() WHERE j.project_id=? AND j.user_id=? AND s.source_scene_id=? AND s.status='failed'`, [projectId, String(userId), sourceSceneId]);
    return result.affectedRows === 1;
  }
}

module.exports = { AnimationProjectRepository };
