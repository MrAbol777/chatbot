function createVideoGenerationRepository(db) {
  return {
    listModels: async () => (await db.query('SELECT * FROM app_video_models WHERE is_active = 1 ORDER BY sort_order, internal_key'))[0],
    getModel: async (key) => (await db.query('SELECT * FROM app_video_models WHERE internal_key = ? LIMIT 1', [key]))[0][0] || null,
    findIdempotent: async (userId, hash) => (await db.query('SELECT * FROM app_video_generations WHERE user_id = ? AND idempotency_hash = ? LIMIT 1', [userId, hash]))[0][0] || null,
    create: async (job, connection = db) => connection.query('INSERT INTO app_video_generations (id,user_id,mode,model_key,provider,provider_model_id_snapshot,status,prompt,negative_prompt,aspect_ratio,duration,quality,input_media_reference,quota_units,quota_reservation_id,idempotency_hash,payload_hash,expires_at,next_poll_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [job.id,job.userId,job.mode,job.modelKey,job.provider,job.providerModelId,job.status,job.prompt,job.negativePrompt,job.aspectRatio,job.duration,job.quality,job.mediaId,job.quotaUnits,job.reservationId || null,job.idempotencyHash,job.payloadHash,job.expiresAt,job.nextPollAt,job.now,job.now]),
    attachReservation: async (id, reservationId) => db.query("UPDATE app_video_generations SET quota_reservation_id=?, status='queued', updated_at=NOW() WHERE id=? AND quota_reservation_id IS NULL", [reservationId, id]),
    updateSubmission: async (id, providerJobId) => db.query('UPDATE app_video_generations SET provider_job_id=?, status=?, submitted_at=NOW(), updated_at=NOW() WHERE id=?', [providerJobId, 'submitted', id]),
    markSubmitFailed: async (id, errorCode, errorMessage) => db.query("UPDATE app_video_generations SET status='failed', safe_error_code=?, safe_error_message=?, failed_at=NOW(), updated_at=NOW() WHERE id=? AND status='queued'", [errorCode, errorMessage, id]),
    listForUser: async (userId) => (await db.query('SELECT id,mode,model_key,status,aspect_ratio,duration,quality,result_mime_type,result_size_bytes,safe_error_code,safe_error_message,created_at,updated_at,completed_at FROM app_video_generations WHERE user_id=? ORDER BY created_at DESC LIMIT 50', [userId]))[0],
    getForUser: async (id, userId) => (await db.query('SELECT * FROM app_video_generations WHERE id=? AND user_id=? LIMIT 1', [id,userId]))[0][0] || null,
    getById: async (id) => (await db.query('SELECT * FROM app_video_generations WHERE id=? LIMIT 1', [id]))[0][0] || null
  };
}
module.exports = { createVideoGenerationRepository };
