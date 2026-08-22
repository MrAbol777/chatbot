'use strict';

function parseJson(value, fallback) { try { return typeof value === 'string' ? JSON.parse(value) : (value || fallback); } catch (_) { return fallback; } }

function createImageToImageRepository(db, { noaBillingService }) {
  if (!db || !noaBillingService) throw new Error('IMAGE_TO_IMAGE_REPOSITORY_DEPENDENCIES_REQUIRED');
  const inTransaction = async (work) => {
    const connection = await db.getConnection();
    try { await connection.beginTransaction(); const result = await work(connection); await connection.commit(); return result; }
    catch (error) { try { await connection.rollback(); } catch (_) {} throw error; }
    finally { connection.release(); }
  };
  const getLocked = async (connection, id) => {
    const [rows] = await connection.query('SELECT * FROM app_image_to_image_jobs WHERE id=? FOR UPDATE', [id]);
    if (!rows[0]) throw new Error('IMAGE_TO_IMAGE_JOB_NOT_FOUND');
    return rows[0];
  };
  const dto = (row) => row && ({ ...row, sources: parseJson(row.sources, []) });
  return {
    async createWithReservation({ job, reservationInput }) {
      return inTransaction(async (connection) => {
        const reservation = await noaBillingService.reserve(reservationInput, { connection });
        await connection.query(
          `INSERT INTO app_image_to_image_jobs
           (id,user_id,status,provider,model,prompt,aspect_ratio,sources,idempotency_key_hash,payload_hash,noa_reservation_id,expires_at,next_poll_at,created_at,updated_at)
           VALUES (?,?, 'queued',?,?,?,?,?,?,?, ?, ?,NOW(),NOW(),NOW())`,
          [job.id, job.userId, job.provider, job.model, job.prompt, job.aspectRatio, JSON.stringify(job.sources), job.idempotencyHash, job.payloadHash, reservation.reservationId, job.expiresAt]
        );
        return this.getForUser(job.id, job.userId, connection);
      });
    },
    async findIdempotent(userId, hash) {
      const [rows] = await db.query('SELECT * FROM app_image_to_image_jobs WHERE user_id=? AND idempotency_key_hash=? LIMIT 1', [userId, hash]);
      return dto(rows[0]);
    },
    async getForUser(id, userId, connection = null) {
      const target = connection || db;
      const [rows] = await target.query('SELECT * FROM app_image_to_image_jobs WHERE id=? AND user_id=? LIMIT 1', [id, userId]);
      return dto(rows[0]);
    },
    async listForUser(userId) {
      const [rows] = await db.query('SELECT * FROM app_image_to_image_jobs WHERE user_id=? ORDER BY created_at DESC LIMIT 100', [userId]);
      return rows.map(dto);
    },
    async claimDue({ workerId, leaseSeconds }) {
      return inTransaction(async (connection) => {
        const [candidates] = await connection.query(
          `SELECT id FROM app_image_to_image_jobs
           WHERE status IN ('queued','submitted') AND expires_at>NOW() AND next_poll_at<=NOW()
             AND (worker_lease_until IS NULL OR worker_lease_until<=NOW())
           ORDER BY created_at LIMIT 1 FOR UPDATE`
        );
        if (!candidates[0]) return null;
        const [updated] = await connection.query(
          `UPDATE app_image_to_image_jobs SET worker_lease_owner=?,worker_lease_until=DATE_ADD(NOW(), INTERVAL ? SECOND),updated_at=NOW()
           WHERE id=? AND (worker_lease_until IS NULL OR worker_lease_until<=NOW())`,
          [workerId, leaseSeconds, candidates[0].id]
        );
        if (updated.affectedRows !== 1) return null;
        return dto(await getLocked(connection, candidates[0].id));
      });
    },
    async markSubmitted({ jobId, workerId, providerTaskId }) {
      return inTransaction(async (connection) => {
        const job = await getLocked(connection, jobId);
        if (job.status !== 'queued' || job.worker_lease_owner !== workerId) throw new Error('IMAGE_TO_IMAGE_SUBMISSION_STATE_CONFLICT');
        await connection.query(
          `UPDATE app_image_to_image_jobs SET status='submitted',provider_task_id=?,submitted_at=NOW(),next_poll_at=NOW(),worker_lease_owner=NULL,worker_lease_until=NULL,updated_at=NOW() WHERE id=?`,
          [providerTaskId, jobId]
        );
      });
    },
    async deferPoll({ jobId, workerId, delaySeconds }) {
      return inTransaction(async (connection) => {
        const job = await getLocked(connection, jobId);
        if (job.status !== 'submitted' || job.worker_lease_owner !== workerId) throw new Error('IMAGE_TO_IMAGE_POLL_STATE_CONFLICT');
        await connection.query(
          `UPDATE app_image_to_image_jobs SET poll_attempts=poll_attempts+1,next_poll_at=DATE_ADD(NOW(), INTERVAL ? SECOND),worker_lease_owner=NULL,worker_lease_until=NULL,updated_at=NOW() WHERE id=?`,
          [delaySeconds, jobId]
        );
      });
    },
    async complete({ jobId, workerId, result }) {
      return inTransaction(async (connection) => {
        const job = await getLocked(connection, jobId);
        if (job.status !== 'submitted' || job.worker_lease_owner !== workerId) throw new Error('IMAGE_TO_IMAGE_COMPLETE_STATE_CONFLICT');
        await noaBillingService.capture(job.noa_reservation_id, { connection, actorType: 'system', actorId: 'image-to-image-worker', metadata: { jobId } });
        await connection.query(
          `UPDATE app_image_to_image_jobs SET status='succeeded',result_storage_key=?,result_mime_type=?,result_size_bytes=?,completed_at=NOW(),worker_lease_owner=NULL,worker_lease_until=NULL,updated_at=NOW() WHERE id=?`,
          [result.key, result.mimeType, result.sizeBytes, jobId]
        );
      });
    },
    async fail({ jobId, workerId, errorCode, errorMessage }) {
      return inTransaction(async (connection) => {
        const job = await getLocked(connection, jobId);
        if (!['queued', 'submitted'].includes(job.status) || job.worker_lease_owner !== workerId) throw new Error('IMAGE_TO_IMAGE_FAIL_STATE_CONFLICT');
        await noaBillingService.release(job.noa_reservation_id, { connection, reason: 'provider_failure', actorType: 'system', actorId: 'image-to-image-worker', metadata: { jobId, errorCode } });
        await connection.query(
          `UPDATE app_image_to_image_jobs SET status='failed',safe_error_code=?,safe_error_message=?,failed_at=NOW(),worker_lease_owner=NULL,worker_lease_until=NULL,updated_at=NOW() WHERE id=?`,
          [String(errorCode || 'IMAGE_TO_IMAGE_FAILED').slice(0, 100), String(errorMessage || 'ویرایش تصویر انجام نشد.').slice(0, 500), jobId]
        );
      });
    }
  };
}

module.exports = { createImageToImageRepository };
