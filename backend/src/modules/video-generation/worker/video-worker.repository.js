const {
  JOB_STATUSES,
  isTerminalJobStatus,
  canTransitionJob
} = require('../video-generation.states');

class VideoWorkerRepositoryError extends Error {
  constructor(code, message = 'Video worker transaction could not be completed.') {
    super(message);
    this.name = 'VideoWorkerRepositoryError';
    this.code = code;
  }
}

const safeText = (value, maximum) => String(value || '').slice(0, maximum) || null;
const asPositiveInteger = (value, field) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new VideoWorkerRepositoryError('VIDEO_WORKER_VALUE_INVALID', `${field} must be a positive integer.`);
  }
  return number;
};

function createVideoWorkerRepository(db, { faultInjector, claimProvider = null, noaBillingService } = {}) {
  if (!noaBillingService || typeof noaBillingService.capture !== 'function' || typeof noaBillingService.release !== 'function') {
    throw new Error('NOA_BILLING_SERVICE_REQUIRED');
  }
  const scopedProvider = claimProvider === null ? null : String(claimProvider || '').trim();
  if (claimProvider !== null && !/^[a-z0-9_-]{1,32}$/i.test(scopedProvider)) throw new Error('claimProvider must be a safe provider identifier.');
  // DB integration tests share a developer-local database. Their fixtures use
  // only the fake/test providers, so claims must never pick up a real pending
  // provider job merely because it is due for polling.
  const testProviderGuard = process.env.NODE_ENV === 'test' && !scopedProvider;
  const injectFault = process.env.NODE_ENV === 'test' && typeof faultInjector === 'function'
    ? async (point) => faultInjector(point)
    : async () => {};

  async function inTransaction(work) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      try { await connection.rollback(); } catch (_) {}
      throw error;
    } finally {
      connection.release();
    }
  }

  async function getLockedJob(connection, jobId) {
    const [rows] = await connection.query('SELECT * FROM app_video_generations WHERE id=? FOR UPDATE', [jobId]);
    if (!rows[0]) throw new VideoWorkerRepositoryError('VIDEO_WORKER_JOB_NOT_FOUND');
    return rows[0];
  }

  function getNoaReservationId(job) {
    const reservationId = String(job?.noa_reservation_id || '').trim();
    if (!reservationId) throw new VideoWorkerRepositoryError('VIDEO_WORKER_NOA_RESERVATION_NOT_FOUND');
    return reservationId;
  }

  function claimProviderPredicate() {
    if (scopedProvider) return ' AND provider=?';
    return testProviderGuard ? " AND provider IN ('fake','test')" : '';
  }

  function claimProviderParams() {
    return scopedProvider ? [scopedProvider] : [];
  }

  async function ensureExpectedLease(job, workerId) {
    if (!workerId) return;
    if (job.worker_lease_owner !== workerId || !job.worker_lease_until || new Date(job.worker_lease_until) <= new Date()) {
      throw new VideoWorkerRepositoryError('VIDEO_WORKER_LEASE_NOT_OWNED');
    }
  }

  async function getLockedAttempt(connection, attemptId) {
    const [rows] = await connection.query('SELECT * FROM app_ai_provider_attempts WHERE attempt_id=? FOR UPDATE', [attemptId]);
    if (!rows[0]) throw new VideoWorkerRepositoryError('VIDEO_PROVIDER_ATTEMPT_NOT_FOUND');
    return rows[0];
  }

  async function finalizeSuccessfulJob({ jobId, workerId }) {
    return inTransaction(async (connection) => {
      const job = await getLockedJob(connection, jobId);
      if (job.status === JOB_STATUSES.SUCCEEDED) {
        return { idempotent: true, jobId };
      }
      await ensureExpectedLease(job, workerId);
      // Only legacy Fake-provider fixtures can settle without a storage
      // pipeline. Real providers can reach succeeded solely from `storing`.
      const legacyFakeFixture = process.env.NODE_ENV === 'test'
        && ['fake', 'test'].includes(String(job.provider || ''))
        && ['submitted', 'processing'].includes(job.status);
      if (isTerminalJobStatus(job.status) || (!canTransitionJob(job.status, JOB_STATUSES.SUCCEEDED) && !legacyFakeFixture)) {
        throw new VideoWorkerRepositoryError('VIDEO_WORKER_STATE_CONFLICT');
      }
      await injectFault('before_reservation_change');
      await noaBillingService.capture(getNoaReservationId(job), {
        connection,
        actorType: 'system',
        actorId: 'video-worker',
        metadata: { generationId: job.id, settlement: 'provider_success' }
      });
      await injectFault('before_job_change');
      const [jobResult] = await connection.query(
        "UPDATE app_video_generations SET status='succeeded', completed_at=COALESCE(completed_at,NOW()), worker_lease_owner=NULL, worker_lease_until=NULL, updated_at=NOW() WHERE id=? AND status IN ('submitted','processing','storing')",
        [job.id]
      );
      if (jobResult.affectedRows !== 1) throw new VideoWorkerRepositoryError('VIDEO_WORKER_JOB_STATE_CONFLICT');
      return { idempotent: false, jobId };
    });
  }

  async function releaseJob({ jobId, workerId, terminalStatus, errorCode = null, errorMessage = null, releaseReason = null }) {
    return inTransaction(async (connection) => {
      const job = await getLockedJob(connection, jobId);
      if (job.status === terminalStatus) {
        return { idempotent: true, jobId };
      }
      await ensureExpectedLease(job, workerId);
      if (isTerminalJobStatus(job.status) || !canTransitionJob(job.status, terminalStatus)) {
        throw new VideoWorkerRepositoryError('VIDEO_WORKER_STATE_CONFLICT');
      }
      await injectFault('before_reservation_change');
      await noaBillingService.release(getNoaReservationId(job), {
        connection,
        reason: releaseReason || (terminalStatus === JOB_STATUSES.EXPIRED ? 'job_expired' : 'provider_failure'),
        actorType: 'system',
        actorId: 'video-worker',
        metadata: { generationId: job.id, terminalStatus, errorCode }
      });
      await injectFault('before_job_change');
      const jobSql = terminalStatus === JOB_STATUSES.EXPIRED
        ? "UPDATE app_video_generations SET status='expired', expired_at=COALESCE(expired_at,NOW()), safe_error_code=?, safe_error_message=?, worker_lease_owner=NULL, worker_lease_until=NULL, updated_at=NOW() WHERE id=? AND status IN ('queued','routing','submitting','submitted','processing','storing','provider_status_unknown')"
        : "UPDATE app_video_generations SET status='failed', failed_at=COALESCE(failed_at,NOW()), safe_error_code=?, safe_error_message=?, worker_lease_owner=NULL, worker_lease_until=NULL, updated_at=NOW() WHERE id=? AND status IN ('queued','routing','submitting','submitted','processing','storing','provider_status_unknown')";
      const params = terminalStatus === JOB_STATUSES.EXPIRED
        ? [safeText(errorCode, 100), safeText(errorMessage, 500), job.id]
        : [safeText(errorCode, 100), safeText(errorMessage, 500), job.id];
      const [jobResult] = await connection.query(jobSql, params);
      if (jobResult.affectedRows !== 1) throw new VideoWorkerRepositoryError('VIDEO_WORKER_JOB_STATE_CONFLICT');
      return { idempotent: false, jobId };
    });
  }

  return {
    recordProviderOutcome: async ({ providerKey, capabilityKey, success, latencyMs = null }) => inTransaction(async (connection) => {
      await connection.query("INSERT IGNORE INTO app_ai_provider_health (provider_key,capability_key,circuit_state,failure_threshold,cooldown_seconds,half_open_max_attempts,half_open_attempts,consecutive_failures,success_count,failure_count,updated_at) VALUES (?,?,'CLOSED',5,300,1,0,0,0,0,NOW())", [providerKey, capabilityKey]);
      const [rows] = await connection.query('SELECT * FROM app_ai_provider_health WHERE provider_key=? AND capability_key=? FOR UPDATE', [providerKey, capabilityKey]);
      const health = rows[0]; const latency = Number.isFinite(Number(latencyMs)) && Number(latencyMs) >= 0 ? Number(latencyMs) : null;
      if (success) {
        await connection.query("UPDATE app_ai_provider_health SET circuit_state='CLOSED',consecutive_failures=0,half_open_attempts=0,retry_after=NULL,opened_at=NULL,last_success_at=NOW(),success_count=success_count+1,average_latency_ms=CASE WHEN ? IS NULL THEN average_latency_ms WHEN average_latency_ms IS NULL THEN ? ELSE (average_latency_ms*0.8)+(?*0.2) END,version=version+1,updated_at=NOW() WHERE provider_key=? AND capability_key=?", [latency,latency,latency,providerKey,capabilityKey]);
        return 'CLOSED';
      }
      const failures = Number(health.consecutive_failures) + 1; const shouldOpen = health.circuit_state === 'HALF_OPEN' || failures >= Number(health.failure_threshold);
      await connection.query(`UPDATE app_ai_provider_health SET consecutive_failures=?,last_failure_at=NOW(),failure_count=failure_count+1,circuit_state=?,opened_at=IF(?='OPEN',NOW(),opened_at),retry_after=IF(?='OPEN',DATE_ADD(NOW(), INTERVAL ? SECOND),retry_after),half_open_attempts=IF(?='OPEN',0,half_open_attempts),version=version+1,updated_at=NOW() WHERE provider_key=? AND capability_key=?`, [failures,shouldOpen?'OPEN':health.circuit_state,shouldOpen?'OPEN':health.circuit_state,shouldOpen?'OPEN':health.circuit_state,Number(health.cooldown_seconds),shouldOpen?'OPEN':health.circuit_state,providerKey,capabilityKey]);
      return shouldOpen ? 'OPEN' : health.circuit_state;
    }),
    recordAttemptPoll: async ({ attemptId, normalizedStatus, actualCost = null, costCurrency = null, latencyMs = null }) => {
      if (!attemptId) return false;
      const state = ({ submitted: 'accepted', processing: 'processing', storing: 'completed', failed: 'failed', cancelled: 'cancelled' })[normalizedStatus];
      if (!state) return false;
      const [result] = await db.query("UPDATE app_ai_provider_attempts SET state=?,last_polled_at=NOW(),completed_at=IF(? IN ('completed','failed','cancelled'),COALESCE(completed_at,NOW()),completed_at),actual_cost=COALESCE(?,actual_cost),cost_currency=COALESCE(?,cost_currency),processing_time_ms=COALESCE(?,processing_time_ms),updated_at=NOW() WHERE attempt_id=? AND state IN ('accepted','processing')", [state,state,Number.isFinite(Number(actualCost))?Number(actualCost):null,safeText(costCurrency,16),Number.isFinite(Number(latencyMs))?Number(latencyMs):null,attemptId]);
      return result.affectedRows === 1;
    },
    claimSubmittableJobs: async ({ workerId, leaseSeconds = 60, limit = 1 }) => {
      const owner = safeText(workerId, 191);
      const seconds = asPositiveInteger(leaseSeconds, 'leaseSeconds');
      const maximum = asPositiveInteger(limit, 'limit');
      if (!owner) throw new VideoWorkerRepositoryError('VIDEO_WORKER_OWNER_REQUIRED');
      return inTransaction(async (connection) => {
        const claimed = [];
        for (let index = 0; index < maximum; index += 1) {
          const [candidates] = await connection.query(
            `SELECT id FROM app_video_generations WHERE status='queued' AND provider_job_id IS NULL AND expires_at>NOW() AND (worker_lease_until IS NULL OR worker_lease_until<=NOW())${claimProviderPredicate()} ORDER BY created_at LIMIT 1 FOR UPDATE`,
            claimProviderParams()
          );
          if (!candidates[0]) break;
          const [updated] = await connection.query(
            `UPDATE app_video_generations SET worker_lease_owner=?,worker_lease_until=DATE_ADD(NOW(), INTERVAL ? SECOND),updated_at=NOW() WHERE id=? AND status='queued' AND provider_job_id IS NULL AND (worker_lease_until IS NULL OR worker_lease_until<=NOW())${claimProviderPredicate()}`,
            [owner, seconds, candidates[0].id, ...claimProviderParams()]
          );
          if (updated.affectedRows !== 1) continue;
          const [rows] = await connection.query('SELECT g.*,m.mime_type AS input_media_mime_type FROM app_video_generations g LEFT JOIN app_video_input_media m ON m.id=g.input_media_id WHERE g.id=?', [candidates[0].id]);
          claimed.push(rows[0]);
        }
        return claimed;
      });
    },
    beginSubmission: async ({ jobId, workerId }) => inTransaction(async (connection) => {
      const job = await getLockedJob(connection, jobId);
      await ensureExpectedLease(job, workerId);
      if (job.status !== 'queued' || job.provider_job_id || !job.provider_attempt_id) throw new VideoWorkerRepositoryError('VIDEO_SUBMIT_STATE_CONFLICT');
      const attempt = await getLockedAttempt(connection, job.provider_attempt_id);
      if (attempt.job_id !== job.id || attempt.state !== 'planned') throw new VideoWorkerRepositoryError('VIDEO_SUBMIT_ATTEMPT_CONFLICT');
      const [attemptResult] = await connection.query("UPDATE app_ai_provider_attempts SET state='submitting',submit_started_at=NOW(),updated_at=NOW() WHERE attempt_id=? AND state='planned'", [attempt.attempt_id]);
      const [jobResult] = await connection.query("UPDATE app_video_generations SET status='submitting',updated_at=NOW() WHERE id=? AND status='queued' AND provider_job_id IS NULL", [job.id]);
      if (attemptResult.affectedRows !== 1 || jobResult.affectedRows !== 1) throw new VideoWorkerRepositoryError('VIDEO_SUBMIT_STATE_CONFLICT');
      return attempt;
    }),
    markSubmissionAccepted: async ({ jobId, workerId, providerJobId, creditsReserved = null }) => inTransaction(async (connection) => {
      const job = await getLockedJob(connection, jobId);
      await ensureExpectedLease(job, workerId);
      const attempt = await getLockedAttempt(connection, job.provider_attempt_id);
      if (job.status !== 'submitting' || attempt.state !== 'submitting' || !String(providerJobId || '').trim()) throw new VideoWorkerRepositoryError('VIDEO_SUBMIT_STATE_CONFLICT');
      await connection.query("UPDATE app_ai_provider_attempts SET state='accepted',provider_task_id=?,credit_used=?,submit_finished_at=NOW(),updated_at=NOW() WHERE attempt_id=? AND state='submitting'", [safeText(providerJobId, 191), Number.isFinite(Number(creditsReserved)) ? Number(creditsReserved) : null, attempt.attempt_id]);
      const [result] = await connection.query("UPDATE app_video_generations SET status='submitted',provider_job_id=?,provider_status='pending',submitted_at=NOW(),next_poll_at=NOW(),worker_lease_owner=NULL,worker_lease_until=NULL,updated_at=NOW() WHERE id=? AND status='submitting' AND worker_lease_owner=?", [safeText(providerJobId, 191), job.id, safeText(workerId, 191)]);
      if (result.affectedRows !== 1) throw new VideoWorkerRepositoryError('VIDEO_SUBMIT_STATE_CONFLICT');
      return true;
    }),
    markSubmissionAmbiguous: async ({ jobId, workerId, errorCode = 'VIDEO_PROVIDER_STATUS_UNKNOWN' }) => inTransaction(async (connection) => {
      const job = await getLockedJob(connection, jobId);
      await ensureExpectedLease(job, workerId);
      const attempt = await getLockedAttempt(connection, job.provider_attempt_id);
      if (job.status !== 'submitting' || !['submitting', 'planned'].includes(attempt.state)) throw new VideoWorkerRepositoryError('VIDEO_SUBMIT_STATE_CONFLICT');
      await connection.query("UPDATE app_ai_provider_attempts SET state='ambiguous',error_code=?,safe_error_summary='وضعیت پذیرش درخواست Provider نامعلوم است.',submit_finished_at=NOW(),updated_at=NOW() WHERE attempt_id=?", [safeText(errorCode, 100), attempt.attempt_id]);
      await connection.query("UPDATE app_video_generations SET status='provider_status_unknown',safe_error_code=?,safe_error_message='وضعیت پذیرش درخواست Provider نامعلوم است و نیازمند بررسی مدیر است.',worker_lease_owner=NULL,worker_lease_until=NULL,updated_at=NOW() WHERE id=? AND status='submitting'", [safeText(errorCode, 100), job.id]);
      return true;
    }),
    rejectSubmissionAndRoute: async ({ jobId, workerId, errorCode, errorMessage }) => inTransaction(async (connection) => {
      const job = await getLockedJob(connection, jobId);
      await ensureExpectedLease(job, workerId);
      const attempt = await getLockedAttempt(connection, job.provider_attempt_id);
      if (!['queued', 'routing', 'submitting'].includes(job.status) || !['planned', 'submitting'].includes(attempt.state)) throw new VideoWorkerRepositoryError('VIDEO_SUBMIT_STATE_CONFLICT');
      await connection.query("UPDATE app_ai_provider_attempts SET state='rejected',error_code=?,safe_error_summary=?,submit_finished_at=NOW(),updated_at=NOW() WHERE attempt_id=?", [safeText(errorCode, 100), safeText(errorMessage, 500), attempt.attempt_id]);
      let snapshot = {};
      try { snapshot = typeof job.route_snapshot === 'string' ? JSON.parse(job.route_snapshot) : job.route_snapshot || {}; } catch (_) {}
      const currentIndex = Array.isArray(snapshot.candidates)
        ? snapshot.candidates.findIndex((candidate) => candidate.providerKey === job.provider && candidate.modelKey === job.model_key)
        : Number(snapshot.selectedIndex || 0);
      const nextIndex = (currentIndex >= 0 ? currentIndex : Number(snapshot.selectedIndex || 0)) + 1;
      const next = snapshot.routingPolicy === 'AUTO_FALLBACK' ? snapshot.candidates?.[nextIndex] : null;
      if (next?.available && next.providerKey && next.modelKey && next.providerModelId) {
        const nextAttemptId = require('crypto').randomUUID();
        await connection.query(
          `INSERT INTO app_ai_provider_attempts
            (attempt_id,internal_request_id,job_id,capability_key,route_id,route_version,provider_key,provider_model_id,internal_model_key,attempt_number,state,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?, 'planned',NOW(),NOW())`,
          [nextAttemptId, job.danoa_request_id, job.id, job.capability_key, job.route_id, job.route_version, next.providerKey, next.providerModelId, next.modelKey, Number(attempt.attempt_number) + 1]
        );
        await connection.query("UPDATE app_video_generations SET status='queued',provider=?,provider_model_id_snapshot=?,model_key=?,provider_attempt_id=?,worker_lease_owner=NULL,worker_lease_until=NULL,safe_error_code=NULL,safe_error_message=NULL,updated_at=NOW() WHERE id=?", [next.providerKey, next.providerModelId, next.modelKey, nextAttemptId, job.id]);
        return { action: 'fallback-queued', providerKey: next.providerKey };
      }
      await noaBillingService.release(getNoaReservationId(job), {
        connection,
        reason: 'provider_rejected',
        actorType: 'system',
        actorId: 'video-worker',
        metadata: { generationId: job.id, errorCode }
      });
      await connection.query("UPDATE app_video_generations SET status='failed',safe_error_code=?,safe_error_message=?,failed_at=NOW(),worker_lease_owner=NULL,worker_lease_until=NULL,updated_at=NOW() WHERE id=?", [safeText(errorCode, 100), safeText(errorMessage, 500), job.id]);
      return { action: 'failed-rejected' };
    }),
    requeueSubmission: async ({ jobId, workerId, errorCode, maxRetries = 3, baseDelayMs = 5000, maxDelayMs = 60000 }) => inTransaction(async (connection) => {
      const job = await getLockedJob(connection, jobId);
      await ensureExpectedLease(job, workerId);
      const attempt = await getLockedAttempt(connection, job.provider_attempt_id);
      if (!['queued', 'routing', 'submitting'].includes(job.status) || !['planned', 'submitting'].includes(attempt.state)) throw new VideoWorkerRepositoryError('VIDEO_SUBMIT_STATE_CONFLICT');
      await connection.query("UPDATE app_ai_provider_attempts SET state='rejected',error_code=?,safe_error_summary='درخواست به دلیل محدودیت نرخ Provider برگشت خورد.',submit_finished_at=NOW(),updated_at=NOW() WHERE attempt_id=?", [safeText(errorCode, 100), attempt.attempt_id]);
      const nextAttemptNumber = Number(attempt.attempt_number) + 1;
      if (nextAttemptNumber > Number(maxRetries)) {
        await noaBillingService.release(getNoaReservationId(job), { connection, reason: 'max_retries_exhausted', actorType: 'system', actorId: 'video-worker', metadata: { generationId: job.id, errorCode } });
        await connection.query("UPDATE app_video_generations SET status='failed',safe_error_code=?,safe_error_message='بیشترین تلاش مجدد برای ارسال انجام شد.',failed_at=NOW(),worker_lease_owner=NULL,worker_lease_until=NULL,updated_at=NOW() WHERE id=?", [safeText(errorCode, 100), job.id]);
        return { exhausted: true, nextAttempt: nextAttemptNumber };
      }
      const delayMs = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, nextAttemptNumber - 1));
      const nextPollAt = new Date(Date.now() + delayMs);
      const nextAttemptId = require('crypto').randomUUID();
      await connection.query(
        `INSERT INTO app_ai_provider_attempts
          (attempt_id,internal_request_id,job_id,capability_key,route_id,route_version,provider_key,provider_model_id,internal_model_key,attempt_number,state,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?, 'planned',NOW(),NOW())`,
        [nextAttemptId, job.danoa_request_id, job.id, job.capability_key, job.route_id, job.route_version, job.provider, job.provider_model_id_snapshot, job.model_key, nextAttemptNumber]
      );
      await connection.query("UPDATE app_video_generations SET status='queued',provider_attempt_id=?,next_poll_at=?,worker_lease_owner=NULL,worker_lease_until=NULL,safe_error_code=NULL,safe_error_message=NULL,updated_at=NOW() WHERE id=?", [nextAttemptId, nextPollAt, job.id]);
      return { exhausted: false, nextAttempt: nextAttemptNumber, nextPollAt };
    }),
    claimExpiredJobs: async ({ workerId, leaseSeconds = 60, limit = 1 }) => {
      const owner = safeText(workerId, 191);
      const seconds = asPositiveInteger(leaseSeconds, 'leaseSeconds');
      const maximum = asPositiveInteger(limit, 'limit');
      if (!owner) throw new VideoWorkerRepositoryError('VIDEO_WORKER_OWNER_REQUIRED');
      return inTransaction(async (connection) => {
        const claimed = [];
        for (let index = 0; index < maximum; index += 1) {
          const [candidates] = await connection.query(
            `SELECT id FROM app_video_generations WHERE status IN ('submitted','processing','storing','provider_status_unknown') AND expires_at<=NOW() AND (worker_lease_until IS NULL OR worker_lease_until<=NOW())${claimProviderPredicate()} ORDER BY expires_at, created_at LIMIT 1 FOR UPDATE`,
            claimProviderParams()
          );
          if (!candidates[0]) break;
          const [updated] = await connection.query(
            `UPDATE app_video_generations SET worker_lease_owner=?, worker_lease_until=DATE_ADD(NOW(), INTERVAL ? SECOND), updated_at=NOW() WHERE id=? AND status IN ('submitted','processing','storing','provider_status_unknown') AND expires_at<=NOW() AND (worker_lease_until IS NULL OR worker_lease_until<=NOW())${claimProviderPredicate()}`,
            [owner, seconds, candidates[0].id, ...claimProviderParams()]
          );
          if (updated.affectedRows !== 1) continue;
          const [rows] = await connection.query('SELECT * FROM app_video_generations WHERE id=?', [candidates[0].id]);
          claimed.push(rows[0]);
        }
        return claimed;
      });
    },
    claimPollableJobs: async ({ workerId, leaseSeconds = 60, limit = 1 }) => {
      const owner = safeText(workerId, 191);
      const seconds = asPositiveInteger(leaseSeconds, 'leaseSeconds');
      const maximum = asPositiveInteger(limit, 'limit');
      if (!owner) throw new VideoWorkerRepositoryError('VIDEO_WORKER_OWNER_REQUIRED');
      return inTransaction(async (connection) => {
        const claimed = [];
        for (let index = 0; index < maximum; index += 1) {
          const [candidates] = await connection.query(
            `SELECT id FROM app_video_generations WHERE ((status IN ('submitted','processing') AND next_poll_at<=NOW()) OR (status='storing' AND next_storage_attempt_at<=NOW())) AND expires_at>NOW() AND (worker_lease_until IS NULL OR worker_lease_until<=NOW())${claimProviderPredicate()} ORDER BY COALESCE(next_storage_attempt_at,next_poll_at), created_at LIMIT 1 FOR UPDATE`,
            claimProviderParams()
          );
          if (!candidates[0]) break;
          const [updated] = await connection.query(
            `UPDATE app_video_generations SET worker_lease_owner=?, worker_lease_until=DATE_ADD(NOW(), INTERVAL ? SECOND), last_polled_at=IF(status IN ('submitted','processing'),NOW(),last_polled_at), poll_attempts=poll_attempts+IF(status IN ('submitted','processing'),1,0), updated_at=NOW() WHERE id=? AND ((status IN ('submitted','processing') AND next_poll_at<=NOW()) OR (status='storing' AND next_storage_attempt_at<=NOW())) AND expires_at>NOW() AND (worker_lease_until IS NULL OR worker_lease_until<=NOW())${claimProviderPredicate()}`,
            [owner, seconds, candidates[0].id, ...claimProviderParams()]
          );
          if (updated.affectedRows !== 1) continue;
          const [rows] = await connection.query('SELECT * FROM app_video_generations WHERE id=?', [candidates[0].id]);
          claimed.push(rows[0]);
        }
        return claimed;
      });
    },
    extendJobLease: async ({ jobId, workerId, leaseSeconds = 60 }) => {
      const seconds = asPositiveInteger(leaseSeconds, 'leaseSeconds');
      const [result] = await db.query(
        "UPDATE app_video_generations SET worker_lease_until=DATE_ADD(NOW(), INTERVAL ? SECOND), updated_at=NOW() WHERE id=? AND worker_lease_owner=? AND worker_lease_until>NOW() AND status IN ('submitted','processing','storing')",
        [seconds, jobId, safeText(workerId, 191)]
      );
      return result.affectedRows === 1;
    },
    releaseJobLease: async ({ jobId, workerId }) => {
      const [result] = await db.query(
        "UPDATE app_video_generations SET worker_lease_owner=NULL, worker_lease_until=NULL, updated_at=NOW() WHERE id=? AND worker_lease_owner=? AND status IN ('submitted','processing','storing')",
        [jobId, safeText(workerId, 191)]
      );
      return result.affectedRows === 1;
    },
    scheduleNextPoll: async ({ jobId, workerId, nextPollAt }) => {
      const [result] = await db.query(
        "UPDATE app_video_generations SET next_poll_at=?, worker_lease_owner=NULL, worker_lease_until=NULL, updated_at=NOW() WHERE id=? AND worker_lease_owner=? AND status IN ('submitted','processing')",
        [nextPollAt, jobId, safeText(workerId, 191)]
      );
      return result.affectedRows === 1;
    },
    finalizeSuccessfulJob,
    markJobStoring: async ({ jobId, workerId }) => {
      const [result] = await db.query("UPDATE app_video_generations SET status='storing', result_storage_status=COALESCE(result_storage_status,'pending'), next_storage_attempt_at=NOW(), worker_lease_owner=?, updated_at=NOW() WHERE id=? AND worker_lease_owner=? AND status IN ('submitted','processing')", [safeText(workerId, 191), jobId, safeText(workerId, 191)]);
      return result.affectedRows === 1;
    },
    recordStorageAttempt: async ({ jobId, workerId }) => { const [result] = await db.query("UPDATE app_video_generations SET storage_attempts=storage_attempts+1, updated_at=NOW() WHERE id=? AND status='storing' AND worker_lease_owner=?", [jobId, safeText(workerId, 191)]); return result.affectedRows === 1; },
    scheduleStorageRetry: async ({ jobId, workerId, nextStorageAttemptAt, errorCode }) => { const [result] = await db.query("UPDATE app_video_generations SET next_storage_attempt_at=?, storage_safe_error_code=?, storage_safe_error_message='دریافت نتیجه ویدیو موقتاً ناموفق بود.', worker_lease_owner=NULL, worker_lease_until=NULL, updated_at=NOW() WHERE id=? AND status='storing' AND worker_lease_owner=?", [nextStorageAttemptAt, safeText(errorCode, 100), jobId, safeText(workerId, 191)]); return result.affectedRows === 1; },
    finalizeStoredResult: async ({ jobId, workerId, storageKey, mimeType, sizeBytes, sha256, originalFilename }) => inTransaction(async (connection) => {
      const job = await getLockedJob(connection, jobId);
      if (job.status === JOB_STATUSES.SUCCEEDED) return { idempotent: true, jobId };
      await ensureExpectedLease(job, workerId);
      if (job.status !== JOB_STATUSES.STORING) throw new VideoWorkerRepositoryError('VIDEO_WORKER_STATE_CONFLICT');
      await injectFault('before_stored_metadata');
      await connection.query("UPDATE app_video_generations SET result_storage_key=?, result_mime_type=?, result_size_bytes=?, result_sha256=COALESCE(?,result_sha256), result_original_filename=?, result_storage_status='stored', result_stored_at=COALESCE(result_stored_at,NOW()), storage_safe_error_code=NULL, storage_safe_error_message=NULL WHERE id=?", [safeText(storageKey, 255), safeText(mimeType, 100), Number(sizeBytes), safeText(sha256, 64), safeText(originalFilename, 255), job.id]);
      await injectFault('after_stored_metadata');
      await injectFault('before_noa_capture');
      await noaBillingService.capture(getNoaReservationId(job), {
        connection,
        actorType: 'system',
        actorId: 'video-worker',
        metadata: { generationId: job.id, settlement: 'stored_result' }
      });
      await injectFault('after_noa_capture');
      await injectFault('before_lease_clear');
      const [jobResult] = await connection.query("UPDATE app_video_generations SET status='succeeded', completed_at=COALESCE(completed_at,NOW()), recovery_completed_at=CASE WHEN recovery_started_at IS NULL THEN recovery_completed_at ELSE COALESCE(recovery_completed_at,NOW()) END, worker_lease_owner=NULL, worker_lease_until=NULL, updated_at=NOW() WHERE id=? AND status='storing'", [job.id]); if (jobResult.affectedRows !== 1) throw new VideoWorkerRepositoryError('VIDEO_WORKER_JOB_STATE_CONFLICT'); return { idempotent: false, jobId };
    }),
    failStorageAndRelease: ({ jobId, workerId, errorCode }) => releaseJob({ jobId, workerId, terminalStatus: JOB_STATUSES.FAILED, errorCode, errorMessage: 'ذخیره امن نتیجه ویدیو ناموفق بود.', releaseReason: 'result_storage_failure' }),
    failAndReleaseJob: ({ jobId, workerId, errorCode, errorMessage, releaseReason = 'provider_failure' }) => releaseJob({
      jobId,
      workerId,
      terminalStatus: JOB_STATUSES.FAILED,
      errorCode,
      errorMessage,
      releaseReason
    }),
    expireAndReleaseJob: ({ jobId, workerId, releaseReason = 'job_expired', errorCode = null, errorMessage = null }) => releaseJob({
      jobId,
      workerId,
      terminalStatus: JOB_STATUSES.EXPIRED,
      errorCode,
      errorMessage,
      releaseReason
    }),
    recoverExpiredLeases: async () => {
      const [result] = await db.query(
        `UPDATE app_video_generations
         SET safe_error_code=IF(status='submitting','VIDEO_PROVIDER_STATUS_UNKNOWN',safe_error_code),
             safe_error_message=IF(status='submitting','وضعیت پذیرش درخواست Provider پس از انقضای Lease نامعلوم است.',safe_error_message),
             status=IF(status='submitting','provider_status_unknown',status),
             worker_lease_owner=NULL, worker_lease_until=NULL, updated_at=NOW()
         WHERE worker_lease_until<=NOW() AND status IN ('queued','routing','submitting','submitted','processing','storing')${claimProviderPredicate()}`,
        claimProviderParams()
      );
      await db.query("UPDATE app_ai_provider_attempts a JOIN app_video_generations g ON g.provider_attempt_id=a.attempt_id SET a.state='ambiguous',a.error_code='VIDEO_PROVIDER_STATUS_UNKNOWN',a.safe_error_summary='Lease در زمان Submit منقضی شد.',a.updated_at=NOW() WHERE g.status='provider_status_unknown' AND a.state='submitting'");
      return result.affectedRows;
    }
  };
}

module.exports = { createVideoWorkerRepository, VideoWorkerRepositoryError };
