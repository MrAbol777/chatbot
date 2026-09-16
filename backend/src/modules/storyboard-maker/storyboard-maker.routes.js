'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { createRequirePrincipal } = require('../auth/principal');
const { normalizeStoryboardRequest, buildStoryboardPlanPrompt } = require('./storyboard-maker.prompt');

const cleanText = (value, maxLength) => typeof value === 'string'
  ? value.trim().replace(/\s+/g, ' ').slice(0, maxLength)
  : '';

function parseJsonObject(value) {
  const raw = String(value || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(raw); } catch {
    // Some providers prepend a short sentence despite responseMimeType.  We can
    // safely recover a single JSON object, but never try to invent a plan here.
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace < 0 || lastBrace <= firstBrace) return null;
    try { return JSON.parse(raw.slice(firstBrace, lastBrace + 1)); } catch { return null; }
  }
}

function parseStoryboardPlanReply(reply, characters) {
  return normalizeStoryboardPlan(parseJsonObject(reply), characters);
}

function normalizeStoryboardPlan(value, characters) {
  const source = value && typeof value === 'object' ? value : {};
  const allowedIds = new Set(characters.map((character) => character.id));
  const scenes = (Array.isArray(source.scenes) ? source.scenes : []).slice(0, 6).map((scene, index) => {
    const characterIds = (Array.isArray(scene?.characterIds) ? scene.characterIds : [])
      .map((id) => cleanText(id, 64))
      .filter((id, itemIndex, list) => allowedIds.has(id) && list.indexOf(id) === itemIndex);
    return {
      id: `scene-${index + 1}`,
      number: index + 1,
      title: cleanText(scene?.title, 80) || `سکانس ${index + 1}`,
      description: cleanText(scene?.description, 260),
      setting: cleanText(scene?.setting, 140),
      action: cleanText(scene?.action, 220),
      dialogue: cleanText(scene?.dialogue, 220),
      camera: cleanText(scene?.camera, 120),
      mood: cleanText(scene?.mood, 100),
      characterIds: characterIds.length ? characterIds : [characters[0].id],
      imagePrompt: cleanText(scene?.imagePrompt, 2400),
      negativePrompt: cleanText(scene?.negativePrompt, 600)
    };
  }).filter((scene) => scene.description && scene.imagePrompt);
  if (scenes.length < 1) {
    const error = new Error('STORYBOARD_PLAN_INVALID');
    error.status = 502;
    throw error;
  }
  return {
    title: cleanText(source.title, 120) || 'استوری‌برد من',
    summary: cleanText(source.summary, 320),
    visualStyle: cleanText(source.visualStyle, 180) || 'انیمیشنی، شاد و مناسب کودک',
    scenes
  };
}

function normalizeStoryboardWorkspace(value) {
  const source = value && typeof value === 'object' ? value : {};
  const script = cleanText(source.script, 12000);
  const characters = (Array.isArray(source.characters) ? source.characters : []).slice(0, 4).map((character, index) => ({
    id: cleanText(character?.id, 64).replace(/[^a-zA-Z0-9_-]/g, '') || `character-${index + 1}`,
    name: cleanText(character?.name, 60) || `کاراکتر ${index + 1}`
  }));
  const uniqueCharacters = characters.filter((character, index, items) => items.findIndex((item) => item.id === character.id) === index);
  if (!script || !uniqueCharacters.length) {
    const error = new Error('STORYBOARD_WORKSPACE_INVALID');
    error.status = 400;
    throw error;
  }
  const plan = normalizeStoryboardPlan(source.plan, uniqueCharacters);
  const savedScenes = new Map((Array.isArray(source.scenes) ? source.scenes : []).map((scene) => [cleanText(scene?.id, 64), scene]));
  const scenes = plan.scenes.map((scene) => {
    const saved = savedScenes.get(scene.id) || {};
    return {
      ...scene,
      status: ['idle', 'generating', 'completed', 'error'].includes(saved.status) ? saved.status : 'idle',
      imageUrl: cleanText(saved.imageUrl, 1200) || undefined,
      error: cleanText(saved.error, 360) || undefined
    };
  });
  return {
    title: cleanText(source.title, 120) || plan.title,
    script,
    status: ['review', 'generating', 'completed', 'error'].includes(source.status) ? source.status : 'review',
    characters: uniqueCharacters,
    aspectRatio: ['16:9', '9:16', '1:1'].includes(source.aspectRatio) ? source.aspectRatio : '16:9',
    plan,
    overviewImageUrl: cleanText(source.overviewImageUrl, 1200) || undefined,
    scenes
  };
}

function publicError(error) {
  if (error?.message === 'STORYBOARD_SCRIPT_REQUIRED') return { status: 400, error: 'STORYBOARD_SCRIPT_REQUIRED', message: 'داستانت را کمی کامل‌تر بنویس یا آپلود کن.' };
  if (error?.message === 'STORYBOARD_CHARACTER_REQUIRED') return { status: 400, error: 'STORYBOARD_CHARACTER_REQUIRED', message: 'حداقل یک عکس مرجع از کاراکترت اضافه کن.' };
  if (error?.message === 'STORYBOARD_PLAN_INVALID') return { status: 502, error: 'STORYBOARD_PLAN_INVALID', message: 'نتوانستیم سکانس‌های داستان را درست آماده کنیم؛ لطفاً دوباره تلاش کن.' };
  if (error?.code === 'UPSTREAM_TIMEOUT') return { status: 504, error: 'STORYBOARD_TIMEOUT', message: 'تحلیل داستان کمی طول کشید؛ دوباره تلاش کن.' };
  return { status: error?.status || 502, error: 'STORYBOARD_ANALYSIS_FAILED', message: 'تحلیل استوری‌برد انجام نشد. لطفاً دوباره تلاش کن.' };
}

function createStoryboardMakerRouter({ aiService, promptService, principalResolver, storyboardWorkspaceRepository, logger = console }) {
  const router = express.Router();
  const requirePrincipal = createRequirePrincipal(principalResolver);
  const limiter = rateLimit({ windowMs: 60_000, max: 6, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => String(req.user?.id || req.ip) });
  const requireRepository = (req, res, next) => storyboardWorkspaceRepository ? next() : res.status(503).json({ error: 'STORYBOARD_WORKSPACE_UNAVAILABLE', message: 'کتابخانهٔ استوری‌برد فعلاً آماده نیست.' });

  router.get('/api/storyboard-workspaces', requirePrincipal, requireRepository, async (req, res) => {
    try { return res.json({ workspaces: await storyboardWorkspaceRepository.list(req.user.id) }); } catch { return res.status(500).json({ error: 'STORYBOARD_WORKSPACE_LIST_FAILED', message: 'دریافت استوری‌بردهای قبلی انجام نشد.' }); }
  });
  router.post('/api/storyboard-workspaces', requirePrincipal, requireRepository, async (req, res) => {
    try { return res.status(201).json({ workspace: await storyboardWorkspaceRepository.create(req.user.id, normalizeStoryboardWorkspace(req.body?.workspace)) }); }
    catch (error) { return res.status(error?.status || 500).json({ error: 'STORYBOARD_WORKSPACE_CREATE_FAILED', message: 'ذخیرهٔ استوری‌برد انجام نشد.' }); }
  });
  router.get('/api/storyboard-workspaces/:workspaceId', requirePrincipal, requireRepository, async (req, res) => {
    try {
      const workspace = await storyboardWorkspaceRepository.get(req.user.id, req.params.workspaceId);
      return workspace ? res.json({ workspace }) : res.status(404).json({ error: 'STORYBOARD_WORKSPACE_NOT_FOUND', message: 'این استوری‌برد پیدا نشد.' });
    } catch { return res.status(500).json({ error: 'STORYBOARD_WORKSPACE_GET_FAILED', message: 'دریافت استوری‌برد انجام نشد.' }); }
  });
  router.patch('/api/storyboard-workspaces/:workspaceId', requirePrincipal, requireRepository, async (req, res) => {
    try {
      const workspace = await storyboardWorkspaceRepository.update(req.user.id, req.params.workspaceId, normalizeStoryboardWorkspace(req.body?.workspace));
      return workspace ? res.json({ workspace }) : res.status(404).json({ error: 'STORYBOARD_WORKSPACE_NOT_FOUND', message: 'این استوری‌برد پیدا نشد.' });
    } catch (error) { return res.status(error?.status || 500).json({ error: 'STORYBOARD_WORKSPACE_UPDATE_FAILED', message: 'ذخیرهٔ استوری‌برد انجام نشد.' }); }
  });

  router.post('/api/storyboards/analyze', requirePrincipal, limiter, async (req, res) => {
    try {
      const request = normalizeStoryboardRequest(req.body);
      const baseSystemPrompt = await promptService.getSystemPrompt();
      const messages = [
        { role: 'system', content: `${baseSystemPrompt}\n\nدر این درخواست فقط طراح استوری‌برد کودک هستی. فقط JSON معتبر برگردان.` },
        { role: 'user', content: buildStoryboardPlanPrompt(request) }
      ];
      let result = await aiService.callOpenAI(messages, { requestId: res.locals.requestId, timeoutMs: 60_000, maxOutputTokens: 4_096, responseMimeType: 'application/json' });
      let repaired = false;
      let plan;
      try {
        plan = parseStoryboardPlanReply(result?.reply, request.characters);
      } catch (error) {
        // Retry once only when the provider answered but broke the strict JSON
        // contract. This is a repair of the same analysis, not a new user job.
        if (error?.message !== 'STORYBOARD_PLAN_INVALID') throw error;
        repaired = true;
        logger.log?.('STORYBOARD_MAKER', 'plan_repair_started', {
          requestId: res.locals.requestId,
          userId: req.user?.id,
          reason: 'invalid_provider_plan'
        });
        result = await aiService.callOpenAI([
          { role: 'system', content: `${baseSystemPrompt}\n\nYour previous storyboard answer was invalid. Return ONLY one valid JSON object that exactly follows the requested storyboard schema. Include 2 to 6 usable scenes; every scene must have a non-empty Persian description and a non-empty English imagePrompt. Do not add markdown or prose.` },
          { role: 'user', content: buildStoryboardPlanPrompt(request) }
        ], { requestId: res.locals.requestId, timeoutMs: 60_000, maxOutputTokens: 4_096, responseMimeType: 'application/json' });
        plan = parseStoryboardPlanReply(result?.reply, request.characters);
      }
      logger.log?.('STORYBOARD_MAKER', 'plan_prepared', { requestId: res.locals.requestId, userId: req.user?.id, sceneCount: plan.scenes.length, characterCount: request.characters.length, model: result.model, repaired });
      return res.json({ plan, model: result.model });
    } catch (error) {
      logger.log?.('STORYBOARD_MAKER', 'plan_failed', {
        requestId: res.locals.requestId,
        userId: req.user?.id,
        reason: error?.message === 'STORYBOARD_PLAN_INVALID' ? 'invalid_provider_plan_after_repair' : 'analysis_request_failed',
        code: error?.code || null,
        status: error?.status || null
      });
      const payload = publicError(error);
      return res.status(payload.status).json(payload);
    }
  });

  return router;
}

module.exports = { createStoryboardMakerRouter, normalizeStoryboardPlan, normalizeStoryboardWorkspace, parseJsonObject, parseStoryboardPlanReply };
