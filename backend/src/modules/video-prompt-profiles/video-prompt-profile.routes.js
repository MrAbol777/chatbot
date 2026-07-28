'use strict';

const express = require('express');
const { createVideoPromptProfileRepository } = require('./video-prompt-profile.repository');
const { VideoPromptCompiler } = require('./video-prompt-compiler');

const reasonOf = (body) => { const reason = String(body?.reason || '').trim(); if (reason.length < 5 || reason.length > 500) throw Object.assign(new Error('دلیل تغییر الزامی است.'), { code: 'VIDEO_PROMPT_PROFILE_REASON_REQUIRED', status: 400 }); return reason; };
const versionOf = (body) => { const version = Number(body?.expectedVersion); if (!Number.isSafeInteger(version) || version < 1) throw Object.assign(new Error('نسخه مورد انتظار الزامی است.'), { code: 'VIDEO_PROMPT_PROFILE_EXPECTED_VERSION_REQUIRED', status: 400 }); return version; };
const profileKeyOf = (value) => { const key = String(value || '').trim(); if (!/^[a-z0-9_-]{2,64}$/i.test(key)) throw Object.assign(new Error('کلید پروفایل معتبر نیست.'), { code: 'VIDEO_PROMPT_PROFILE_KEY_INVALID', status: 400 }); return key; };
const sendError = (res, error) => res.status(error.status || 500).json({ error: error.code || 'VIDEO_PROMPT_PROFILE_FAILED', message: error.status && error.status < 500 ? error.message : 'عملیات پروفایل ساخت ویدیو ناموفق بود.' });

function createVideoPromptProfilePublicRouter({ repository }) {
  const router = express.Router();
  router.get('/', async (_req, res) => { try { return res.json({ items: await repository.listPublic() }); } catch (error) { return sendError(res, error); } });
  return router;
}

function createVideoPromptProfileAdminRouter({ db, requireAdminAuth, appendAudit = async () => {} }) {
  const router = express.Router(); const repository = createVideoPromptProfileRepository(db); const compiler = new VideoPromptCompiler();
  const protect = (handler) => [requireAdminAuth, async (req, res) => { try { return await handler(req, res); } catch (error) { return sendError(res, error); } }];
  const audit = (req, action, target, reason, details = {}) => appendAudit({ adminUsername: req.admin?.username, action, target, details: { reason, ...details } });

  router.get('/', ...protect(async (_req, res) => res.json({ items: await repository.listAdmin() })));
  router.get('/audit', ...protect(async (req, res) => res.json({ items: await repository.listAudit(req.query.profileKey ? profileKeyOf(req.query.profileKey) : null) })));
  router.get('/:profileKey', ...protect(async (req, res) => { const item = await repository.getAdmin(profileKeyOf(req.params.profileKey)); return item ? res.json(item) : res.status(404).json({ error: 'VIDEO_PROMPT_PROFILE_NOT_FOUND' }); }));
  router.get('/:profileKey/versions', ...protect(async (req, res) => res.json({ items: await repository.listVersions(profileKeyOf(req.params.profileKey)) })));
  router.patch('/:profileKey', ...protect(async (req, res) => {
    const profileKey = profileKeyOf(req.params.profileKey); const reason = reasonOf(req.body); const expectedVersion = versionOf(req.body);
    const result = await repository.updateMetadata({ profileKey, expectedVersion, reason, adminId: req.admin?.username, changes: req.body || {} });
    await audit(req, 'video_prompt_profile_updated', profileKey, reason); return res.json({ success: true, ...result });
  }));
  router.post('/:profileKey/versions', ...protect(async (req, res) => {
    const profileKey = profileKeyOf(req.params.profileKey); const reason = reasonOf(req.body); const expectedVersion = versionOf(req.body);
    const result = await repository.createVersion({ profileKey, expectedVersion, reason, adminId: req.admin?.username, baseSystemPrompt: req.body.baseSystemPrompt, executionTemplate: req.body.executionTemplate, rulesManifest: req.body.rulesManifest });
    await audit(req, 'video_prompt_profile_version_created', profileKey, reason, { promptVersion: result.version, checksum: result.checksum }); return res.status(201).json({ success: true, ...result });
  }));
  router.post('/:profileKey/compile-preview', ...protect(async (req, res) => {
    const profileKey = profileKeyOf(req.params.profileKey); const profile = await repository.getCurrentByKey(profileKey, { publicOnly: false });
    if (!profile) return res.status(404).json({ error: 'VIDEO_PROMPT_PROFILE_NOT_FOUND' });
    const preview = compiler.compile({ profile, userPrompt: req.body?.userPrompt, settings: req.body?.settings || {} });
    return res.json(preview);
  }));
  return router;
}

module.exports = { createVideoPromptProfilePublicRouter, createVideoPromptProfileAdminRouter, createVideoPromptProfileRepository };

