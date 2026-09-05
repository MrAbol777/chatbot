'use strict';

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createImageCapacityGuard({
  db,
  maxActive = 6,
  maxActivePerUser = 2
}) {
  const globalLimit = positiveInteger(maxActive, 6);
  const perUserLimit = positiveInteger(maxActivePerUser, 2);

  if (!db || typeof db.query !== 'function') {
    throw new Error('Image capacity guard requires a database');
  }

  return async (req, res, next) => {
    try {
      const userId = typeof req.user?.id === 'string' || typeof req.user?.id === 'number'
        ? String(req.user.id).trim()
        : '';
      if (!userId) return res.status(401).json({ error: 'AUTHENTICATION_REQUIRED' });

      const idempotencyKey = typeof req.headers?.['idempotency-key'] === 'string'
        ? req.headers['idempotency-key'].trim().slice(0, 191)
        : '';
      if (idempotencyKey.length >= 8) {
        const [existing] = await db.query(
          `SELECT id FROM image_generations
           WHERE user_id = ? AND idempotency_key = ? AND deleted_at IS NULL
           LIMIT 1`,
          [userId, idempotencyKey]
        );
        if (existing?.[0]) {
          res.locals = res.locals || {};
          res.locals.imageIdempotentReplay = true;
          return next();
        }
      }

      const [rows] = await db.query(
        `SELECT
           COUNT(*) AS total_active,
           SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS user_active
         FROM image_generations
         WHERE deleted_at IS NULL
           AND status IN ('WAITING', 'QUEUE', 'RUNNING')`,
        [userId]
      );
      const totalActive = Number(rows?.[0]?.total_active || 0);
      const userActive = Number(rows?.[0]?.user_active || 0);

      if (totalActive >= globalLimit || userActive >= perUserLimit) {
        res.setHeader('Retry-After', '5');
        return res.status(429).json({
          success: false,
          error: 'IMAGE_CAPACITY_REACHED',
          message: 'چند تصویر هنوز در حال پردازش است. بعد از تمام‌شدن یکی از آن‌ها دوباره تلاش کن.'
        });
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { createImageCapacityGuard, positiveInteger };
