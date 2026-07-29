'use strict';

const express = require('express');

const VIDEO_STATUSES = new Set([
  'queued',
  'routing',
  'submitting',
  'submitted',
  'processing',
  'storing',
  'provider_status_unknown',
  'succeeded',
  'failed',
  'cancelled',
  'expired'
]);

const toNumber = (value) => (value == null || value === '' ? null : Number(value));
const toIsoValue = (value) => value || null;

function listDto(row) {
  const hasInput = Boolean(row.joined_input_media_id);
  const hasResult = row.status === 'succeeded' && Boolean(row.result_storage_key);
  return {
    id: String(row.id),
    userId: String(row.user_id),
    user: {
      name: row.user_name || 'کاربر',
      phone: row.user_phone || null,
      age: row.user_age == null ? null : Number(row.user_age)
    },
    status: row.status,
    mode: row.mode,
    prompt: row.user_prompt || row.prompt || '',
    provider: row.provider || null,
    model: row.model_key || row.provider_model_id_snapshot || null,
    aspectRatio: row.aspect_ratio || null,
    duration: row.duration == null ? null : String(row.duration),
    resolution: row.resolution || null,
    hasInput,
    inputImageUrl: hasInput
      ? `/api/admin/video-generations/${encodeURIComponent(String(row.id))}/input`
      : null,
    hasResult,
    resultContentUrl: hasResult
      ? `/api/video-generations/${encodeURIComponent(String(row.id))}/content`
      : null,
    resultMimeType: row.result_mime_type || null,
    resultSizeBytes: toNumber(row.result_size_bytes),
    createdAt: toIsoValue(row.created_at),
    updatedAt: toIsoValue(row.updated_at),
    completedAt: toIsoValue(row.completed_at)
  };
}

function detailDto(row) {
  const item = listDto(row);
  return {
    ...item,
    internalRequestId: row.danoa_request_id || null,
    prompts: {
      user: row.user_prompt || row.prompt || '',
      compiled: row.compiled_prompt || row.prompt || '',
      negative: row.negative_prompt || null,
      compiledHash: row.compiled_prompt_hash || null
    },
    settings: {
      mode: row.mode,
      aspectRatio: row.aspect_ratio || null,
      duration: row.duration == null ? null : String(row.duration),
      quality: row.quality || null,
      resolution: row.resolution || null,
      generateAudio: Boolean(row.generate_audio)
    },
    routing: {
      capability: row.capability_key || null,
      routeId: row.route_id || null,
      routeVersion: toNumber(row.route_version),
      provider: row.provider || null,
      model: row.model_key || null,
      providerModel: row.provider_model_id_snapshot || null,
      attemptState: row.attempt_state || null
    },
    promptProfile: {
      key: row.prompt_profile_key || null,
      version: toNumber(row.prompt_profile_version),
      compilerVersion: row.prompt_compiler_version || null
    },
    input: item.hasInput ? {
      url: item.inputImageUrl,
      mediaId: row.joined_input_media_id || null,
      filename: row.input_original_filename || null,
      mimeType: row.input_mime_type || null,
      sizeBytes: toNumber(row.input_size_bytes),
      createdAt: toIsoValue(row.input_created_at)
    } : null,
    result: item.hasResult ? {
      contentUrl: item.resultContentUrl,
      downloadUrl: `${item.resultContentUrl}?download=1`,
      mimeType: row.result_mime_type || null,
      sizeBytes: toNumber(row.result_size_bytes),
      sha256: row.result_sha256 || null,
      originalFilename: row.result_original_filename || null,
      storedAt: toIsoValue(row.result_stored_at)
    } : null,
    billing: row.reservation_id ? {
      reservationId: row.reservation_id,
      status: row.reservation_status || null,
      quantity: row.reservation_quantity == null ? null : String(row.reservation_quantity),
      unit: row.reservation_unit || null,
      unitPriceNoa: row.unit_price_snapshot == null ? null : String(row.unit_price_snapshot),
      amountNoa: row.reservation_amount == null ? null : String(row.reservation_amount),
      capturedAt: toIsoValue(row.reservation_captured_at),
      releasedAt: toIsoValue(row.reservation_released_at),
      releaseReason: row.reservation_release_reason || null
    } : null,
    providerMetrics: {
      estimatedCost: row.attempt_estimated_cost == null ? null : String(row.attempt_estimated_cost),
      actualCost: row.attempt_actual_cost == null ? null : String(row.attempt_actual_cost),
      costCurrency: row.attempt_cost_currency || null,
      processingTimeMs: toNumber(row.attempt_processing_time_ms)
    },
    errors: {
      code: row.safe_error_code || row.storage_safe_error_code || row.attempt_error_code || null,
      message: row.safe_error_message || row.storage_safe_error_message || row.attempt_error_summary || null
    },
    timeline: {
      createdAt: toIsoValue(row.created_at),
      submittedAt: toIsoValue(row.submitted_at),
      processingAt: toIsoValue(row.processing_at),
      resultStoredAt: toIsoValue(row.result_stored_at),
      completedAt: toIsoValue(row.completed_at),
      failedAt: toIsoValue(row.failed_at),
      cancelledAt: toIsoValue(row.cancelled_at),
      expiredAt: toIsoValue(row.expired_at),
      updatedAt: toIsoValue(row.updated_at),
      lastPolledAt: toIsoValue(row.last_polled_at)
    },
    diagnostics: {
      providerStatus: row.provider_status || null,
      pollAttempts: toNumber(row.poll_attempts) || 0,
      storageAttempts: toNumber(row.storage_attempts) || 0,
      resultStorageStatus: row.result_storage_status || null
    }
  };
}

function createVideoGenerationAdminRouter({ db, requireAdminAuth, inputMediaStorage, logger = console }) {
  if (!db || typeof db.query !== 'function') throw new Error('VIDEO_ADMIN_DB_REQUIRED');
  if (typeof requireAdminAuth !== 'function') throw new Error('VIDEO_ADMIN_AUTH_REQUIRED');

  const router = express.Router();
  router.use(requireAdminAuth);

  router.get('/', async (req, res) => {
    try {
      const query = String(req.query.q || '').trim().slice(0, 191);
      const requestedStatus = String(req.query.status || '').trim().toLowerCase();
      const status = VIDEO_STATUSES.has(requestedStatus) ? requestedStatus : '';
      const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
      const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize || '20'), 10) || 20));
      const offset = (page - 1) * pageSize;
      const searchFilters = [];
      const searchValues = [];

      if (query) {
        const search = `%${query}%`;
        searchFilters.push(`(
          g.id LIKE ? OR g.user_id LIKE ? OR u.name LIKE ? OR u.phone LIKE ?
          OR g.prompt LIKE ? OR g.user_prompt LIKE ? OR g.compiled_prompt LIKE ?
        )`);
        searchValues.push(search, search, search, search, search, search, search);
      }

      const itemFilters = [...searchFilters];
      const itemValues = [...searchValues];
      if (status) {
        itemFilters.push('g.status = ?');
        itemValues.push(status);
      }
      const itemWhere = itemFilters.length ? `WHERE ${itemFilters.join(' AND ')}` : '';
      const searchWhere = searchFilters.length ? `WHERE ${searchFilters.join(' AND ')}` : '';

      const [countResult, itemsResult, summaryResult] = await Promise.all([
        db.query(
          `SELECT COUNT(*) AS total
           FROM app_video_generations g
           LEFT JOIN app_users u ON u.user_id = g.user_id
           ${itemWhere}`,
          itemValues
        ),
        db.query(
          `SELECT g.id,g.user_id,g.status,g.mode,g.prompt,g.user_prompt,g.provider,g.model_key,
                  g.provider_model_id_snapshot,g.aspect_ratio,g.duration,g.resolution,g.input_media_id,
                  g.input_media_reference,g.result_storage_key,g.result_mime_type,g.result_size_bytes,
                  g.created_at,g.updated_at,g.completed_at,
                  u.name AS user_name,u.phone AS user_phone,u.age AS user_age,
                  m.id AS joined_input_media_id
           FROM app_video_generations g
           LEFT JOIN app_users u ON u.user_id = g.user_id
           LEFT JOIN app_video_input_media m
             ON m.id = COALESCE(g.input_media_id,g.input_media_reference)
            AND m.user_id = g.user_id
           ${itemWhere}
           ORDER BY g.created_at DESC,g.id DESC
           LIMIT ? OFFSET ?`,
          [...itemValues, pageSize, offset]
        ),
        db.query(
          `SELECT g.status,COUNT(*) AS total
           FROM app_video_generations g
           LEFT JOIN app_users u ON u.user_id = g.user_id
           ${searchWhere}
           GROUP BY g.status`,
          searchValues
        )
      ]);

      const [countRows] = countResult;
      const [itemRows] = itemsResult;
      const [summaryRows] = summaryResult;
      const summary = { total: 0, succeeded: 0, active: 0, failed: 0 };
      for (const row of summaryRows) {
        const total = Number(row.total || 0);
        summary.total += total;
        if (row.status === 'succeeded') summary.succeeded += total;
        else if (['failed', 'provider_status_unknown'].includes(row.status)) summary.failed += total;
        else if (!['cancelled', 'expired'].includes(row.status)) summary.active += total;
      }

      return res.json({
        items: itemRows.map(listDto),
        total: Number(countRows[0]?.total || 0),
        page,
        pageSize,
        summary
      });
    } catch (error) {
      logger?.error?.('Admin video generation list failed.', error);
      return res.status(500).json({
        error: 'VIDEO_ADMIN_LIST_FAILED',
        message: 'دریافت فهرست ویدیوها انجام نشد.'
      });
    }
  });

  router.get('/:generationId/input', async (req, res) => {
    try {
      if (!inputMediaStorage || typeof inputMediaStorage.createReadStream !== 'function') {
        return res.status(503).json({ error: 'VIDEO_INPUT_STORAGE_UNAVAILABLE' });
      }
      const generationId = String(req.params.generationId || '').trim();
      const [rows] = await db.query(
        `SELECT m.storage_key,m.mime_type,m.size_bytes
         FROM app_video_generations g
         INNER JOIN app_video_input_media m
           ON m.id = COALESCE(g.input_media_id,g.input_media_reference)
          AND m.user_id = g.user_id
         WHERE g.id = ?
         LIMIT 1`,
        [generationId]
      );
      const media = rows[0];
      if (!media) return res.status(404).json({ error: 'VIDEO_INPUT_MEDIA_NOT_FOUND' });

      res.set({
        'Content-Type': media.mime_type,
        'Content-Length': String(media.size_bytes),
        'Content-Disposition': 'inline; filename="video-input-image"',
        'Cache-Control': 'private, no-store, max-age=0',
        Pragma: 'no-cache',
        'X-Content-Type-Options': 'nosniff'
      });
      if (req.method === 'HEAD') return res.end();
      const stream = inputMediaStorage.createReadStream(media.storage_key);
      stream.once('error', (error) => {
        logger?.error?.('Admin video input media stream failed.', error);
        if (!res.headersSent) res.status(404);
        res.end();
      });
      return stream.pipe(res);
    } catch (error) {
      logger?.error?.('Admin video input media read failed.', error);
      return res.status(500).json({
        error: 'VIDEO_INPUT_MEDIA_READ_FAILED',
        message: 'تصویر ورودی خوانده نشد.'
      });
    }
  });

  router.get('/:generationId', async (req, res) => {
    try {
      const generationId = String(req.params.generationId || '').trim();
      const [rows] = await db.query(
        `SELECT g.id,g.danoa_request_id,g.user_id,g.status,g.mode,g.capability_key,g.route_id,g.route_version,
                g.model_key,g.provider,g.provider_model_id_snapshot,g.prompt,g.user_prompt,g.compiled_prompt,
                g.compiled_prompt_hash,g.negative_prompt,g.prompt_profile_key,g.prompt_profile_version,
                g.prompt_compiler_version,g.aspect_ratio,g.duration,g.quality,g.resolution,g.generate_audio,
                g.input_media_id,g.input_media_reference,g.provider_status,g.result_storage_key,
                g.result_mime_type,g.result_size_bytes,g.result_storage_status,g.result_sha256,
                g.result_original_filename,g.result_stored_at,g.safe_error_code,g.safe_error_message,
                g.storage_safe_error_code,g.storage_safe_error_message,g.poll_attempts,g.storage_attempts,
                g.created_at,g.submitted_at,g.processing_at,g.completed_at,g.failed_at,g.cancelled_at,
                g.expired_at,g.updated_at,g.last_polled_at,
                u.name AS user_name,u.phone AS user_phone,u.age AS user_age,
                m.id AS joined_input_media_id,m.original_filename AS input_original_filename,m.mime_type AS input_mime_type,
                m.size_bytes AS input_size_bytes,m.created_at AS input_created_at,
                n.reservation_id,n.status AS reservation_status,n.quantity AS reservation_quantity,
                n.unit AS reservation_unit,n.unit_price_snapshot,n.amount AS reservation_amount,
                n.captured_at AS reservation_captured_at,n.released_at AS reservation_released_at,
                n.release_reason AS reservation_release_reason,
                a.state AS attempt_state,a.estimated_cost AS attempt_estimated_cost,
                a.actual_cost AS attempt_actual_cost,a.cost_currency AS attempt_cost_currency,
                a.processing_time_ms AS attempt_processing_time_ms,a.error_code AS attempt_error_code,
                a.safe_error_summary AS attempt_error_summary
         FROM app_video_generations g
         LEFT JOIN app_users u ON u.user_id = g.user_id
         LEFT JOIN app_video_input_media m
           ON m.id = COALESCE(g.input_media_id,g.input_media_reference)
          AND m.user_id = g.user_id
         LEFT JOIN app_noa_reservations n ON n.reservation_id = g.noa_reservation_id
         LEFT JOIN app_ai_provider_attempts a ON a.attempt_id = g.provider_attempt_id
         WHERE g.id = ?
         LIMIT 1`,
        [generationId]
      );
      if (!rows[0]) return res.status(404).json({ error: 'VIDEO_GENERATION_NOT_FOUND' });
      return res.json(detailDto(rows[0]));
    } catch (error) {
      logger?.error?.('Admin video generation detail failed.', error);
      return res.status(500).json({
        error: 'VIDEO_ADMIN_DETAIL_FAILED',
        message: 'جزئیات ویدیو دریافت نشد.'
      });
    }
  });

  return router;
}

module.exports = {
  VIDEO_STATUSES,
  createVideoGenerationAdminRouter,
  detailDto,
  listDto
};
