'use strict';

function createVideoInputMediaRepository(db) {
  return {
    create: async (media) => db.query(
      `INSERT INTO app_video_input_media
        (id,user_id,storage_key,original_filename,mime_type,size_bytes,sha256,status,expires_at,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,'ready',?,NOW(),NOW())`,
      [media.id, media.userId, media.storageKey, media.originalFilename, media.mimeType, media.sizeBytes, media.sha256, media.expiresAt]
    ),
    getForProvider: async ({ mediaId, jobId, attemptId }) => {
      const [rows] = await db.query(
        `SELECT m.* FROM app_video_input_media m
         JOIN app_video_generations g ON g.input_media_id=m.id
         JOIN app_ai_provider_attempts a ON a.attempt_id=g.provider_attempt_id AND a.job_id=g.id
         WHERE m.id=? AND g.id=? AND a.attempt_id=? AND m.status='bound' AND m.expires_at>NOW()
         LIMIT 1`,
        [mediaId, jobId, attemptId]
      );
      return rows[0] || null;
    },
    getForSubmissionUpload: async ({ mediaId, jobId, attemptId, userId }) => {
      const [rows] = await db.query(
        `SELECT m.* FROM app_video_input_media m
         JOIN app_video_generations g ON g.input_media_id=m.id
         JOIN app_ai_provider_attempts a ON a.attempt_id=g.provider_attempt_id AND a.job_id=g.id
         WHERE m.id=? AND g.id=? AND a.attempt_id=? AND m.user_id=?
           AND m.status='bound' AND m.expires_at>NOW()
           AND g.status IN ('queued','routing','submitting')
           AND a.state IN ('planned','submitting')
         LIMIT 1`,
        [mediaId, jobId, attemptId, userId]
      );
      return rows[0] || null;
    }
  };
}

module.exports = { createVideoInputMediaRepository };
