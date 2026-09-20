'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const { createRequirePrincipal } = require('../auth/principal');
const { buildCharacterAnalysisPrompt } = require('./character-maker.prompt');

const clean = (value, max = 240) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
const cleanPrompt = (value) => clean(value, 2200);
const assetId = (value, prefix) => {
  const candidate = clean(value, 120).toLowerCase();
  return new RegExp(`^${prefix}-[a-z0-9-]{8,}$`).test(candidate) ? candidate : `${prefix}-${uuidv4()}`;
};

function parseJson(value) {
  const raw = String(value || '').trim();
  try {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || raw;
    return JSON.parse(fenced);
  } catch {
    // Providers occasionally add a short explanation around JSON despite the
    // requested response MIME type. Recover the object, never fabricate one.
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace < 0 || lastBrace <= firstBrace) return {};
    try { return JSON.parse(raw.slice(firstBrace, lastBrace + 1)); } catch { return {}; }
  }
}

function normalizeAnalysis(value, scenario) {
  const source = value && typeof value === 'object' ? value : {};
  const characters = (Array.isArray(source.characters) ? source.characters : []).slice(0, 8).map((item, index) => {
    const characterAssetId = assetId(item?.assetId, 'character');
    return {
      id: clean(item?.id, 32).replace(/[^a-z0-9-]/gi, '') || `char-${index + 1}`,
      assetId: characterAssetId, sheetAssetId: `${characterAssetId}-character-sheet`,
      name: clean(item?.name, 70) || `شخصیت ${index + 1}`,
      role: clean(item?.role, 140), archetype: clean(item?.archetype, 120), personality: clean(item?.personality, 280),
      relationshipNote: clean(item?.relationshipNote, 220), identityLock: clean(item?.identityLock, 420),
      appearance: clean(item?.appearance, 420), wardrobe: clean(item?.wardrobe, 260), mannerism: clean(item?.mannerism, 220), palette: clean(item?.palette, 150),
      imagePrompt: cleanPrompt(item?.imagePrompt), negativePrompt: cleanPrompt(item?.negativePrompt), image: item?.image, characterSheet: item?.characterSheet
    };
  }).filter((item) => item.name && item.imagePrompt);
  const setting = source.setting && typeof source.setting === 'object' ? source.setting : {};
  const settingAssetId = assetId(setting.assetId, 'setting');
  return {
    title: clean(source.title, 100) || scenario.slice(0, 70) || 'پروژه‌ی کاراکترها',
    summary: clean(source.summary, 480) || scenario.slice(0, 480),
    visualStyle: clean(source.visualStyle, 160) || 'انیمیشن سه‌بعدیِ گرم و سینمایی',
    stylePrompt: cleanPrompt(source.stylePrompt) || 'High-quality stylized 3D animated family-film visual language, expressive but believable proportions, softly rounded forms, polished non-photoreal materials, warm cinematic lighting, cohesive color grading, and the same studio-quality render for every character and environment. Never use live action, photographic realism, or real-person likeness.',
    relationships: (Array.isArray(source.relationships) ? source.relationships : []).slice(0, 24).map((item) => ({ from: clean(item?.from, 32), to: clean(item?.to, 32), label: clean(item?.label, 120) })).filter((item) => item.from && item.to && item.label),
    characters,
    setting: { assetId: settingAssetId, sheetAssetId: `${settingAssetId}-setting-sheet`, name: clean(setting.name, 100) || 'فضای داستان', description: clean(setting.description, 420), imagePrompt: cleanPrompt(setting.imagePrompt), negativePrompt: cleanPrompt(setting.negativePrompt), image: setting.image, settingSheet: setting.settingSheet }
  };
}

function parseCharacterAnalysisReply(reply, scenario) {
  return normalizeAnalysis(parseJson(reply), scenario);
}

function normalizeWorkspace(value) {
  const source = value && typeof value === 'object' ? value : {};
  const scenario = clean(source.scenario, 8000);
  const status = ['review', 'generating', 'completed', 'error'].includes(source.status) ? source.status : 'review';
  const analysis = source.analysis && typeof source.analysis === 'object' ? normalizeAnalysis(source.analysis, scenario) : undefined;
  return { ...source, assetId: assetId(source.assetId, 'scenario'), title: clean(source.title, 191) || scenario.slice(0, 70) || 'کاراکترهای تازه', scenario, status, ...(analysis ? { analysis } : {}) };
}

function getAssetReference(workspaceId, assetIdValue) {
  return `dana://character-workspaces/${workspaceId}/assets/${assetIdValue}`;
}

function findWorkspaceAsset(workspace, assetIdValue) {
  const analysis = workspace?.analysis;
  if (!analysis) return null;
  const character = analysis.characters?.find((item) => item.assetId === assetIdValue);
  if (character) return { kind: 'character', assetId: character.assetId, character };
  const sheetOwner = analysis.characters?.find((item) => item.sheetAssetId === assetIdValue);
  if (sheetOwner) return { kind: 'character-sheet', assetId: sheetOwner.sheetAssetId, character: sheetOwner, image: sheetOwner.characterSheet };
  if (analysis.setting?.assetId === assetIdValue) return { kind: 'setting', assetId: analysis.setting.assetId, setting: analysis.setting, image: analysis.setting.image };
  if (analysis.setting?.sheetAssetId === assetIdValue) return { kind: 'setting-sheet', assetId: analysis.setting.sheetAssetId, setting: analysis.setting, image: analysis.setting.settingSheet };
  return null;
}

function needsAssetBackfill(workspace) {
  const analysis = workspace?.analysis;
  return Boolean(!workspace?.assetId || (analysis && (!analysis.setting?.assetId || !analysis.setting?.sheetAssetId || (analysis.characters || []).some((item) => !item.assetId || !item.sheetAssetId))));
}

function createCharacterMakerRouter({ aiService, promptService, principalResolver, characterWorkspaceRepository, logger = console }) {
  const router = express.Router();
  const requirePrincipal = createRequirePrincipal(principalResolver);
  const analysisLimiter = rateLimit({ windowMs: 60_000, max: 8, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => String(req.user?.id || req.ip) });
  const requireRepository = (req, res, next) => characterWorkspaceRepository ? next() : res.status(503).json({ error: 'CHARACTER_WORKSPACE_UNAVAILABLE', message: 'کتابخانه‌ی کاراکتر فعلاً آماده نیست.' });

  router.post('/api/character-maker/analyze', requirePrincipal, analysisLimiter, async (req, res) => {
    const scenario = clean(req.body?.scenario, 8000);
    if (!scenario) return res.status(400).json({ error: 'SCENARIO_REQUIRED', message: 'اول سناریو را وارد کن.' });
    try {
      const baseSystemPrompt = await promptService.getSystemPrompt();
      const messages = [
        { role: 'system', content: `${baseSystemPrompt}\n\nYou are only a character-analysis engine. Return valid JSON and never prose.` },
        { role: 'user', content: buildCharacterAnalysisPrompt(scenario) }
      ];
      let result = await aiService.callOpenAI(messages, { requestId: res.locals.requestId, responseMimeType: 'application/json', maxOutputTokens: 6000 });
      let analysis = parseCharacterAnalysisReply(result?.reply, scenario);
      let repaired = false;
      if (!analysis.characters.length) {
        repaired = true;
        logger.log?.('CHARACTER_MAKER', 'analysis_repair_started', {
          requestId: res.locals.requestId,
          userId: req.user?.id,
          reason: 'invalid_provider_analysis'
        });
        result = await aiService.callOpenAI([
          { role: 'system', content: `${baseSystemPrompt}\n\nYour previous character-analysis answer was invalid. Return ONLY one valid JSON object that exactly follows the requested schema. Include every named, recurring, or story-driving character with a non-empty Persian name and a non-empty English imagePrompt. Do not add markdown or prose.` },
          { role: 'user', content: buildCharacterAnalysisPrompt(scenario) }
        ], { requestId: res.locals.requestId, responseMimeType: 'application/json', maxOutputTokens: 6000 });
        analysis = parseCharacterAnalysisReply(result?.reply, scenario);
      }
      if (!analysis.characters.length) return res.status(422).json({ error: 'NO_CHARACTERS_FOUND', message: 'شخصیت مشخصی در سناریو پیدا نشد؛ سناریو را کمی دقیق‌تر بنویس.' });
      logger.log?.('CHARACTER_MAKER', 'analysis_prepared', { requestId: res.locals.requestId, userId: req.user?.id, characterCount: analysis.characters.length, model: result.model, repaired });
      return res.json({ analysis, model: result.model || null });
    } catch (error) {
      logger.error?.('CHARACTER_MAKER', 'analysis_failed', { requestId: res.locals.requestId, message: error instanceof Error ? error.message : String(error) });
      return res.status(502).json({ error: 'CHARACTER_ANALYSIS_FAILED', message: 'تحلیل سناریو انجام نشد. دوباره امتحان کن.' });
    }
  });

  router.get('/api/character-workspaces', requirePrincipal, requireRepository, async (req, res) => {
    try { return res.json({ workspaces: await characterWorkspaceRepository.list(req.user.id) }); } catch { return res.status(500).json({ error: 'CHARACTER_WORKSPACE_LIST_FAILED', message: 'دریافت کتابخانه انجام نشد.' }); }
  });
  router.post('/api/character-workspaces', requirePrincipal, requireRepository, async (req, res) => {
    try { return res.status(201).json({ workspace: await characterWorkspaceRepository.create(req.user.id, normalizeWorkspace(req.body?.workspace)) }); }
    catch (error) {
      logger.error?.('CHARACTER_MAKER', 'workspace_create_failed', { requestId: res.locals.requestId, userId: req.user?.id, message: error instanceof Error ? error.message : String(error) });
      return res.status(500).json({ error: 'CHARACTER_WORKSPACE_CREATE_FAILED', message: 'ذخیره‌ی کاراکترها انجام نشد.' });
    }
  });
  router.get('/api/character-workspaces/:workspaceId', requirePrincipal, requireRepository, async (req, res) => {
    try {
      let workspace = await characterWorkspaceRepository.get(req.user.id, req.params.workspaceId);
      if (!workspace) return res.status(404).json({ error: 'CHARACTER_WORKSPACE_NOT_FOUND', message: 'این پروژه پیدا نشد.' });
      if (needsAssetBackfill(workspace)) workspace = await characterWorkspaceRepository.update(req.user.id, req.params.workspaceId, normalizeWorkspace(workspace));
      return res.json({ workspace });
    } catch { return res.status(500).json({ error: 'CHARACTER_WORKSPACE_GET_FAILED', message: 'دریافت پروژه انجام نشد.' }); }
  });
  router.get('/api/character-workspaces/:workspaceId/assets/:assetId', requirePrincipal, requireRepository, async (req, res) => {
    try {
      let workspace = await characterWorkspaceRepository.get(req.user.id, req.params.workspaceId);
      if (!workspace) return res.status(404).json({ error: 'CHARACTER_WORKSPACE_NOT_FOUND', message: 'این پروژه پیدا نشد.' });
      if (needsAssetBackfill(workspace)) workspace = await characterWorkspaceRepository.update(req.user.id, req.params.workspaceId, normalizeWorkspace(workspace));
      const asset = findWorkspaceAsset(workspace, req.params.assetId);
      if (!asset) return res.status(404).json({ error: 'CHARACTER_ASSET_NOT_FOUND', message: 'این مرجع پیدا نشد.' });
      return res.json({ asset: { ...asset, reference: getAssetReference(req.params.workspaceId, asset.assetId) } });
    } catch { return res.status(500).json({ error: 'CHARACTER_ASSET_GET_FAILED', message: 'دریافت مرجع انجام نشد.' }); }
  });
  router.patch('/api/character-workspaces/:workspaceId', requirePrincipal, requireRepository, async (req, res) => {
    try { const workspace = await characterWorkspaceRepository.update(req.user.id, req.params.workspaceId, normalizeWorkspace(req.body?.workspace)); return workspace ? res.json({ workspace }) : res.status(404).json({ error: 'CHARACTER_WORKSPACE_NOT_FOUND', message: 'این پروژه پیدا نشد.' }); } catch { return res.status(500).json({ error: 'CHARACTER_WORKSPACE_UPDATE_FAILED', message: 'ذخیره‌ی تغییرات انجام نشد.' }); }
  });
  return router;
}

module.exports = { createCharacterMakerRouter, normalizeAnalysis, normalizeWorkspace, parseCharacterAnalysisReply, getAssetReference, findWorkspaceAsset, needsAssetBackfill };
