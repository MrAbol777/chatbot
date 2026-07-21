const {
  JOB_STATUSES,
  RESERVATION_STATUSES,
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
    throw new VideoWorkerRepositoryError('VIDEO_WORKER_QUOTA_INVALID', `${field} must be a positive integer.`);
  }
  return number;
};

function createVideoWorkerRepository(db, { faultInjector, claimProvider = null } = {}) {
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

  async function getLockedReservationAndUsage(connection, job) {
    const [reservations] = await connection.query('SELECT * FROM app_video_quota_reservations WHERE id=? FOR UPDATE', [job.quota_reservation_id]);
    const reservation = reservations[0];
    if (!reservation) throw new VideoWorkerRepositoryError('VIDEO_WORKER_RESERVATION_NOT_FOUND');
    const quotaUnits = asPositiveInteger(job.quota_units, 'job quota_units');
    if (
      reservation.generation_id !== job.id ||
      reservation.user_id !== job.user_id ||
      reservation.quota_units !== quotaUnits
    ) {
      throw new VideoWorkerRepositoryError('VIDEO_WORKER_RESERVATION_MISMATCH');
    }
    const [usageRows] = await connection.query(
      'SELECT * FROM app_video_usage WHERE user_id=? AND period_key=? FOR UPDATE',
      [reservation.user_id, reservation.period_key]
    );
    const usage = usageRows[0];
    if (!usage || usage.user_id !== job.user_id || Number(usage.video_reserved) < 0 || Number(usage.video_used) < 0) {
      throw new VideoWorkerRepositoryError('VIDEO_WORKER_USAGE_INCONSISTENT');
    }
    return { reservation, usage, quotaUnits };
  }

  function claimProviderPredicate() {
    if (scopedProvider) return ' AND provider=?';
    return testProviderGuard ? " AND provider IN ('fake','test')" : '';
  }

  function claimProviderParams() {
    return scopedProvider ? [scopedProvider] : [];
  }

  async function debitReservation(connection, usage, quotaUnits) {
    const [result] = await connection.query(
      'UPDATE app_video_usage SET video_reserved=video_reserved-?, updated_at=NOW() WHERE user_id=? AND period_key=? AND video_reserved>=?',
      [quotaUnits, usage.user_id, usage.period_key, quotaUnits]
    );
    if (result.affectedRows !== 1) throw new VideoWorkerRepositoryError('VIDEO_WORKER_RESERVED_QUOTA_INCONSISTENT');
    await injectFault('after_reserved_decrement');
  }

  async function ensureExpectedLease(job, workerId) {
    if (!workerId) return;
    if (job.worker_lease_owner !== workerId || !job.worker_lease_until || new Date(job.worker_lease_until) <= new Date()) {
      throw new VideoWorkerRepositoryError('VIDEO_WORKER_LEASE_NOT_OWNED');
    }
  }

  async function finalizeSuccessfulJob({ jobId, workerId }) {
    return inTransaction(async (connection) => {
      const job = await getLockedJob(connection, jobId);
      await ensureExpectedLease(job, workerId);
      const { reservation, usage, quotaUnits } = await getLockedReservationAndUsage(connection, job);
      if (job.status === JOB_STATUSES.SUCCEEDED && reservation.status === RESERVATION_STATUSES.FINALIZED) {
        return { idempotent: true, jobId };
      }
      // Only legacy Fake-provider fixtures can settle without a storage
      // pipeline. Real providers can reach succeeded solely from `storing`.
      const legacyFakeFixture = process.env.NODE_ENV === 'test'
        && ['fake', 'test'].includes(String(job.provider || ''))
        && ['submitted', 'processing'].includes(job.status);
      if (isTerminalJobStatus(job.status) || reservation.status !== RESERVATION_STATUSES.RESERVED || (!canTransitionJob(job.status, JOB_STATUSES.SUCCEEDED) && !legacyFakeFixture)) {
        throw new VideoWorkerRepositoryError('VIDEO_WORKER_STATE_CONFLICT');
      }
      await debitReservation(connection, usage, quotaUnits);
      await injectFault('before_used_increment');
      const [usageResult] = await connection.query(
        'UPDATE app_video_usage SET video_used=video_used+?, updated_at=NOW() WHERE user_id=? AND period_key=? AND video_used>=0',
        [quotaUnits, usage.user_id, usage.period_key]
      );
      if (usageResult.affectedRows !== 1) throw new VideoWorkerRepositoryError('VIDEO_WORKER_USED_QUOTA_INCONSISTENT');
      await injectFault('after_used_increment');
      await injectFault('before_reservation_change');
      const [reservationResult] = await connection.query(
        "UPDATE app_video_quota_reservations SET status='finalized', finalized_at=COALESCE(finalized_at,NOW()), updated_at=NOW() WHERE id=? AND status='reserved'",
        [reservation.id]
      );
      if (reservationResult.affectedRows !== 1) throw new VideoWorkerRepositoryError('VIDEO_WORKER_RESERVATION_STATE_CONFLICT');
      await injectFault('before_job_change');
      const [jobResult] = await connection.query(
        "UPDATE app_video_generations SET status='succeeded', completed_at=COALESCE(completed_at,NOW()), worker_lease_owner=NULL, worker_lease_until=NULL, updated_at=NOW() WHERE id=? AND status IN ('submitted','processing','storing')",
        [job.id]
      );
      if (jobResult.affectedRows !== 1) throw new VideoWorkerRepositoryError('VIDEO_WORKER_JOB_STATE_CONFLICT');
      return { idempotent: false, jobId };
    });
  }

  async function releaseJob({ jobId, workerId, terminalStatus, reservationStatus, errorCode = null, errorMessage = null, releaseReason = null }) {
    return inTransaction(async (connection) => {
      const job = await getLockedJob(connection, jobId);
      await ensureExpectedLease(job, workerId);
      const { reservation, usage, quotaUnits } = await getLockedReservationAndUsage(connection, job);
      if (job.status === terminalStatus && reservation.status === reservationStatus) {
        return { idempotent: true, jobId };
      }
      if (isTerminalJobStatus(job.status) || reservation.status !== RESERVATION_STATUSES.RESERVED || !canTransitionJob(job.status, terminalStatus)) {
        throw new VideoWorkerRepositoryError('VIDEO_WORKER_STATE_CONFLICT');
      }
      await debitReservation(connection, usage, quotaUnits);
      const reservationSql = reservationStatus === RESERVATION_STATUSES.EXPIRED
        ? "UPDATE app_video_quota_reservations SET status='expired', expired_at=COALESCE(expired_at,NOW()), release_reason=?, updated_at=NOW() WHERE id=? AND status='reserved'"
        : "UPDATE app_video_quota_reservations SET status='released', released_at=COALESCE(released_at,NOW()), release_reason=?, updated_at=NOW() WHERE id=? AND status='reserved'";
      await injectFault('before_reservation_change');
      const [reservationResult] = await connection.query(reservationSql, [safeText(releaseReason, 100), reservation.id]);
      if (reservationResult.affectedRows !== 1) throw new VideoWorkerRepositoryError('VIDEO_WORKER_RESERVATION_STATE_CONFLICT');
      await injectFault('before_job_change');
      const jobSql = terminalStatus === JOB_STATUSES.EXPIRED
        ? "UPDATE app_video_generations SET status='expired', expired_at=COALESCE(expired_at,NOW()), safe_error_code=?, safe_error_message=?, worker_lease_owner=NULL, worker_lease_until=NULL, updated_at=NOW() WHERE id=? AND status IN ('submitted','processing','storing')"
        : "UPDATE app_video_generations SET status='failed', failed_at=COALESCE(failed_at,NOW()), safe_error_code=?, safe_error_message=?, worker_lease_owner=NULL, worker_lease_until=NULL, updated_at=NOW() WHERE id=? AND status IN ('submitted','processing','storing')";
      const params = terminalStatus === JOB_STATUSES.EXPIRED
        ? [safeText(errorCode, 100), safeText(errorMessage, 500), job.id]
        : [safeText(errorCode, 100), safeText(errorMessage, 500), job.id];
      const [jobResult] = await connection.query(jobSql, params);
      if (jobResult.affectedRows !== 1) throw new VideoWorkerRepositoryError('VIDEO_WORKER_JOB_STATE_CONFLICT');
      return { idempotent: false, jobId };
    });
  }

  return {
    claimExpiredJobs: async ({ workerId, leaseSeconds = 60, limit = 1 }) => {
      const owner = safeText(workerId, 191);
      const seconds = asPositiveInteger(leaseSeconds, 'leaseSeconds');
      const maximum = asPositiveInteger(limit, 'limit');
      if (!owner) throw new VideoWorkerRepositoryError('VIDEO_WORKER_OWNER_REQUIRED');
      return inTransaction(async (connection) => {
        const claimed = [];
        for (let index = 0; index < maximum; index += 1) {
          const [candidates] = await connection.query(
            `SELECT id FROM app_video_generations WHERE status IN ('submitted','processing','storing') AND expires_at<=NOW() AND (worker_lease_until IS NULL OR worker_lease_until<=NOW())${claimProviderPredicate()} ORDER BY expires_at, created_at LIMIT 1 FOR UPDATE`,
            claimProviderParams()
          );
          if (!candidates[0]) break;
          const [updated] = await connection.query(
            `UPDATE app_video_generations SET worker_lease_owner=?, worker_lease_until=DATE_ADD(NOW(), INTERVAL ? SECOND), updated_at=NOW() WHERE id=? AND status IN ('submitted','processing','storing') AND expires_at<=NOW() AND (worker_lease_until IS NULL OR worker_lease_until<=NOW())${claimProviderPredicate()}`,
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
      const job = await getLockedJob(connection, jobId); await ensureExpectedLease(job, workerId); const { reservation, usage, quotaUnits } = await getLockedReservationAndUsage(connection, job);
      if (job.status === JOB_STATUSES.SUCCEEDED && reservation.status === RESERVATION_STATUSES.FINALIZED) return { idempotent: true, jobId };
      if (job.status !== JOB_STATUSES.STORING || reservation.status !== RESERVATION_STATUSES.RESERVED) throw new VideoWorkerRepositoryError('VIDEO_WORKER_STATE_CONFLICT');
      await injectFault('before_stored_metadata');
      await connection.query("UPDATE app_video_generations SET result_storage_key=?, result_mime_type=?, result_size_bytes=?, result_sha256=COALESCE(?,result_sha256), result_original_filename=?, result_storage_status='stored', result_stored_at=COALESCE(result_stored_at,NOW()), storage_safe_error_code=NULL, storage_safe_error_message=NULL WHERE id=?", [safeText(storageKey, 255), safeText(mimeType, 100), Number(sizeBytes), safeText(sha256, 64), safeText(originalFilename, 255), job.id]);
      await injectFault('after_stored_metadata');
      await debitReservation(connection, usage, quotaUnits); const [usageResult] = await connection.query('UPDATE app_video_usage SET video_used=video_used+?, updated_at=NOW() WHERE user_id=? AND period_key=? AND video_used>=0', [quotaUnits, usage.user_id, usage.period_key]); if (usageResult.affectedRows !== 1) throw new VideoWorkerRepositoryError('VIDEO_WORKER_USED_QUOTA_INCONSISTENT');
      await injectFault('before_quota_finalize');
      const [reservationResult] = await connection.query("UPDATE app_video_quota_reservations SET status='finalized', finalized_at=COALESCE(finalized_at,NOW()), updated_at=NOW() WHERE id=? AND status='reserved'", [reservation.id]); if (reservationResult.affectedRows !== 1) throw new VideoWorkerRepositoryError('VIDEO_WORKER_RESERVATION_STATE_CONFLICT');
      await injectFault('after_quota_finalize');
      await injectFault('before_lease_clear');
      const [jobResult] = await connection.query("UPDATE app_video_generations SET status='succeeded', completed_at=COALESCE(completed_at,NOW()), recovery_completed_at=CASE WHEN recovery_started_at IS NULL THEN recovery_completed_at ELSE COALESCE(recovery_completed_at,NOW()) END, worker_lease_owner=NULL, worker_lease_until=NULL, updated_at=NOW() WHERE id=? AND status='storing'", [job.id]); if (jobResult.affectedRows !== 1) throw new VideoWorkerRepositoryError('VIDEO_WORKER_JOB_STATE_CONFLICT'); return { idempotent: false, jobId };
    }),
    failStorageAndRelease: ({ jobId, workerId, errorCode }) => releaseJob({ jobId, workerId, terminalStatus: JOB_STATUSES.FAILED, reservationStatus: RESERVATION_STATUSES.RELEASED, errorCode, errorMessage: 'ذخیره امن نتیجه ویدیو ناموفق بود.', releaseReason: 'result_storage_failure' }),
    failAndReleaseJob: ({ jobId, workerId, errorCode, errorMessage, releaseReason = 'provider_failure' }) => releaseJob({
      jobId,
      workerId,
      terminalStatus: JOB_STATUSES.FAILED,
      reservationStatus: RESERVATION_STATUSES.RELEASED,
      errorCode,
      errorMessage,
      releaseReason
    }),
    expireAndReleaseJob: ({ jobId, workerId, releaseReason = 'job_expired', errorCode = null, errorMessage = null }) => releaseJob({
      jobId,
      workerId,
      terminalStatus: JOB_STATUSES.EXPIRED,
      reservationStatus: RESERVATION_STATUSES.EXPIRED,
      errorCode,
      errorMessage,
      releaseReason
    }),
    recoverExpiredLeases: async () => {
      const [result] = await db.query(
        `UPDATE app_video_generations SET worker_lease_owner=NULL, worker_lease_until=NULL, updated_at=NOW() WHERE worker_lease_until<=NOW() AND status IN ('submitted','processing','storing')${claimProviderPredicate()}`,
        claimProviderParams()
      );
      return result.affectedRows;
    }
  };
}

module.exports = { createVideoWorkerRepository, VideoWorkerRepositoryError };
