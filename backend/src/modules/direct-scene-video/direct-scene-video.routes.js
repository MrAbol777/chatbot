'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { createRequirePrincipal } = require('../auth/principal');
const { normalizeSourceScenes, buildPlanningPrompt, normalizePlan } = require('./direct-scene-video.prompt');
const { createDirectSceneVideoMontage } = require('./direct-scene-video.montage');

const parseJson = (value) => {
  const text = String(value || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  }
};

function createDirectSceneVideoRouter({ aiService, promptService, principalResolver, storyboardWorkspaceRepository, videoService, videoStorage, ffmpegPath, logger = console }) {
  const router = express.Router();
  const requirePrincipal = createRequirePrincipal(principalResolver);
  const limiter = rateLimit({ windowMs: 60_000, max: 5, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => String(req.user?.id || req.ip) });
  const montage = videoService && videoStorage ? createDirectSceneVideoMontage({ videoService, videoStorage, ffmpegPath, logger }) : null;

  router.post('/api/direct-scene-video/plan', requirePrincipal, limiter, async (req, res) => {
    try {
      const scenario = String(req.body?.scenario || '').trim().slice(0, 12000);
      const workspaceId = String(req.body?.workspaceId || '').trim().slice(0, 100);
      let title = String(req.body?.title || '').trim().slice(0, 120);
      let aspectRatio = ['16:9', '9:16', '1:1'].includes(req.body?.aspectRatio) ? req.body.aspectRatio : '16:9';
      let scenes = normalizeSourceScenes(req.body?.scenes);
      if (workspaceId) {
        const workspace = await storyboardWorkspaceRepository?.get(req.user.id, workspaceId);
        if (!workspace) return res.status(404).json({ error: 'STORYBOARD_WORKSPACE_NOT_FOUND', message: 'این استوری‌برد پیدا نشد.' });
        title = workspace.title;
        aspectRatio = workspace.aspectRatio || aspectRatio;
        scenes = normalizeSourceScenes(workspace.scenes);
      }
      if (scenario.length < 3) return res.status(400).json({ error: 'DIRECT_SCENE_SCENARIO_REQUIRED', message: 'سناریو را کمی کامل‌تر وارد کن.' });
      if (!scenes.length) return res.status(400).json({ error: 'DIRECT_SCENE_IMAGES_REQUIRED', message: 'حداقل یک صحنه یا تصویر استوری‌برد لازم است.' });

      const source = { title, scenario, aspectRatio, scenes };
      const system = await promptService.getSystemPrompt();
      const result = await aiService.callOpenAI([
        { role: 'system', content: `${system}\n\nدر این درخواست فقط کارگردان و تدوین‌گر ویدیو هستی. فقط JSON معتبر برگردان.` },
        { role: 'user', content: buildPlanningPrompt(source) }
      ], { requestId: res.locals.requestId, timeoutMs: 75_000, maxOutputTokens: 4_096, responseMimeType: 'application/json' });
      const plan = normalizePlan(parseJson(result?.reply), source);
      logger.log?.('DIRECT_SCENE_VIDEO', 'plan_prepared', { requestId: res.locals.requestId, userId: req.user.id, sceneCount: plan.scenes.length, workspaceId: workspaceId || null, model: result?.model || null });
      return res.json({ plan, source: { title, aspectRatio, sceneCount: scenes.length } });
    } catch (error) {
      logger.log?.('DIRECT_SCENE_VIDEO', 'plan_failed', { requestId: res.locals.requestId, userId: req.user?.id, code: error?.code || null });
      return res.status(error?.code === 'UPSTREAM_TIMEOUT' ? 504 : 502).json({ error: 'DIRECT_SCENE_PLAN_FAILED', message: 'برنامهٔ ساخت ویدیو آماده نشد. کمی بعد دوباره تلاش کن.' });
    }
  });
  router.post('/api/direct-scene-video/montage', requirePrincipal, limiter, async (req, res) => {
    if (!montage) return res.status(503).json({ error: 'DIRECT_VIDEO_MONTAGE_UNAVAILABLE', message: 'سرویس مونتاژ ویدیو آماده نیست.' });
    try {
      return res.status(202).json(await montage.compose({ userId: req.user.id, generationIds: req.body?.generationIds }));
    } catch (error) {
      const messages = {
        DIRECT_VIDEO_SCENES_NOT_READY: 'همهٔ صحنه‌ها هنوز آماده نشده‌اند.',
        DIRECT_VIDEO_MONTAGE_UNAVAILABLE: 'موتور مونتاژ ویدیو روی سرور در دسترس نیست.',
        DIRECT_VIDEO_MONTAGE_TIMEOUT: 'مونتاژ ویدیو بیش از حد طول کشید؛ دوباره تلاش کن.'
      };
      logger.log?.('DIRECT_SCENE_VIDEO', 'montage_failed', { userId: req.user?.id, code: error?.code || null });
      return res.status(error?.code === 'DIRECT_VIDEO_SCENES_NOT_READY' ? 409 : 502).json({ error: error?.code || 'DIRECT_VIDEO_MONTAGE_FAILED', message: messages[error?.code] || 'اتصال صحنه‌ها به ویدیوی نهایی انجام نشد.' });
    }
  });
  router.get('/api/direct-scene-video/:montageId/content', requirePrincipal, async (req, res) => {
    const item = montage?.getForUser(req.params.montageId, req.user.id);
    if (!item) return res.status(404).json({ error: 'DIRECT_VIDEO_RESULT_NOT_FOUND' });
    const filePath = videoStorage.resolveSafeKey(item.resultKey);
    if (req.query.download === '1') res.setHeader('Content-Disposition', `attachment; filename="danoa-video-${req.params.montageId}.mp4"`);
    res.setHeader('Content-Type', 'video/mp4');
    return res.sendFile(filePath, (error) => { if (error && !res.headersSent) res.status(404).end(); });
  });
  return router;
}

module.exports = { createDirectSceneVideoRouter };
