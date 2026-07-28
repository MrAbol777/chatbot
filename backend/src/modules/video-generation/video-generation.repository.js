const { randomUUID } = require('crypto');

function createVideoGenerationRepository(db, { noaBillingService } = {}) {
  if (!noaBillingService || typeof noaBillingService.reserve !== 'function') {
    throw new Error('NOA_BILLING_SERVICE_REQUIRED');
  }

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

  async function reserveNoa(connection, job, reservationInput) {
    const reservation = await noaBillingService.reserve(reservationInput, { connection });
    if (!reservation?.reservationId) {
      const error = new Error('Noa reservation was not created.');
      error.code = 'NOA_RESERVATION_INVALID';
      error.status = 500;
      throw error;
    }
    return reservation;
  }

  return {
    listModels: async () => (await db.query('SELECT * FROM app_video_models WHERE is_active = 1 ORDER BY sort_order, internal_key'))[0],
    getModel: async (key) => (await db.query('SELECT * FROM app_video_models WHERE internal_key = ? LIMIT 1', [key]))[0][0] || null,
    findIdempotent: async (userId, hash) => (await db.query('SELECT * FROM app_video_generations WHERE user_id = ? AND idempotency_hash = ? LIMIT 1', [userId, hash]))[0][0] || null,
    createWithReservation: async ({ job, reservationInput }) => inTransaction(async (connection) => {
      const reservation = await reserveNoa(connection, job, reservationInput);
      await connection.query(
        `INSERT INTO app_video_generations
          (id,user_id,mode,model_key,provider,provider_model_id_snapshot,status,prompt,negative_prompt,aspect_ratio,duration,quality,
           input_media_reference,noa_reservation_id,idempotency_hash,payload_hash,expires_at,next_poll_at,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          job.id, job.userId, job.mode, job.modelKey, job.provider, job.providerModelId, job.status, job.prompt,
          job.negativePrompt, job.aspectRatio, job.duration, job.quality, job.mediaId, reservation.reservationId,
          job.idempotencyHash, job.payloadHash, job.expiresAt, job.nextPollAt, job.now, job.now
        ]
      );
      return {
        ...job,
        noaReservationId: reservation.reservationId,
        noaReservation: reservation
      };
    }),
    createRoutedWithReservation: async ({ job, reservationInput }) => {
      const attemptId = randomUUID();
      return inTransaction(async (connection) => {
        if (job.mediaId) {
          const [mediaRows] = await connection.query("SELECT * FROM app_video_input_media WHERE id=? AND user_id=? AND status='ready' AND expires_at>NOW() FOR UPDATE", [job.mediaId, job.userId]);
          if (!mediaRows[0]) { const error = new Error('رسانه ورودی معتبر یا متعلق به این کاربر نیست.'); error.code = 'VIDEO_INPUT_MEDIA_INVALID'; error.status = 409; throw error; }
        }
        const reservation = await reserveNoa(connection, job, reservationInput);
        await connection.query(
          `INSERT INTO app_video_generations
            (id,danoa_request_id,user_id,mode,capability_key,route_id,route_version,route_snapshot,model_key,provider,provider_model_id_snapshot,status,
             prompt,user_prompt,compiled_prompt,compiled_prompt_hash,prompt_profile_id,prompt_profile_version_id,prompt_profile_key,prompt_profile_version,prompt_compiler_version,
             negative_prompt,aspect_ratio,duration,quality,resolution,generate_audio,input_media_reference,input_media_id,provider_attempt_id,
             noa_reservation_id,idempotency_hash,payload_hash,expires_at,next_poll_at,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?)`,
          [job.id, job.danoaRequestId, job.userId, job.mode, job.capability, job.routeId, job.routeVersion, JSON.stringify(job.routeSnapshot), job.modelKey,
            job.provider, job.providerModelId, 'queued', job.prompt, job.userPrompt, job.compiledPrompt, job.compiledPromptHash, job.promptProfileId,
            job.promptProfileVersionId, job.promptProfileKey, job.promptProfileVersion, job.promptCompilerVersion, job.negativePrompt, job.aspectRatio, job.duration, job.quality || '', job.resolution,
            Number(job.generateAudio), job.mediaId, job.mediaId, attemptId, reservation.reservationId, job.idempotencyHash, job.payloadHash,
            job.expiresAt, job.nextPollAt, job.now, job.now]
        );
        await connection.query(
          `INSERT INTO app_ai_provider_attempts
            (attempt_id,internal_request_id,job_id,capability_key,route_id,route_version,provider_key,provider_model_id,internal_model_key,attempt_number,state,estimated_cost,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?, 'planned',?,NOW(),NOW())`,
          [attemptId, job.danoaRequestId, job.id, job.capability, job.routeId, job.routeVersion, job.provider, job.providerModelId, job.modelKey, 1, job.estimatedCost]
        );
        if (job.mediaId) await connection.query("UPDATE app_video_input_media SET status='bound',bound_generation_id=?,updated_at=NOW() WHERE id=? AND user_id=? AND status='ready'", [job.id, job.mediaId, job.userId]);
        return {
          ...job,
          status: 'queued',
          noaReservationId: reservation.reservationId,
          noaReservation: reservation,
          attemptId
        };
      });
    },
    updateSubmission: async (id, providerJobId) => db.query('UPDATE app_video_generations SET provider_job_id=?, status=?, submitted_at=NOW(), updated_at=NOW() WHERE id=?', [providerJobId, 'submitted', id]),
    markSubmitFailed: async (id, errorCode, errorMessage) => db.query("UPDATE app_video_generations SET status='failed', safe_error_code=?, safe_error_message=?, failed_at=NOW(), updated_at=NOW() WHERE id=? AND status='queued'", [errorCode, errorMessage, id]),
    markSubmitFailedAndRelease: async ({ id, errorCode, errorMessage, reason = 'provider_submit_failed' }) => inTransaction(async (connection) => {
      const [rows] = await connection.query('SELECT * FROM app_video_generations WHERE id=? FOR UPDATE', [id]);
      const job = rows[0];
      if (!job) return false;
      if (job.status === 'failed') return true;
      if (job.status !== 'queued' || !job.noa_reservation_id) {
        const error = new Error('Video generation cannot be failed from its current state.');
        error.code = 'VIDEO_GENERATION_STATE_CONFLICT';
        error.status = 409;
        throw error;
      }
      await noaBillingService.release(job.noa_reservation_id, {
        connection,
        reason,
        actorType: 'system',
        actorId: 'video-submit',
        metadata: { generationId: id, errorCode }
      });
      const [result] = await connection.query(
        "UPDATE app_video_generations SET status='failed', safe_error_code=?, safe_error_message=?, failed_at=NOW(), updated_at=NOW() WHERE id=? AND status='queued'",
        [errorCode, errorMessage, id]
      );
      if (result.affectedRows !== 1) {
        const error = new Error('Video generation state changed while releasing funds.');
        error.code = 'VIDEO_GENERATION_STATE_CONFLICT';
        error.status = 409;
        throw error;
      }
      return true;
    }),
    listForUser: async (userId) => (await db.query('SELECT id,mode,model_key,status,aspect_ratio,duration,quality,result_mime_type,result_size_bytes,safe_error_code,safe_error_message,created_at,updated_at,completed_at FROM app_video_generations WHERE user_id=? ORDER BY created_at DESC LIMIT 50', [userId]))[0],
    getForUser: async (id, userId) => (await db.query('SELECT * FROM app_video_generations WHERE id=? AND user_id=? LIMIT 1', [id,userId]))[0][0] || null,
    getById: async (id) => (await db.query('SELECT * FROM app_video_generations WHERE id=? LIMIT 1', [id]))[0][0] || null
  };
}
module.exports = { createVideoGenerationRepository };
