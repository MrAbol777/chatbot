'use strict';

const { randomUUID } = require('node:crypto');

const safe = (value, max = 1800) => String(value || '').trim().slice(0, max);
const terminal = new Set(['completed', 'failed']);

// This orchestrator never calls a provider directly. It creates normal
// image-to-video generation records, then lets the existing video worker own
// provider submission, polling and result storage.
function createAnimationVideoPipeline({ db, videoService, inputMedia, imageStorage, montage, logger = console }) {
  if (!db || !videoService || !inputMedia || !imageStorage || !montage) throw new Error('ANIMATION_VIDEO_PIPELINE_DEPENDENCIES_REQUIRED');

  const query = (...args) => db.query(...args);
  const rows = async (sql, params) => (await query(sql, params))[0];
  const workerId = `animation-pipeline-${randomUUID().slice(0, 8)}`;

  async function seedScenes(job) {
    const snapshot = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
    const scenes = snapshot?.approvedSnapshot?.storyboard?.scenes;
    if (!Array.isArray(scenes) || !scenes.length) throw Object.assign(new Error('ANIMATION_STORYBOARD_SNAPSHOT_REQUIRED'), { code: 'ANIMATION_STORYBOARD_SNAPSHOT_REQUIRED' });
    for (let index = 0; index < scenes.length; index += 1) {
      const scene = scenes[index];
      await query(`INSERT IGNORE INTO animation_video_scenes (animation_scene_job_id,animation_job_id,source_scene_id,scene_order,status,duration_seconds,storyboard_image_job_id,created_at,updated_at) VALUES (?,?,?,?, 'queued',?,?,NOW(),NOW())`, [
        `animation-scene-${randomUUID()}`, job.animation_job_id, safe(scene.sourceSceneId || scene.id, 80), index + 1, Math.max(1, Number(scene.durationSeconds || 0)), safe(scene.imageJobId, 80) || null
      ]);
    }
    return snapshot;
  }

  async function failJob(jobId, code, message) {
    await query(`UPDATE animation_video_jobs SET status='failed',safe_error_code=?,safe_error_message=?,updated_at=NOW() WHERE animation_job_id=?`, [safe(code, 100), safe(message, 500), jobId]);
    await query(`UPDATE animation_projects p JOIN animation_video_jobs j ON j.project_id=p.project_id SET p.status='failed',p.stage='error',p.updated_at=NOW() WHERE j.animation_job_id=?`, [jobId]);
  }

  async function submitScene(job, scene, snapshot) {
    if (!scene.storyboard_image_job_id) throw Object.assign(new Error('ANIMATION_STORYBOARD_FRAME_REFERENCE_REQUIRED'), { code: 'ANIMATION_STORYBOARD_FRAME_REFERENCE_REQUIRED' });
    const imageRows = await rows(`SELECT result_storage_key,result_mime_type FROM app_image_to_image_jobs WHERE id=? AND user_id=? AND status='succeeded'`, [scene.storyboard_image_job_id, job.user_id]);
    if (!imageRows[0]?.result_storage_key) throw Object.assign(new Error('ANIMATION_STORYBOARD_FRAME_NOT_READY'), { code: 'ANIMATION_STORYBOARD_FRAME_NOT_READY' });
    const buffer = await imageStorage.read(imageRows[0].result_storage_key);
    const mimeType = imageRows[0].result_mime_type || 'image/png';
    const stored = await inputMedia.storage.store({ buffer, mimeType });
    const mediaId = randomUUID();
    await inputMedia.repository.create({ id: mediaId, userId: job.user_id, storageKey: stored.storageKey, originalFilename: `${scene.source_scene_id}.png`, mimeType, sizeBytes: stored.sizeBytes, sha256: stored.sha256, expiresAt: new Date(Date.now() + 60 * 60_000) });
    const boardScenes = snapshot.approvedSnapshot.storyboard.scenes;
    const boardScene = boardScenes.find((item) => safe(item.sourceSceneId || item.id, 80) === scene.source_scene_id) || {};
    const characterLock = (snapshot.approvedSnapshot.characterSheet?.analysis?.characters || []).map((item) => `${item.name}: ${item.identityLock || item.appearance || ''}`).join('; ');
    const prompt = safe([
      `SEQUENCE LOCK: this is scene ${scene.scene_order} of ${boardScenes.length} in the approved storyboard. Generate only this one continuous clip; never include or jump to another scene.`,
      'Use the supplied storyboard frame as the exact opening visual reference.',
      boardScene.imagePrompt || boardScene.description || '',
      boardScene.action ? `Required on-screen action: ${boardScene.action}` : '',
      boardScene.camera ? `Required camera direction: ${boardScene.camera}` : '',
      'Preserve the locked character identity, face, wardrobe, props, location, lighting and visual style exactly as shown in the supplied frame.',
      characterLock ? `Character identity lock: ${characterLock}` : '',
      'Create a small, natural motion that continues this exact scene. No new characters, events, locations, cuts, text, logos or watermark.'
    ].filter(Boolean).join('\n'), 1800);
    const submission = await videoService.submit({ userId: job.user_id, idempotencyKey: `animation:${job.animation_job_id}:${scene.source_scene_id}:r${scene.retry_count}`, input: { mode: 'image-to-video', styleKey: 'cinematic', mediaId, prompt, aspectRatio: snapshot.aspectRatio, duration: String(scene.duration_seconds), resolution: '480p', generateAudio: Array.isArray(snapshot.audioSettings) && snapshot.audioSettings.length > 0 } });
    await query(`UPDATE animation_video_scenes SET status='processing',video_generation_id=?,safe_error_code=NULL,safe_error_message=NULL,updated_at=NOW() WHERE animation_scene_job_id=?`, [submission.id, scene.animation_scene_job_id]);
  }

  async function processJob(job) {
    let snapshot;
    try { snapshot = await seedScenes(job); } catch (error) { await failJob(job.animation_job_id, error.code || 'ANIMATION_PIPELINE_INVALID', error.message); return; }
    const scenes = await rows(`SELECT * FROM animation_video_scenes WHERE animation_job_id=? ORDER BY scene_order`, [job.animation_job_id]);
    for (const scene of scenes) {
      if (['queued', 'retrying'].includes(scene.status)) {
        try { await submitScene(job, scene, snapshot); }
        catch (error) { await query(`UPDATE animation_video_scenes SET status='failed',safe_error_code=?,safe_error_message=?,updated_at=NOW() WHERE animation_scene_job_id=?`, [safe(error.code || 'ANIMATION_SCENE_SUBMIT_FAILED', 100), safe(error.message, 500), scene.animation_scene_job_id]); await failJob(job.animation_job_id, error.code || 'ANIMATION_SCENE_SUBMIT_FAILED', 'ساخت یکی از صحنه‌ها شروع نشد. فقط همان صحنه را دوباره تلاش کن.'); return; }
      }
    }
    const active = await rows(`SELECT * FROM animation_video_scenes WHERE animation_job_id=? ORDER BY scene_order`, [job.animation_job_id]);
    for (const scene of active.filter((item) => item.status === 'processing')) {
      const record = await videoService.getContentRecord(scene.video_generation_id, job.user_id);
      if (record?.status === 'succeeded' && record.result_storage_key) await query(`UPDATE animation_video_scenes SET status='completed',output_storage_key=?,updated_at=NOW() WHERE animation_scene_job_id=?`, [record.result_storage_key, scene.animation_scene_job_id]);
      else if (['failed', 'cancelled', 'expired'].includes(record?.status)) { await query(`UPDATE animation_video_scenes SET status='failed',safe_error_code=?,safe_error_message=?,updated_at=NOW() WHERE animation_scene_job_id=?`, [safe(record.safe_error_code || 'ANIMATION_SCENE_PROVIDER_FAILED', 100), safe(record.safe_error_message || 'ساخت این صحنه ناموفق بود.', 500), scene.animation_scene_job_id]); await failJob(job.animation_job_id, record.safe_error_code || 'ANIMATION_SCENE_PROVIDER_FAILED', 'یکی از صحنه‌ها ناموفق بود؛ فقط همان صحنه را دوباره تلاش کن.'); return; }
    }
    const finished = await rows(`SELECT * FROM animation_video_scenes WHERE animation_job_id=? ORDER BY scene_order`, [job.animation_job_id]);
    if (finished.length && finished.every((scene) => scene.status === 'completed')) {
      try { const result = await montage.compose({ userId: job.user_id, generationIds: finished.map((scene) => scene.video_generation_id) }); await query(`UPDATE animation_video_jobs SET status='completed',final_storage_key=?,safe_error_code=NULL,safe_error_message=NULL,updated_at=NOW() WHERE animation_job_id=?`, [result.storageKey || null, job.animation_job_id]); await query(`UPDATE animation_projects p JOIN animation_video_jobs j ON j.project_id=p.project_id SET p.status='completed',p.stage='completed',p.updated_at=NOW() WHERE j.animation_job_id=?`, [job.animation_job_id]); }
      catch (error) { await failJob(job.animation_job_id, error.code || 'ANIMATION_MONTAGE_FAILED', error.message); }
    } else { await query(`UPDATE animation_video_jobs SET status='processing',updated_at=NOW() WHERE animation_job_id=? AND status<>'failed'`, [job.animation_job_id]); await query(`UPDATE animation_projects p JOIN animation_video_jobs j ON j.project_id=p.project_id SET p.status='video_processing',p.stage='video',p.updated_at=NOW() WHERE j.animation_job_id=?`, [job.animation_job_id]); }
  }

  return {
    async tick() {
      const jobs = await rows(`SELECT * FROM animation_video_jobs WHERE status IN ('queued','processing','retrying') ORDER BY updated_at LIMIT 3`);
      let processed = 0;
      for (const job of jobs) {
        const claim = await query(`UPDATE animation_video_jobs SET worker_lease_owner=?,worker_lease_until=DATE_ADD(NOW(), INTERVAL 60 SECOND),updated_at=NOW() WHERE animation_job_id=? AND (worker_lease_until IS NULL OR worker_lease_until<=NOW() OR worker_lease_owner=?)`, [workerId, job.animation_job_id, workerId]);
        if (claim[0].affectedRows !== 1) continue;
        try { await processJob(job); processed += 1; }
        finally { await query(`UPDATE animation_video_jobs SET worker_lease_owner=NULL,worker_lease_until=NULL WHERE animation_job_id=? AND worker_lease_owner=?`, [job.animation_job_id, workerId]); }
      }
      return { processed };
    },
    async retryScene({ jobId, sceneId, userId }) {
      const result = await query(`UPDATE animation_video_scenes s JOIN animation_video_jobs j ON j.animation_job_id=s.animation_job_id SET s.status='retrying',s.retry_count=s.retry_count+1,s.video_generation_id=NULL,s.output_storage_key=NULL,s.safe_error_code=NULL,s.safe_error_message=NULL,s.updated_at=NOW(),j.status='retrying',j.safe_error_code=NULL,j.safe_error_message=NULL,j.updated_at=NOW() WHERE s.animation_job_id=? AND s.source_scene_id=? AND j.user_id=? AND s.status='failed'`, [jobId, sceneId, userId]);
      return result[0].affectedRows === 1;
    }
  };
}

module.exports = { createAnimationVideoPipeline };
