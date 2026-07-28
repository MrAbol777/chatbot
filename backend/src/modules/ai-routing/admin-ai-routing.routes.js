'use strict';

const express = require('express');
const { randomUUID } = require('crypto');
const { ROUTING_POLICIES, VIDEO_CAPABILITIES } = require('./routing-policies');

const safeJson = (value, fallback = {}) => { if (value && typeof value === 'object') return value; try { return JSON.parse(value || '') || fallback; } catch (_) { return fallback; } };
const reasonOf = (body) => { const value = String(body?.reason || '').trim(); if (value.length < 5 || value.length > 500) throw Object.assign(new Error('Reason is required.'), { code: 'AI_ADMIN_REASON_REQUIRED', status: 400 }); return value; };
const versionOf = (body) => { const value = Number(body?.expectedVersion); if (!Number.isSafeInteger(value) || value < 1) throw Object.assign(new Error('Expected version is required.'), { code: 'AI_ADMIN_VERSION_REQUIRED', status: 400 }); return value; };
const booleanOr = (value, fallback) => typeof value === 'boolean' ? value : fallback;
const nullableLimit = (value, fallback) => value === undefined ? fallback : value === null || value === '' ? null : Number(value);
const maskedTaskId = (value) => { const text = String(value || ''); return text ? `${text.slice(0, 4)}…${text.slice(-3)}` : null; };
const bananaResultContractConfigured = (env) => Boolean(String(env.BANANAAI_VIDEO_RESULT_ALLOWED_HOSTS || '').trim() && String(env.BANANAAI_VIDEO_RESULT_ALLOWED_PATH_PREFIXES || '').trim());

function createAdminAiRoutingRouter({ db, requireAdminAuth, routeResolver = null, noaBillingService = null, env = process.env, appendAudit = async () => {} }) {
  const router = express.Router();
  const fail = (res, error) => res.status(error.status || (error.code === 'AI_ADMIN_VERSION_CONFLICT' ? 409 : 500)).json({ error: error.code || 'AI_ROUTING_ADMIN_FAILED', message: error.status && error.status < 500 ? error.message : 'عملیات مدیریت مسیر هوش مصنوعی ناموفق بود.' });
  const protect = (handler) => [requireAdminAuth, async (req, res) => { try { return await handler(req, res); } catch (error) { return fail(res, error); } }];
  const audit = (req, action, target, reason, details = {}) => appendAudit({ adminUsername: req.admin?.username, action, target, details: { reason, ...details } });

  router.get('/providers', ...protect(async (_req, res) => {
    const [rows] = await db.query('SELECT provider_key,display_name,enabled,api_key_env_name,max_concurrency,daily_cost_limit,config_json,version,updated_at FROM app_ai_providers ORDER BY provider_key');
    return res.json({ items: rows.map((row) => ({ providerKey: row.provider_key, displayName: row.display_name, enabled: Boolean(row.enabled), keyConfigured: Boolean(String(env[row.api_key_env_name] || '').trim()), maxConcurrency: row.max_concurrency == null ? null : Number(row.max_concurrency), dailyCostLimit: row.daily_cost_limit == null ? null : Number(row.daily_cost_limit), readiness: safeJson(row.config_json, {}).readiness || 'READY', version: Number(row.version), updatedAt: row.updated_at })) });
  }));

  router.patch('/providers/:providerKey', ...protect(async (req, res) => {
    const reason = reasonOf(req.body); const expectedVersion = versionOf(req.body); const key = String(req.params.providerKey || '');
    const [rows] = await db.query('SELECT * FROM app_ai_providers WHERE provider_key=? LIMIT 1', [key]); const current = rows[0];
    if (!current) return res.status(404).json({ error: 'AI_PROVIDER_NOT_FOUND' });
    const enabled = booleanOr(req.body.enabled, Boolean(current.enabled));
    const maxConcurrency = nullableLimit(req.body.maxConcurrency, current.max_concurrency);
    const dailyCostLimit = nullableLimit(req.body.dailyCostLimit, current.daily_cost_limit);
    if ((maxConcurrency != null && (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1)) || (dailyCostLimit != null && (!Number.isFinite(dailyCostLimit) || dailyCostLimit < 0))) throw Object.assign(new Error('Limits are invalid.'), { code: 'AI_PROVIDER_LIMIT_INVALID', status: 400 });
    if (key === 'bananaai' && enabled && (!String(env[current.api_key_env_name] || '').trim() || !bananaResultContractConfigured(env))) throw Object.assign(new Error('BananaAI readiness is blocked until key and exact result host/path allowlists are configured.'), { code: 'AI_PROVIDER_READINESS_BLOCKED', status: 409 });
    const [result] = await db.query('UPDATE app_ai_providers SET enabled=?,max_concurrency=?,daily_cost_limit=?,version=version+1,updated_at=NOW() WHERE provider_key=? AND version=?', [Number(enabled), maxConcurrency, dailyCostLimit, key, expectedVersion]);
    if (result.affectedRows !== 1) throw Object.assign(new Error('Version conflict.'), { code: 'AI_ADMIN_VERSION_CONFLICT', status: 409 });
    routeResolver?.invalidate(); await audit(req, 'ai_provider_updated', key, reason, { enabled, maxConcurrency, dailyCostLimit });
    return res.json({ success: true, version: expectedVersion + 1 });
  }));

  router.get('/models', ...protect(async (_req, res) => {
    const [rows] = await db.query('SELECT internal_key,provider,provider_model_id,display_name_fa,display_name,is_active,is_public,supports_text_to_video,supports_image_to_video,supports_negative_prompt,supports_audio,allowed_aspect_ratios,allowed_durations,allowed_resolutions,config_version,updated_at FROM app_video_models ORDER BY provider,sort_order,internal_key');
    return res.json({ items: rows.map((row) => ({ internalKey: row.internal_key, providerKey: row.provider, providerModelId: row.provider_model_id, displayNameFa: row.display_name_fa, displayName: row.display_name, active: Boolean(row.is_active), public: Boolean(row.is_public), capabilities: { textToVideo: Boolean(row.supports_text_to_video), imageToVideo: Boolean(row.supports_image_to_video), negativePrompt: Boolean(row.supports_negative_prompt), audio: Boolean(row.supports_audio) }, allowedAspectRatios: safeJson(row.allowed_aspect_ratios, []), allowedDurations: safeJson(row.allowed_durations, []), allowedResolutions: safeJson(row.allowed_resolutions, []), version: Number(row.config_version), updatedAt: row.updated_at })) });
  }));

  router.patch('/models/:modelKey', ...protect(async (req, res) => {
    const reason = reasonOf(req.body); const expectedVersion = versionOf(req.body); const key = String(req.params.modelKey || '');
    const [rows] = await db.query('SELECT * FROM app_video_models WHERE internal_key=? LIMIT 1', [key]); const current = rows[0];
    if (!current) return res.status(404).json({ error: 'AI_MODEL_NOT_FOUND' });
    const active = booleanOr(req.body.active, Boolean(current.is_active)); const isPublic = booleanOr(req.body.public, Boolean(current.is_public));
    if (current.provider === 'bananaai' && active && (!String(env.BANANAAI_API_KEY || '').trim() || !bananaResultContractConfigured(env))) throw Object.assign(new Error('BananaAI model readiness is blocked.'), { code: 'AI_PROVIDER_READINESS_BLOCKED', status: 409 });
    const [result] = await db.query('UPDATE app_video_models SET is_active=?,is_public=?,config_version=config_version+1,updated_at=NOW() WHERE internal_key=? AND config_version=?', [Number(active), Number(isPublic), key, expectedVersion]);
    if (result.affectedRows !== 1) throw Object.assign(new Error('Version conflict.'), { code: 'AI_ADMIN_VERSION_CONFLICT', status: 409 });
    routeResolver?.invalidate(); await audit(req, 'ai_model_updated', key, reason, { active, public: isPublic });
    return res.json({ success: true, version: expectedVersion + 1 });
  }));

  router.get('/routes', ...protect(async (_req, res) => {
    const [rows] = await db.query('SELECT * FROM app_ai_capability_routes ORDER BY capability_key');
    return res.json({ items: rows.map((row) => ({ routeId: row.route_id, capability: row.capability_key, primary: row.primary_provider_key ? { providerKey: row.primary_provider_key, modelKey: row.primary_model_key } : null, fallback: row.fallback_provider_key ? { providerKey: row.fallback_provider_key, modelKey: row.fallback_model_key } : null, policy: row.routing_policy, enabled: Boolean(row.enabled), maxConcurrency: row.max_concurrency == null ? null : Number(row.max_concurrency), dailyCostLimit: row.daily_cost_limit == null ? null : Number(row.daily_cost_limit), version: Number(row.version), updatedAt: row.updated_at })) });
  }));

  router.patch('/routes/:capability', ...protect(async (req, res) => {
    const reason = reasonOf(req.body); const expectedVersion = versionOf(req.body); const capability = String(req.params.capability || '');
    if (!Object.values(VIDEO_CAPABILITIES).includes(capability)) throw Object.assign(new Error('Capability is invalid.'), { code: 'AI_CAPABILITY_INVALID', status: 400 });
    const connection = await db.getConnection(); let next;
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query('SELECT * FROM app_ai_capability_routes WHERE capability_key=? FOR UPDATE', [capability]); const current = rows[0];
      if (!current) { await connection.rollback(); return res.status(404).json({ error: 'AI_ROUTE_NOT_FOUND' }); }
      if (Number(current.version) !== expectedVersion) throw Object.assign(new Error('Version conflict.'), { code: 'AI_ADMIN_VERSION_CONFLICT', status: 409 });
      next = {
        primaryProviderKey: req.body.primaryProviderKey === undefined ? current.primary_provider_key : req.body.primaryProviderKey || null,
        primaryModelKey: req.body.primaryModelKey === undefined ? current.primary_model_key : req.body.primaryModelKey || null,
        fallbackProviderKey: req.body.fallbackProviderKey === undefined ? current.fallback_provider_key : req.body.fallbackProviderKey || null,
        fallbackModelKey: req.body.fallbackModelKey === undefined ? current.fallback_model_key : req.body.fallbackModelKey || null,
        policy: req.body.policy || current.routing_policy,
        enabled: booleanOr(req.body.enabled, Boolean(current.enabled)),
        maxConcurrency: nullableLimit(req.body.maxConcurrency, current.max_concurrency),
        dailyCostLimit: nullableLimit(req.body.dailyCostLimit, current.daily_cost_limit)
      };
      if (!Object.values(ROUTING_POLICIES).includes(next.policy)) throw Object.assign(new Error('Policy is invalid.'), { code: 'AI_ROUTING_POLICY_INVALID', status: 400 });
      for (const [providerKey, modelKey] of [[next.primaryProviderKey, next.primaryModelKey], [next.fallbackProviderKey, next.fallbackModelKey]]) {
        if (Boolean(providerKey) !== Boolean(modelKey)) throw Object.assign(new Error('Provider and model must be selected together.'), { code: 'AI_ROUTE_DESTINATION_INVALID', status: 400 });
        if (!providerKey) continue;
        const [destinations] = await connection.query('SELECT p.enabled AS provider_enabled,m.provider,m.is_active FROM app_ai_providers p JOIN app_video_models m ON m.internal_key=? WHERE p.provider_key=? LIMIT 1', [modelKey, providerKey]);
        if (!destinations[0] || destinations[0].provider !== providerKey) throw Object.assign(new Error('Provider/model mismatch.'), { code: 'AI_MODEL_PROVIDER_MISMATCH', status: 400 });
        if (next.enabled && (!destinations[0].provider_enabled || !destinations[0].is_active)) throw Object.assign(new Error('Enabled routes require enabled destinations.'), { code: 'AI_ROUTE_DESTINATION_DISABLED', status: 409 });
      }
      if (next.enabled && next.policy !== 'FALLBACK_ONLY' && !next.primaryProviderKey) throw Object.assign(new Error('Primary destination is required.'), { code: 'AI_ROUTE_DESTINATION_REQUIRED', status: 400 });
      if (next.enabled && next.policy === 'FALLBACK_ONLY' && !next.fallbackProviderKey) throw Object.assign(new Error('Fallback destination is required.'), { code: 'AI_ROUTE_DESTINATION_REQUIRED', status: 400 });
      await connection.query('UPDATE app_ai_capability_routes SET primary_provider_key=?,primary_model_key=?,fallback_provider_key=?,fallback_model_key=?,routing_policy=?,enabled=?,max_concurrency=?,daily_cost_limit=?,version=version+1,updated_at=NOW() WHERE route_id=? AND version=?', [next.primaryProviderKey,next.primaryModelKey,next.fallbackProviderKey,next.fallbackModelKey,next.policy,Number(next.enabled),next.maxConcurrency,next.dailyCostLimit,current.route_id,expectedVersion]);
      await connection.query('INSERT INTO app_ai_route_audit_logs (route_id,capability_key,previous_configuration,new_configuration,changed_by,reason,created_at) VALUES (?,?,?,?,?,?,NOW())', [current.route_id, capability, JSON.stringify(current), JSON.stringify(next), String(req.admin?.username || 'admin').slice(0,191), reason]);
      await connection.commit();
    } catch (error) { try { await connection.rollback(); } catch (_) {} throw error; } finally { connection.release(); }
    routeResolver?.invalidate(capability); await audit(req, 'ai_route_updated', capability, reason, next);
    return res.json({ success: true, version: expectedVersion + 1 });
  }));

  router.get('/health', ...protect(async (_req, res) => {
    const [rows] = await db.query('SELECT * FROM app_ai_provider_health ORDER BY provider_key,capability_key');
    return res.json({ items: rows.map((row) => ({ providerKey: row.provider_key, capability: row.capability_key, circuitState: row.circuit_state, consecutiveFailures: Number(row.consecutive_failures), retryAfter: row.retry_after, averageLatencyMs: row.average_latency_ms == null ? null : Number(row.average_latency_ms), successCount: Number(row.success_count), failureCount: Number(row.failure_count), version: Number(row.version), updatedAt: row.updated_at })) });
  }));

  router.post('/health/:providerKey/:capability/reset', ...protect(async (req, res) => {
    const reason = reasonOf(req.body); const expectedVersion = versionOf(req.body);
    const [result] = await db.query("UPDATE app_ai_provider_health SET circuit_state='CLOSED',consecutive_failures=0,half_open_attempts=0,retry_after=NULL,opened_at=NULL,version=version+1,updated_at=NOW() WHERE provider_key=? AND capability_key=? AND version=?", [req.params.providerKey, req.params.capability, expectedVersion]);
    if (result.affectedRows !== 1) throw Object.assign(new Error('Version conflict.'), { code: 'AI_ADMIN_VERSION_CONFLICT', status: 409 });
    routeResolver?.invalidate(req.params.capability); await audit(req, 'ai_circuit_reset', `${req.params.providerKey}:${req.params.capability}`, reason);
    return res.json({ success: true, version: expectedVersion + 1 });
  }));

  router.get('/attempts', ...protect(async (req, res) => {
    const state = String(req.query.state || ''); const params = []; let where = '';
    if (state) { where = 'WHERE a.state=?'; params.push(state); }
    const [rows] = await db.query(`SELECT a.*,g.status AS job_status FROM app_ai_provider_attempts a JOIN app_video_generations g ON g.id=a.job_id ${where} ORDER BY a.created_at DESC LIMIT 200`, params);
    return res.json({ items: rows.map((row) => ({ attemptId: row.attempt_id, jobId: row.job_id, capability: row.capability_key, providerKey: row.provider_key, modelKey: row.internal_model_key, attemptNumber: Number(row.attempt_number), state: row.state, providerTaskIdMasked: maskedTaskId(row.provider_task_id), jobStatus: row.job_status, actualCost: row.actual_cost == null ? null : Number(row.actual_cost), costCurrency: row.cost_currency, safeErrorSummary: row.safe_error_summary, version: Number(row.version), createdAt: row.created_at, updatedAt: row.updated_at })) });
  }));

  router.post('/attempts/:attemptId/recovery', ...protect(async (req, res) => {
    const reason = reasonOf(req.body); const expectedVersion = versionOf(req.body); const action = String(req.body.action || '');
    if (!['ATTACH_TASK_ID','CONFIRM_NOT_ACCEPTED','FAIL_RELEASE'].includes(action)) throw Object.assign(new Error('Recovery action is invalid.'), { code: 'AI_RECOVERY_ACTION_INVALID', status: 400 });
    if (action === 'FAIL_RELEASE' && !['finance', 'superadmin'].includes(String(req.admin?.role || '').trim().toLowerCase())) {
      throw Object.assign(new Error('Finance role is required for releasing Noa.'), { code: 'NOA_FINANCE_ROLE_REQUIRED', status: 403 });
    }
    const connection = await db.getConnection(); let outcome;
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query('SELECT a.*,g.status AS job_status,g.route_snapshot,g.provider,g.model_key,g.noa_reservation_id FROM app_ai_provider_attempts a JOIN app_video_generations g ON g.id=a.job_id WHERE a.attempt_id=? FOR UPDATE', [req.params.attemptId]); const attempt = rows[0];
      if (!attempt || attempt.state !== 'ambiguous' || attempt.job_status !== 'provider_status_unknown') throw Object.assign(new Error('Attempt is not recoverable.'), { code: 'AI_RECOVERY_STATE_CONFLICT', status: 409 });
      if (Number(attempt.version) !== expectedVersion) throw Object.assign(new Error('Version conflict.'), { code: 'AI_ADMIN_VERSION_CONFLICT', status: 409 });
      if (action === 'ATTACH_TASK_ID') {
        const taskId = String(req.body.providerTaskId || '').trim(); if (!taskId || taskId.length > 191) throw Object.assign(new Error('Task ID is invalid.'), { code: 'AI_RECOVERY_TASK_ID_INVALID', status: 400 });
        await connection.query("UPDATE app_ai_provider_attempts SET state='accepted',provider_task_id=?,version=version+1,updated_at=NOW() WHERE attempt_id=? AND version=?", [taskId, attempt.attempt_id, expectedVersion]);
        await connection.query("UPDATE app_video_generations SET status='submitted',provider_job_id=?,safe_error_code=NULL,safe_error_message=NULL,next_poll_at=NOW(),updated_at=NOW() WHERE id=? AND status='provider_status_unknown'", [taskId, attempt.job_id]);
        outcome = 'task-attached';
      } else if (action === 'CONFIRM_NOT_ACCEPTED') {
        const snapshot = safeJson(attempt.route_snapshot, {}); const currentIndex = snapshot.candidates?.findIndex((item) => item.providerKey === attempt.provider_key && item.modelKey === attempt.internal_model_key) ?? -1; const next = snapshot.routingPolicy === 'AUTO_FALLBACK' ? snapshot.candidates?.[currentIndex + 1] : null;
        if (!next?.available || !next.providerKey || !next.modelKey || !next.providerModelId) throw Object.assign(new Error('No documented fallback is available.'), { code: 'AI_RECOVERY_FALLBACK_UNAVAILABLE', status: 409 });
        const nextAttemptId = randomUUID();
        await connection.query("UPDATE app_ai_provider_attempts SET state='rejected',safe_error_summary='مدیر عدم پذیرش Provider را تأیید کرد.',version=version+1,updated_at=NOW() WHERE attempt_id=? AND version=?", [attempt.attempt_id, expectedVersion]);
        await connection.query(`INSERT INTO app_ai_provider_attempts (attempt_id,internal_request_id,job_id,capability_key,route_id,route_version,provider_key,provider_model_id,internal_model_key,attempt_number,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?, 'planned',NOW(),NOW())`, [nextAttemptId,attempt.internal_request_id,attempt.job_id,attempt.capability_key,attempt.route_id,attempt.route_version,next.providerKey,next.providerModelId,next.modelKey,Number(attempt.attempt_number)+1]);
        await connection.query("UPDATE app_video_generations SET status='queued',provider=?,model_key=?,provider_model_id_snapshot=?,provider_attempt_id=?,provider_job_id=NULL,safe_error_code=NULL,safe_error_message=NULL,next_poll_at=NOW(),updated_at=NOW() WHERE id=? AND status='provider_status_unknown'", [next.providerKey,next.modelKey,next.providerModelId,nextAttemptId,attempt.job_id]);
        outcome = 'fallback-queued';
      } else {
        if (!noaBillingService || !attempt.noa_reservation_id) throw Object.assign(new Error('Noa reservation is not releasable.'), { code: 'AI_RECOVERY_RESERVATION_CONFLICT', status: 409 });
        await noaBillingService.release(attempt.noa_reservation_id, {
          connection,
          reason: 'admin_unknown_recovery',
          actorType: 'admin',
          actorId: String(req.admin?.id || req.admin?.username || ''),
          metadata: { attemptId: attempt.attempt_id, jobId: attempt.job_id, reviewReason: reason }
        });
        await connection.query("UPDATE app_ai_provider_attempts SET state='failed',safe_error_summary='مدیر Job نامعلوم را خاتمه داد.',version=version+1,updated_at=NOW() WHERE attempt_id=? AND version=?", [attempt.attempt_id,expectedVersion]);
        await connection.query("UPDATE app_video_generations SET status='failed',safe_error_code='VIDEO_ADMIN_RECOVERY_FAILED',safe_error_message='درخواست پس از بررسی مدیر خاتمه یافت.',failed_at=NOW(),updated_at=NOW() WHERE id=? AND status='provider_status_unknown'", [attempt.job_id]);
        outcome = 'failed-released';
      }
      await connection.commit();
    } catch (error) { try { await connection.rollback(); } catch (_) {} throw error; } finally { connection.release(); }
    await audit(req, 'ai_unknown_recovery', req.params.attemptId, reason, { action, outcome });
    return res.json({ success: true, outcome, version: expectedVersion + 1 });
  }));

  router.get('/audit', ...protect(async (_req, res) => {
    const [rows] = await db.query('SELECT id,route_id,capability_key,previous_configuration,new_configuration,changed_by,reason,created_at FROM app_ai_route_audit_logs ORDER BY id DESC LIMIT 200');
    return res.json({ items: rows.map((row) => ({ id: row.id, routeId: row.route_id, capability: row.capability_key, previous: safeJson(row.previous_configuration, null), next: safeJson(row.new_configuration, null), changedBy: row.changed_by, reason: row.reason, createdAt: row.created_at })) });
  }));

  router.get('/metrics', ...protect(async (_req, res) => {
    const [rows] = await db.query("SELECT provider_key,capability_key,COUNT(*) AS attempts,SUM(state='completed') AS successes,SUM(state IN ('failed','rejected','ambiguous')) AS failures,AVG(processing_time_ms) AS average_latency_ms,SUM(actual_cost) AS actual_cost,cost_currency FROM app_ai_provider_attempts GROUP BY provider_key,capability_key,cost_currency ORDER BY provider_key,capability_key");
    return res.json({ items: rows.map((row) => ({ providerKey: row.provider_key, capability: row.capability_key, attempts: Number(row.attempts), successes: Number(row.successes), failures: Number(row.failures), averageLatencyMs: row.average_latency_ms == null ? null : Number(row.average_latency_ms), actualCost: row.actual_cost == null ? null : Number(row.actual_cost), costCurrency: row.cost_currency })) });
  }));

  return router;
}

module.exports = { createAdminAiRoutingRouter, maskedTaskId };
