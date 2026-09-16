'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { createRequirePrincipal } = require('../auth/principal');
const { buildClarificationPrompt, buildFollowUpClarificationPrompt, buildScenarioPrompt, buildStoryPreviewPrompt, normalizeStoryContext, normalizeStoryDraft } = require('./story-maker.prompt');
const { buildRepairPrompt, buildRevisionPrompt, buildScenarioMarkdown, normalizeScenario, parseJsonObject, validateScenario } = require('./story-maker.scenario');

function publicError(error) {
  if (error?.message === 'STORY_IDEA_REQUIRED') return { status: 400, error: 'STORY_IDEA_REQUIRED', message: 'اول ایده‌ی داستان را بنویس.' };
  if (error?.message === 'STORY_IMPROVEMENT_REQUIRED') return { status: 400, error: 'STORY_IMPROVEMENT_REQUIRED', message: 'بگو کدام بخش داستان را دوست نداشتی یا می‌خواهی تغییر کند.' };
  if (error?.message === 'STORY_REVISION_REQUIRED') return { status: 400, error: 'STORY_REVISION_REQUIRED', message: 'بگو دوست داری چه چیزی تغییر کند.' };
  if (error?.code === 'UPSTREAM_TIMEOUT') return { status: 504, error: 'STORY_GENERATION_TIMEOUT', message: 'ساخت داستان کمی طول کشید؛ دوباره امتحان کن.' };
  if (error?.code === 'STORY_QUALITY_FAILED') return { status: 502, error: 'STORY_QUALITY_FAILED', message: 'سناریو جزئیات کافی نداشت؛ لطفاً دوباره امتحان کن.' };
  return { status: 502, error: 'STORY_GENERATION_FAILED', message: 'داستان ساخته نشد. لطفاً دوباره امتحان کن.' };
}

function fallbackBrief(draft) {
  return {
    status: 'needs_clarification',
    summary: draft.idea,
    resolvedDetails: [],
    assumptions: [],
    questions: [
      { id: 'age', question: 'این قصه برای چه گروه سنی‌ای ساخته شود؟', hint: 'تا زبان و حال‌وهوای داستان دقیق‌تر شود.', options: ['۰ تا ۳ سال', '۴ تا ۷ سال', '۸ تا ۱۲ سال', '۱۳ تا ۱۷ سال', '۱۸ تا ۲۵ سال'] },
      { id: 'format', question: 'دوست داری قصه‌ات را چطور ببینیم؟', hint: 'سبک تصویر و روایت را با این انتخاب هماهنگ می‌کنیم.', options: ['انیمیشن', 'فیلم سینمایی'] },
      { id: 'duration', question: 'داستانت چند ثانیه باشد؟', hint: 'عدد را بکش یا خودت تایپ کن؛ از ۲ تا ۶۰ ثانیه.', options: [] },
      { id: 'location', question: 'ماجرا کجا اتفاق بیفتد؟', hint: 'یک دنیا برای شروع قصه انتخاب کن.', options: ['همان دنیای ایده', 'یک جای خیالی شگفت‌انگیز', 'یک مکان واقعی و آشنا'] },
      { id: 'mood', question: 'حال‌وهوای داستان چطور باشد؟', hint: 'لحن قصه را انتخاب کن.', options: ['شاد و بامزه', 'هیجان‌انگیز و ماجراجویانه', 'آرام و احساسی'] }
    ]
  };
}

function normalizeExpectedScenes(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Math.max(2, Math.min(10, Number.isFinite(parsed) ? parsed : 5));
}

function normalizeRevisionRequest(value) {
  const source = value && typeof value === 'object' ? value : {};
  const request = typeof source.request === 'string' ? source.request.trim().replace(/\s+/g, ' ').slice(0, 500) : '';
  if (!request) {
    const error = new Error('STORY_REVISION_REQUIRED');
    error.status = 400;
    throw error;
  }
  const targetScene = Number.parseInt(String(source.targetScene || ''), 10);
  return { request, targetScene: Number.isFinite(targetScene) ? targetScene : null };
}

function normalizeStoryImprovement(value) {
  const feedback = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 800) : '';
  if (!feedback) {
    const error = new Error('STORY_IMPROVEMENT_REQUIRED');
    error.status = 400;
    throw error;
  }
  return feedback;
}

function normalizeBrief(value, draft) {
  const source = value && typeof value === 'object' ? value : {};
  const cleanText = (item, max) => typeof item === 'string' ? item.trim().replace(/\s+/g, ' ').slice(0, max) : '';
  const cleanPairs = (items, maxItems) => (Array.isArray(items) ? items : []).slice(0, maxItems).map((item) => ({ label: cleanText(item?.label, 70), value: cleanText(item?.value, 150) })).filter((item) => item.label && item.value);
  const questions = (Array.isArray(source.questions) ? source.questions : []).slice(0, 5).map((item, index) => ({
    id: cleanText(item?.id, 32).replace(/[^a-z0-9-]/gi, '') || `detail-${index + 1}`,
    question: cleanText(item?.question, 120),
    hint: cleanText(item?.hint, 130),
    options: (Array.isArray(item?.options) ? item.options : []).slice(0, 4).map((option) => cleanText(option, 120)).filter(Boolean)
  })).filter((item) => item.question && (item.id === 'duration' || item.options.length >= 2));
  const fixedChoices = {
    age: { question: 'این قصه برای چه گروه سنی‌ای ساخته شود؟', hint: 'تا زبان و حال‌وهوای داستان دقیق‌تر شود.', options: ['۰ تا ۳ سال', '۴ تا ۷ سال', '۸ تا ۱۲ سال', '۱۳ تا ۱۷ سال', '۱۸ تا ۲۵ سال'] },
    format: { question: 'دوست داری قصه‌ات را چطور ببینیم؟', hint: 'فقط قالب دلخواهت را انتخاب کن.', options: ['انیمیشن', 'فیلم سینمایی'] },
    duration: { question: 'داستانت چند ثانیه باشد؟', hint: 'عدد را بکش یا خودت تایپ کن؛ از ۲ تا ۶۰ ثانیه.', options: [] }
  };
  for (const [id, fixed] of Object.entries(fixedChoices)) {
    const index = questions.findIndex((question) => question.id === id);
    if (index >= 0) questions[index] = { ...questions[index], ...fixed };
  }
  const requiredQuestionIds = ['age', 'format', 'duration', 'location', 'mood'];
  const orderedQuestions = requiredQuestionIds.map((id) => questions.find((question) => question.id === id)).filter(Boolean);
  const status = orderedQuestions.length === requiredQuestionIds.length ? 'needs_clarification' : 'ready';
  return {
    status,
    summary: cleanText(source.summary, 280) || draft.idea,
    resolvedDetails: cleanPairs(source.resolvedDetails, 8),
    assumptions: cleanPairs(source.assumptions, 5),
    questions: status === 'needs_clarification' ? orderedQuestions : []
  };
}

function normalizePreview(value, draft) {
  const source = value && typeof value === 'object' ? value : {};
  const clean = (item, max) => typeof item === 'string' ? item.trim().replace(/\s+/g, ' ').slice(0, max) : '';
  const path = source.storyPath && typeof source.storyPath === 'object' ? source.storyPath : {};
  const characters = (Array.isArray(source.characters) ? source.characters : []).slice(0, 8).map((item) => ({ name: clean(item?.name, 40), role: clean(item?.role, 80), description: clean(item?.description, 180) })).filter((item) => item.name);
  return {
    title: clean(source.title, 100) || 'طرح اولیه‌ی داستان',
    overview: clean(source.overview, 360) || draft.idea,
    world: clean(source.world, 180) || 'دنیایی مناسب با ایده‌ی تو',
    tone: clean(source.tone, 120) || 'هماهنگ با انتخاب‌های تو',
    format: clean(source.format, 100) || 'فرمت انتخاب‌شده',
    duration: clean(source.duration, 100) || 'مدت انتخاب‌شده',
    characters,
    storyPath: { beginning: clean(path.beginning, 180), challenge: clean(path.challenge, 180), climax: clean(path.climax, 180), resolution: clean(path.resolution, 180) }
  };
}

function normalizeFollowUpBrief(value, draft) {
  const source = value && typeof value === 'object' ? value : {};
  const cleanText = (item, max) => typeof item === 'string' ? item.trim().replace(/\s+/g, ' ').slice(0, max) : '';
  const cleanPairs = (items, maxItems) => (Array.isArray(items) ? items : []).slice(0, maxItems).map((item) => ({ label: cleanText(item?.label, 70), value: cleanText(item?.value, 150) })).filter((item) => item.label && item.value);
  const questions = (Array.isArray(source.questions) ? source.questions : []).slice(0, 2).map((item, index) => ({
    id: cleanText(item?.id, 32).replace(/[^a-z0-9-]/gi, '') || `detail-${index + 1}`,
    question: cleanText(item?.question, 120),
    hint: cleanText(item?.hint, 130),
    options: (Array.isArray(item?.options) ? item.options : []).slice(0, 4).map((option) => cleanText(option, 120)).filter(Boolean)
  })).filter((item) => item.question && item.options.length >= 2);
  const status = source.status === 'needs_clarification' && questions.length ? 'needs_clarification' : 'ready';
  return { status, summary: cleanText(source.summary, 280) || draft.idea, resolvedDetails: cleanPairs(source.resolvedDetails, 8), assumptions: cleanPairs(source.assumptions, 5), questions: status === 'needs_clarification' ? questions : [] };
}

function createStoryMakerRouter({ aiService, promptService, principalResolver, storyWorkspaceRepository, logger = console }) {
  const router = express.Router();
  const requirePrincipal = createRequirePrincipal(principalResolver);
  const limiter = rateLimit({ windowMs: 60_000, max: 8, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => String(req.user?.id || req.ip) });
  const briefLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => String(req.user?.id || req.ip) });
  const scenarioTimeoutMs = Math.max(30_000, Math.min(90_000, Number(process.env.STORY_MAKER_TIMEOUT_MS || 90_000)));
  const scenarioMaxOutputTokens = Math.max(1_024, Math.min(8_192, Number(process.env.STORY_MAKER_MAX_OUTPUT_TOKENS || 8_192)));
  const normalizeWorkspace = (value = {}) => {
    const source = value && typeof value === 'object' ? value : {};
    const status = ['idea', 'briefing', 'preview', 'generating', 'completed', 'error'].includes(source.status) ? source.status : 'idea';
    const idea = typeof source.idea === 'string' ? source.idea.trim().replace(/\s+/g, ' ').slice(0, 240) : '';
    const title = typeof source.title === 'string' ? source.title.trim().replace(/\s+/g, ' ').slice(0, 191) : (idea ? idea.slice(0, 70) : 'داستان تازه‌ی من');
    return { ...source, title, idea, status };
  };
  const requireWorkspaceRepository = (req, res, next) => storyWorkspaceRepository ? next() : res.status(503).json({ error: 'STORY_WORKSPACE_UNAVAILABLE', message: 'فضای داستان فعلاً آماده نیست.' });

  router.get('/api/story-workspaces', requirePrincipal, requireWorkspaceRepository, async (req, res) => {
    try { return res.json({ workspaces: await storyWorkspaceRepository.list(req.user.id) }); } catch (error) { return res.status(500).json(publicError(error)); }
  });
  router.post('/api/story-workspaces', requirePrincipal, requireWorkspaceRepository, async (req, res) => {
    try { return res.status(201).json({ workspace: await storyWorkspaceRepository.create(req.user.id, normalizeWorkspace(req.body?.workspace)) }); } catch (error) { return res.status(500).json(publicError(error)); }
  });
  router.get('/api/story-workspaces/:workspaceId', requirePrincipal, requireWorkspaceRepository, async (req, res) => {
    try { const workspace = await storyWorkspaceRepository.get(req.user.id, req.params.workspaceId); return workspace ? res.json({ workspace }) : res.status(404).json({ error: 'STORY_WORKSPACE_NOT_FOUND', message: 'این داستان پیدا نشد.' }); } catch (error) { return res.status(500).json(publicError(error)); }
  });
  router.patch('/api/story-workspaces/:workspaceId', requirePrincipal, requireWorkspaceRepository, async (req, res) => {
    try { const workspace = await storyWorkspaceRepository.update(req.user.id, req.params.workspaceId, normalizeWorkspace(req.body?.workspace)); return workspace ? res.json({ workspace }) : res.status(404).json({ error: 'STORY_WORKSPACE_NOT_FOUND', message: 'این داستان پیدا نشد.' }); } catch (error) { return res.status(500).json(publicError(error)); }
  });

  const requestScenarioCompletion = async (messages, requestId, { retryOnTimeout = true } = {}) => {
    const options = { requestId, timeoutMs: scenarioTimeoutMs, maxOutputTokens: scenarioMaxOutputTokens, responseMimeType: 'application/json' };
    try {
      return await aiService.callOpenAI(messages, options);
    } catch (error) {
      if (error?.code !== 'UPSTREAM_TIMEOUT' || !retryOnTimeout) throw error;
      logger.warn?.('STORY_MAKER', 'scenario_timeout_retrying', { requestId, timeoutMs: scenarioTimeoutMs });
      return aiService.callOpenAI(messages, options);
    }
  };

  const finalizeStructuredScenario = async ({ draft, context, requestId }) => {
    const baseSystemPrompt = await promptService.getSystemPrompt();
    const prompt = buildScenarioPrompt(draft, context);
    let result = await requestScenarioCompletion([
      { role: 'system', content: `${baseSystemPrompt}\n\nتو در این درخواست فقط سناریونویس داستان کودک هستی. دستورهای تخصصی بعدی را رعایت کن.` },
      { role: 'user', content: prompt }
    ], requestId);
    let rawScenario = String(result?.reply || '').trim();
    let structuredScenario = normalizeScenario(parseJsonObject(rawScenario), draft.scenes);
    let quality = validateScenario(structuredScenario, draft.scenes);
    let repaired = false;
    if (!quality.valid) {
      repaired = true;
      result = await requestScenarioCompletion([
        { role: 'system', content: `${baseSystemPrompt}\n\nتو ویراستار فنی سناریوی کودک هستی. فقط خروجی JSON معتبر و کامل بده.` },
        { role: 'user', content: buildRepairPrompt(prompt, rawScenario, quality.errors) }
      ], requestId, { retryOnTimeout: false });
      rawScenario = String(result?.reply || '').trim();
      structuredScenario = normalizeScenario(parseJsonObject(rawScenario), draft.scenes);
      quality = validateScenario(structuredScenario, draft.scenes);
    }
    if (!quality.valid) throw Object.assign(new Error('STORY_QUALITY_FAILED'), { code: 'STORY_QUALITY_FAILED' });
    return { story: structuredScenario, scenario: buildScenarioMarkdown(structuredScenario), model: result.model, quality: { status: 'passed', repaired } };
  };

  router.post('/api/story-scenarios/brief', requirePrincipal, briefLimiter, async (req, res) => {
    try {
      const draft = normalizeStoryDraft(req.body?.draft);
      const baseSystemPrompt = await promptService.getSystemPrompt();
      const result = await aiService.callOpenAI([
        { role: 'system', content: `${baseSystemPrompt}\n\nتو در این درخواست فقط کمک‌کار قصه هستی. فقط JSON معتبر برگردان و هرگز سناریو ننویس.` },
        { role: 'user', content: buildClarificationPrompt(draft) }
      ], { requestId: res.locals.requestId });
      const candidateBrief = normalizeBrief(parseJsonObject(result?.reply), draft);
      const brief = candidateBrief.questions.length === 5 ? candidateBrief : fallbackBrief(draft);
      logger.log?.('STORY_MAKER', 'brief_prepared', { requestId: res.locals.requestId, userId: req.user?.id, status: brief.status, questionCount: brief.questions.length, model: result.model });
      return res.json({ brief, model: result.model });
    } catch (error) {
      const payload = publicError(error);
      return res.status(payload.status).json(payload);
    }
  });

  router.post('/api/story-scenarios/brief/clarify', requirePrincipal, briefLimiter, async (req, res) => {
    try {
      const draft = normalizeStoryDraft(req.body?.draft);
      const context = normalizeStoryContext(req.body?.context);
      const feedback = normalizeStoryImprovement(req.body?.feedback);
      const baseSystemPrompt = await promptService.getSystemPrompt();
      const result = await aiService.callOpenAI([
        { role: 'system', content: `${baseSystemPrompt}\n\nتو در این درخواست فقط سردبیرِ شفاف‌سازی ایده‌ی داستان هستی. فقط JSON معتبر برگردان و هرگز سناریو ننویس.` },
        { role: 'user', content: buildFollowUpClarificationPrompt(draft, context, feedback) }
      ], { requestId: res.locals.requestId });
      const brief = normalizeFollowUpBrief(parseJsonObject(result?.reply), draft);
      logger.log?.('STORY_MAKER', 'follow_up_prepared', { requestId: res.locals.requestId, userId: req.user?.id, status: brief.status, questionCount: brief.questions.length, model: result.model });
      return res.json({ brief, model: result.model });
    } catch (error) {
      const payload = publicError(error);
      return res.status(payload.status).json(payload);
    }
  });

  router.post('/api/story-scenarios/brief/preview', requirePrincipal, briefLimiter, async (req, res) => {
    try {
      const draft = normalizeStoryDraft(req.body?.draft);
      const context = normalizeStoryContext(req.body?.context);
      const baseSystemPrompt = await promptService.getSystemPrompt();
      const result = await aiService.callOpenAI([
        { role: 'system', content: `${baseSystemPrompt}\n\nتو در این درخواست فقط طراح طرح اولیه‌ی داستان هستی. فقط JSON معتبر برگردان و هرگز سناریو ننویس.` },
        { role: 'user', content: buildStoryPreviewPrompt(draft, context) }
      ], { requestId: res.locals.requestId });
      const preview = normalizePreview(parseJsonObject(result?.reply), draft);
      logger.log?.('STORY_MAKER', 'preview_prepared', { requestId: res.locals.requestId, userId: req.user?.id, characterCount: preview.characters.length, model: result.model });
      return res.json({ preview, model: result.model });
    } catch (error) {
      const payload = publicError(error);
      return res.status(payload.status).json(payload);
    }
  });

  router.post('/api/story-scenarios', requirePrincipal, limiter, async (req, res) => {
    try {
      const draft = normalizeStoryDraft(req.body?.draft);
      const context = normalizeStoryContext(req.body?.context);
      const result = await finalizeStructuredScenario({ draft, context, requestId: res.locals.requestId });
      logger.log?.('STORY_MAKER', 'scenario_generated', { requestId: res.locals.requestId, userId: req.user?.id, sceneCount: draft.scenes, model: result.model, repaired: result.quality.repaired, replyLength: result.scenario.length });
      return res.json({ ...result, scenes: draft.scenes });
    } catch (error) {
      const payload = publicError(error);
      return res.status(payload.status).json(payload);
    }
  });

  router.post('/api/story-scenarios/validate', requirePrincipal, limiter, async (req, res) => {
    try {
      const expectedScenes = normalizeExpectedScenes(req.body?.expectedScenes);
      const story = normalizeScenario(req.body?.story, expectedScenes);
      const quality = validateScenario(story, expectedScenes);
      if (!quality.valid) throw Object.assign(new Error('STORY_QUALITY_FAILED'), { code: 'STORY_QUALITY_FAILED' });
      return res.json({ story, scenario: buildScenarioMarkdown(story), scenes: expectedScenes, quality: { status: 'passed', repaired: false } });
    } catch (error) {
      const payload = publicError(error);
      return res.status(payload.status).json(payload);
    }
  });

  router.post('/api/story-scenarios/revise', requirePrincipal, limiter, async (req, res) => {
    try {
      const expectedScenes = normalizeExpectedScenes(req.body?.expectedScenes);
      const currentStory = normalizeScenario(req.body?.story, expectedScenes);
      const currentQuality = validateScenario(currentStory, expectedScenes);
      if (!currentQuality.valid) throw Object.assign(new Error('STORY_QUALITY_FAILED'), { code: 'STORY_QUALITY_FAILED' });
      const revision = normalizeRevisionRequest(req.body);
      if (revision.targetScene && (revision.targetScene < 1 || revision.targetScene > expectedScenes)) throw Object.assign(new Error('STORY_QUALITY_FAILED'), { code: 'STORY_QUALITY_FAILED' });
      const baseSystemPrompt = await promptService.getSystemPrompt();
      const prompt = buildRevisionPrompt(currentStory, revision);
      let result = await requestScenarioCompletion([
        { role: 'system', content: `${baseSystemPrompt}\n\nتو ویراستار حرفه‌ای سناریوی کودک هستی. فقط JSON معتبر و کامل بده.` },
        { role: 'user', content: prompt }
      ], res.locals.requestId);
      let rawScenario = String(result?.reply || '').trim();
      let story = normalizeScenario(parseJsonObject(rawScenario), expectedScenes);
      let quality = validateScenario(story, expectedScenes);
      let repaired = false;
      if (!quality.valid) {
        repaired = true;
        result = await requestScenarioCompletion([
          { role: 'system', content: `${baseSystemPrompt}\n\nتو ویراستار فنی سناریوی کودک هستی. فقط خروجی JSON معتبر و کامل بده.` },
          { role: 'user', content: buildRepairPrompt(prompt, rawScenario, quality.errors) }
        ], res.locals.requestId, { retryOnTimeout: false });
        rawScenario = String(result?.reply || '').trim();
        story = normalizeScenario(parseJsonObject(rawScenario), expectedScenes);
        quality = validateScenario(story, expectedScenes);
      }
      if (!quality.valid) throw Object.assign(new Error('STORY_QUALITY_FAILED'), { code: 'STORY_QUALITY_FAILED' });
      const scenario = buildScenarioMarkdown(story);
      logger.log?.('STORY_MAKER', 'scenario_revised', { requestId: res.locals.requestId, userId: req.user?.id, sceneCount: expectedScenes, targetScene: revision.targetScene, repaired });
      return res.json({ story, scenario, model: result.model, scenes: expectedScenes, quality: { status: 'passed', repaired } });
    } catch (error) {
      const payload = publicError(error);
      return res.status(payload.status).json(payload);
    }
  });

  return router;
}

module.exports = { createStoryMakerRouter };
