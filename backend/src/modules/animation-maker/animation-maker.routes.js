'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { createRequirePrincipal } = require('../auth/principal');
const { normalizeAnimationProject } = require('./animation-project.schema');

const REVIEW_ACTIONS = new Set(['scenario_approved', 'characters_generating', 'characters_review', 'characters_approved', 'storyboard_generating', 'storyboard_review', 'storyboard_approved', 'video_queued', 'video_processing', 'completed', 'failed']);
const ACTION_STAGES = {
  scenario_approved: 'characters', characters_generating: 'characters', characters_review: 'characters', characters_approved: 'storyboard',
  storyboard_generating: 'storyboard', storyboard_review: 'storyboard', storyboard_approved: 'video',
  video_queued: 'video', video_processing: 'video', completed: 'completed', failed: 'error'
};
const text = (value, max = 191) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const ids = (value) => (Array.isArray(value) ? value : []).map((item) => text(item, 80)).filter((item, index, all) => /^[A-Za-z0-9_-]{1,80}$/.test(item) && all.indexOf(item) === index).slice(0, 24);
const versionFor = (workspace) => text(workspace?.updatedAt, 64) || text(workspace?.createdAt, 64);
const sceneDuration = (scene) => Number(scene?.durationSeconds || scene?.duration || 0);

function publicError(error) {
  if (error?.message === 'ANIMATION_IDEA_REQUIRED') return { status: 400, error: error.message, message: 'اول ایده‌ی فیلمت را بنویس.' };
  return { status: error?.status || 500, error: 'ANIMATION_PROJECT_SAVE_FAILED', message: 'ذخیره‌ی پروژه انجام نشد. دوباره امتحان کن.' };
}

function logRouteFailure(operation, error, req) {
  // Keep raw SQL and request payloads out of HTTP responses, but retain enough
  // structured context in the server log to diagnose a real route failure.
  console.error('[animation-maker] request failed', {
    operation,
    method: req.method,
    path: req.originalUrl,
    userId: req.user?.id || null,
    code: error?.code || null,
    errno: error?.errno || null,
    sqlState: error?.sqlState || null,
    message: error instanceof Error ? error.message : String(error)
  });
}

function createAnimationMakerRouter({ principalResolver, animationProjectRepository, storyWorkspaceRepository, characterWorkspaceRepository, storyboardWorkspaceRepository, videoStorage }) {
  const router = express.Router();
  const requirePrincipal = createRequirePrincipal(principalResolver);
  const writeLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => String(req.user?.id || req.ip) });
  const requireRepository = (req, res, next) => animationProjectRepository ? next() : res.status(503).json({ error: 'ANIMATION_PROJECT_UNAVAILABLE', message: 'فضای انیمیشن‌سازی فعلاً آماده نیست.' });

  router.get('/api/animation-projects', requirePrincipal, requireRepository, async (req, res) => {
    try { return res.json({ projects: await animationProjectRepository.list(req.user.id) }); }
    catch (error) { logRouteFailure('list-projects', error, req); return res.status(500).json({ error: 'ANIMATION_PROJECT_LIST_FAILED', message: 'دریافت پروژه‌ها انجام نشد.' }); }
  });

  router.post('/api/animation-projects', requirePrincipal, requireRepository, writeLimiter, async (req, res) => {
    try { return res.status(201).json({ project: await animationProjectRepository.create(req.user.id, normalizeAnimationProject(req.body?.project)) }); }
    catch (error) { logRouteFailure('create-project', error, req); const payload = publicError(error); return res.status(payload.status).json(payload); }
  });

  router.get('/api/animation-projects/:projectId', requirePrincipal, requireRepository, async (req, res) => {
    try {
      const project = await animationProjectRepository.get(req.user.id, req.params.projectId);
      return project ? res.json({ project }) : res.status(404).json({ error: 'ANIMATION_PROJECT_NOT_FOUND', message: 'این پروژه پیدا نشد.' });
    } catch { return res.status(500).json({ error: 'ANIMATION_PROJECT_GET_FAILED', message: 'دریافت پروژه انجام نشد.' }); }
  });

  router.get('/api/animation-projects/:projectId/video-job', requirePrincipal, requireRepository, async (req, res) => {
    try {
      const job = await animationProjectRepository.getVideoJob(req.user.id, req.params.projectId);
      if (!job) return res.status(404).json({ error: 'ANIMATION_VIDEO_JOB_NOT_FOUND', message: 'صف ویدیوی این پروژه هنوز ساخته نشده است.' });
      return res.json({ job: { ...job, finalContentUrl: job.status === 'completed' && job.finalStorageKey ? `/api/animation-projects/${encodeURIComponent(req.params.projectId)}/video-job/content` : null } });
    } catch { return res.status(500).json({ error: 'ANIMATION_VIDEO_JOB_GET_FAILED', message: 'دریافت وضعیت ویدیو انجام نشد.' }); }
  });

  router.get('/api/animation-projects/:projectId/video-job/content', requirePrincipal, requireRepository, async (req, res) => {
    try {
      const job = await animationProjectRepository.getVideoJob(req.user.id, req.params.projectId);
      if (!job?.finalStorageKey || job.status !== 'completed' || !videoStorage) return res.status(404).json({ error: 'ANIMATION_VIDEO_RESULT_NOT_FOUND' });
      res.setHeader('Content-Type', 'video/mp4');
      if (req.query.download === '1') res.setHeader('Content-Disposition', `attachment; filename="danoa-animation-${req.params.projectId}.mp4"`);
      return res.sendFile(videoStorage.resolveSafeKey(job.finalStorageKey));
    } catch { return res.status(404).json({ error: 'ANIMATION_VIDEO_RESULT_NOT_FOUND' }); }
  });

  router.post('/api/animation-projects/:projectId/video-job/scenes/:sceneId/retry', requirePrincipal, requireRepository, writeLimiter, async (req, res) => {
    try {
      const retried = await animationProjectRepository.retryVideoScene(req.user.id, req.params.projectId, req.params.sceneId);
      if (!retried) return res.status(409).json({ error: 'ANIMATION_SCENE_RETRY_NOT_AVAILABLE', message: 'این صحنه آمادهٔ تلاش دوباره نیست.' });
      return res.status(202).json({ ok: true });
    } catch { return res.status(500).json({ error: 'ANIMATION_SCENE_RETRY_FAILED', message: 'شروع دوبارهٔ این صحنه انجام نشد.' }); }
  });

  router.patch('/api/animation-projects/:projectId', requirePrincipal, requireRepository, writeLimiter, async (req, res) => {
    try {
      const project = await animationProjectRepository.update(req.user.id, req.params.projectId, normalizeAnimationProject(req.body?.project));
      return project ? res.json({ project }) : res.status(404).json({ error: 'ANIMATION_PROJECT_NOT_FOUND', message: 'این پروژه پیدا نشد.' });
    } catch (error) { const payload = publicError(error); return res.status(payload.status).json(payload); }
  });

  // A narrow, server-owned transition endpoint prevents each UI surface from
  // overwriting another surface's project snapshot during async generation.
  router.post('/api/animation-projects/:projectId/review', requirePrincipal, requireRepository, writeLimiter, async (req, res) => {
    try {
      const action = text(req.body?.action, 48);
      const data = req.body?.data && typeof req.body.data === 'object' ? req.body.data : {};
      if (!REVIEW_ACTIONS.has(action)) return res.status(400).json({ error: 'ANIMATION_REVIEW_ACTION_INVALID', message: 'وضعیت بررسی معتبر نیست.' });
      const current = await animationProjectRepository.get(req.user.id, req.params.projectId);
      if (!current) return res.status(404).json({ error: 'ANIMATION_PROJECT_NOT_FOUND', message: 'این پروژه پیدا نشد.' });

      const next = { ...current, stage: ACTION_STAGES[action], status: action, approvals: { ...current.approvals }, sourceLinks: { ...current.sourceLinks }, review: { ...(current.review || {}) } };
      const revisionRequest = text(data.revisionRequest, 1000);
      const revisionStage = action.startsWith('characters') ? 'characters' : action.startsWith('storyboard') ? 'storyboard' : action === 'scenario_approved' ? 'scenario' : 'video';

      if (action === 'scenario_approved') {
        const workspaceId = text(data.storyWorkspaceId, 64) || next.sourceLinks.storyWorkspaceId;
        if (!workspaceId) return res.status(409).json({ error: 'ANIMATION_SCENARIO_REQUIRED', message: 'اول سناریوی تأییدشده را ذخیره کن.' });
        next.approvals.scenario = true; next.sourceLinks.storyWorkspaceId = workspaceId; next.review.scenarioVersion = text(data.scenarioVersion, 64) || next.review.scenarioVersion;
      }
      if (action === 'characters_generating' || action === 'characters_review' || action === 'characters_approved') {
        const workspaceId = text(data.characterWorkspaceId, 64) || next.sourceLinks.characterWorkspaceId;
        if (!workspaceId && action !== 'characters_generating') return res.status(409).json({ error: 'ANIMATION_CHARACTER_SHEET_REQUIRED', message: 'اول کاراکترشیت را بساز.' });
        if (workspaceId && characterWorkspaceRepository) {
          const workspace = await characterWorkspaceRepository.get(req.user.id, workspaceId);
          if (!workspace) return res.status(404).json({ error: 'ANIMATION_CHARACTER_WORKSPACE_NOT_FOUND', message: 'کاراکترشیت پیدا نشد.' });
          next.sourceLinks.characterWorkspaceId = workspaceId;
          next.review.characterVersion = versionFor(workspace);
          next.review.characterIds = ids(workspace.analysis?.characters?.map((character) => character.id));
        }
        if (action === 'characters_approved') {
          if (!next.approvals.scenario) return res.status(409).json({ error: 'ANIMATION_SCENARIO_NOT_APPROVED', message: 'اول سناریو را تأیید کن.' });
          next.approvals.characters = true;
        }
        if (action === 'characters_review' && (revisionRequest || current.approvals?.characters)) {
          next.approvals.characters = false;
          next.approvals.storyboard = false;
        }
      }
      if (action === 'storyboard_generating' || action === 'storyboard_review' || action === 'storyboard_approved') {
        const workspaceId = text(data.storyboardWorkspaceId, 64) || next.sourceLinks.storyboardWorkspaceId;
        if (!workspaceId && action !== 'storyboard_generating') return res.status(409).json({ error: 'ANIMATION_STORYBOARD_REQUIRED', message: 'اول استوری‌برد را بساز.' });
        if (workspaceId && storyboardWorkspaceRepository) {
          const workspace = await storyboardWorkspaceRepository.get(req.user.id, workspaceId);
          if (!workspace) return res.status(404).json({ error: 'ANIMATION_STORYBOARD_NOT_FOUND', message: 'استوری‌برد پیدا نشد.' });
          const scenes = Array.isArray(workspace.scenes) ? workspace.scenes : [];
          const duration = scenes.reduce((total, scene) => total + sceneDuration(scene), 0);
          next.sourceLinks.storyboardWorkspaceId = workspaceId;
          next.review.storyboardVersion = versionFor(workspace);
          next.review.sceneIds = ids(scenes.map((scene) => scene.sourceSceneId || scene.id));
          next.review.storyboardDurationSeconds = duration;
          if (action === 'storyboard_approved') {
            if (!next.approvals.characters) return res.status(409).json({ error: 'ANIMATION_CHARACTERS_NOT_APPROVED', message: 'اول کاراکترها را تأیید کن.' });
            if (!scenes.length || scenes.some((scene) => scene.status !== 'completed')) return res.status(409).json({ error: 'ANIMATION_STORYBOARD_INCOMPLETE', message: 'همهٔ قاب‌ها باید آماده باشند.' });
            if (duration !== Number(next.preferences.durationSeconds)) return res.status(409).json({ error: 'ANIMATION_STORYBOARD_DURATION_MISMATCH', message: 'جمع زمان صحنه‌ها باید با مدت فیلم برابر باشد.' });
            next.approvals.storyboard = true;
          }
        }
        if (action === 'storyboard_review' && (revisionRequest || current.approvals?.storyboard)) next.approvals.storyboard = false;
      }
      if (action === 'video_queued') {
        if (!next.approvals.storyboard) return res.status(409).json({ error: 'ANIMATION_STORYBOARD_NOT_APPROVED', message: 'اول استوری‌برد را تأیید کن.' });
        const payload = data.videoPayload && typeof data.videoPayload === 'object' ? data.videoPayload : null;
        if (!payload) return res.status(400).json({ error: 'ANIMATION_VIDEO_PAYLOAD_REQUIRED', message: 'اطلاعات صف ویدیو کامل نیست.' });
        // The persisted job context is intentionally separate from the existing
        // video-generation payload, so legacy providers and workers keep their contract.
        const [scenarioWorkspace, characterWorkspace, storyboardWorkspace] = await Promise.all([
          storyWorkspaceRepository?.get(req.user.id, next.sourceLinks.storyWorkspaceId),
          characterWorkspaceRepository?.get(req.user.id, next.sourceLinks.characterWorkspaceId),
          storyboardWorkspaceRepository?.get(req.user.id, next.sourceLinks.storyboardWorkspaceId)
        ]);
        if (!scenarioWorkspace || !characterWorkspace || !storyboardWorkspace
          || versionFor(scenarioWorkspace) !== next.review.scenarioVersion
          || versionFor(characterWorkspace) !== next.review.characterVersion
          || versionFor(storyboardWorkspace) !== next.review.storyboardVersion) {
          return res.status(409).json({ error: 'ANIMATION_APPROVED_VERSION_CHANGED', message: 'نسخهٔ تأییدشده تغییر کرده است؛ آن را دوباره بررسی و تأیید کن.' });
        }
        const expected = {
          animationProjectId: current.id, scenarioId: next.sourceLinks.storyWorkspaceId, scenarioVersion: next.review.scenarioVersion,
          characterSheetVersion: next.review.characterVersion, storyboardId: next.sourceLinks.storyboardWorkspaceId,
          storyboardVersion: next.review.storyboardVersion, duration: next.preferences.durationSeconds,
          aspectRatio: next.preferences.aspectRatio, visualStyle: next.preferences.style, audioSettings: next.preferences.audio,
          approvedSnapshot: {
            scenario: { id: scenarioWorkspace.id, version: versionFor(scenarioWorkspace), story: scenarioWorkspace.story, scenario: scenarioWorkspace.scenario },
            characterSheet: { id: characterWorkspace.id, version: versionFor(characterWorkspace), analysis: characterWorkspace.analysis },
            storyboard: { id: storyboardWorkspace.id, version: versionFor(storyboardWorkspace), aspectRatio: storyboardWorkspace.aspectRatio, plan: storyboardWorkspace.plan, scenes: storyboardWorkspace.scenes }
          }
        };
        if (String(payload.animationProjectId || '') !== expected.animationProjectId || String(payload.storyboardId || '') !== expected.storyboardId) return res.status(409).json({ error: 'ANIMATION_VIDEO_PAYLOAD_MISMATCH', message: 'نسخهٔ استوری‌برد با پروژه یکی نیست.' });
        next.review.videoPayload = expected;
        await animationProjectRepository.createVideoJob(req.user.id, current.id, expected);
      }
      if (action === 'video_processing' || action === 'completed') {
        if (!next.approvals.storyboard) return res.status(409).json({ error: 'ANIMATION_STORYBOARD_NOT_APPROVED', message: 'اول استوری‌برد را تأیید کن.' });
        const generationId = text(data.videoGenerationId, 64);
        if (generationId) next.sourceLinks.videoGenerationId = generationId;
        await animationProjectRepository.updateVideoJob(req.user.id, current.id, action === 'completed' ? 'completed' : 'processing', generationId);
      }
      if (revisionRequest) next.revisions = [...(next.revisions || []), { id: `revision-${Date.now()}`, stage: revisionStage, request: revisionRequest, createdAt: new Date().toISOString() }].slice(-40);
      return res.json({ project: await animationProjectRepository.update(req.user.id, req.params.projectId, normalizeAnimationProject(next)) });
    } catch (error) { const payload = publicError(error); return res.status(payload.status).json(payload); }
  });

  return router;
}

module.exports = { createAnimationMakerRouter };
