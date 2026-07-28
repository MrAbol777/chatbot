'use strict';

async function reconcileExpiredNoaOperations(db) {
  if (!db || typeof db.query !== 'function') {
    throw new TypeError('Noa expiry reconciliation requires a database client');
  }

  const [attempts] = await db.query(
    `UPDATE app_chat_attempts AS attempt
     INNER JOIN app_chat_turns AS turn ON turn.turn_id = attempt.turn_id
     INNER JOIN app_noa_reservations AS reservation
       ON reservation.reservation_id = turn.noa_reservation_id
     SET attempt.status = 'failed',
         attempt.error_code = 'NOA_RESERVATION_EXPIRED',
         attempt.finished_at = COALESCE(attempt.finished_at, CURRENT_TIMESTAMP(6)),
         attempt.updated_at = CURRENT_TIMESTAMP(6)
     WHERE attempt.status = 'streaming'
       AND reservation.status = 'released'
       AND reservation.release_reason = 'reservation_expired'`
  );

  const [chatTurns] = await db.query(
    `UPDATE app_chat_turns AS turn
     INNER JOIN app_noa_reservations AS reservation
       ON reservation.reservation_id = turn.noa_reservation_id
     SET turn.status = 'failed',
         turn.error_code = 'NOA_RESERVATION_EXPIRED',
         turn.completed_at = NULL,
         turn.updated_at = CURRENT_TIMESTAMP(6)
     WHERE turn.status = 'streaming'
       AND reservation.status = 'released'
       AND reservation.release_reason = 'reservation_expired'`
  );

  const [images] = await db.query(
    `UPDATE image_generations AS image
     INNER JOIN app_noa_reservations AS reservation
       ON reservation.reservation_id = image.noa_reservation_id
     SET image.status = 'ERROR',
         image.error = 'NOA_RESERVATION_EXPIRED',
         image.updated_at = CURRENT_TIMESTAMP(6)
     WHERE image.status IN ('WAITING', 'QUEUE', 'RUNNING')
       AND reservation.status = 'released'
       AND reservation.release_reason = 'reservation_expired'`
  );

  const [videos] = await db.query(
    `UPDATE app_video_generations AS video
     INNER JOIN app_noa_reservations AS reservation
       ON reservation.reservation_id = video.noa_reservation_id
     SET video.status = 'expired',
         video.safe_error_code = 'NOA_RESERVATION_EXPIRED',
         video.safe_error_message = 'زمان انجام ساخت ویدیو به پایان رسید.',
         video.failed_at = COALESCE(video.failed_at, CURRENT_TIMESTAMP(6)),
         video.next_poll_at = NULL,
         video.worker_lease_until = NULL,
         video.updated_at = CURRENT_TIMESTAMP(6)
     WHERE video.status IN ('queued', 'submitted', 'processing')
       AND reservation.status = 'released'
       AND reservation.release_reason = 'reservation_expired'`
  );

  return {
    chatAttempts: Number(attempts?.affectedRows || 0),
    chatTurns: Number(chatTurns?.affectedRows || 0),
    images: Number(images?.affectedRows || 0),
    videos: Number(videos?.affectedRows || 0)
  };
}

module.exports = { reconcileExpiredNoaOperations };
