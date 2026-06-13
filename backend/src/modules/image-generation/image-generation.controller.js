function createImageGenerationController({ imageGenerationService, db }) {

  /**
   * POST /api/images/generate
   * Body: { prompt: string }
   * Returns: { success, taskId }
   */
  const generateImage = async (req, res) => {
    try {
      const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
      if (!prompt) {
        return res.status(400).json({
          success: false,
          error: 'Prompt is required.'
        });
      }

      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required.'
        });
      }

      // 1. Call MetisAI to create the async task
      const taskId = await imageGenerationService.createImageGeneration(prompt);

      // 2. Save the task record in DB
      console.log('[image-generation] DB INSERT attempt:', { userId, taskId, prompt: prompt.slice(0, 50) });
      const insertResult = await db.query(
        `INSERT INTO image_generations (user_id, task_id, prompt, status)
         VALUES (?, ?, ?, 'QUEUE')`,
        [userId, taskId, prompt]
      );
      console.log('[image-generation] DB INSERT result:', JSON.stringify(insertResult).slice(0, 200));

      return res.status(202).json({
        success: true,
        taskId,
        message: 'Image generation started. Use GET /api/images/status/:taskId to check progress.'
      });
    } catch (error) {
      console.error('[image-generation] generateImage failed:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
        code: error?.code || null,
        sqlMessage: error?.sqlMessage || null,
        sqlState: error?.sqlState || null
      });
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Image generation failed.'
      });
    }
  };

  /**
   * GET /api/images/status/:taskId
   * Returns: { success, taskId, status, imageUrl?, error? }
   */
  const getImageStatus = async (req, res) => {
    try {
      const { taskId } = req.params;
      const userId = req.user?.id;

      if (!taskId) {
        return res.status(400).json({
          success: false,
          error: 'taskId is required.'
        });
      }

      // 1. Find the record in DB (scoped to the authenticated user)
      const [rows] = await db.query(
        `SELECT id, task_id, prompt, status, image_url, error, created_at, updated_at
         FROM image_generations
         WHERE task_id = ? AND user_id = ?
         LIMIT 1`,
        [taskId, userId]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Task not found or you do not have permission to access it.'
        });
      }

      const record = rows[0];

      // 2. If already in a terminal state, return immediately
      if (record.status === 'COMPLETED' || record.status === 'ERROR') {
        return res.json({
          success: true,
          taskId: record.task_id,
          status: record.status,
          imageUrl: record.image_url ? `/api/images/serve/${record.task_id}` : null,
          error: record.error || null,
          createdAt: record.created_at,
          updatedAt: record.updated_at
        });
      }

      // 3. Query MetisAI for the latest status
      let metisResult;
      try {
        metisResult = await imageGenerationService.getImageStatus(taskId);
      } catch (metisError) {
        // Metis is unreachable — return current DB status with a warning
        console.warn('[image-generation] getImageStatus Metis unreachable:', metisError?.message || metisError);
        return res.json({
          success: true,
          taskId,
          status: record.status,
          imageUrl: record.image_url ? `/api/images/serve/${taskId}` : null,
          error: record.error || null,
          metisUnreachable: true,
          createdAt: record.created_at,
          updatedAt: record.updated_at
        });
      }

      let newStatus = record.status;
      let imageUrl = record.image_url;
      let errorText = record.error;

      // 4. Update DB based on Metis response
      // Metis statuses: QUEUE, WAITING, RUNNING, COMPLETED, ERROR, CANCELLED
      // Map Metis statuses to safe DB-compatible values (works with both old and new ENUM)
      // Old ENUM: QUEUE, IN_PROGRESS, COMPLETED, ERROR
      // New ENUM: QUEUE, WAITING, RUNNING, COMPLETED, ERROR, CANCELLED

      const toDbStatus = (metisStatus) => {
        const normalized = String(metisStatus || '').toUpperCase();
        if (['COMPLETED'].includes(normalized)) return 'COMPLETED';
        if (['ERROR', 'CANCELLED'].includes(normalized)) return 'ERROR';
        // Map running/waiting states to IN_PROGRESS (exists in both old and new ENUM)
        if (['RUNNING', 'WAITING', 'IN_PROGRESS'].includes(normalized)) return 'IN_PROGRESS';
        if (['QUEUE'].includes(normalized)) return 'QUEUE';
        // Fallback for unknown statuses
        return 'QUEUE';
      };

      if (metisResult.status === 'COMPLETED') {
        newStatus = toDbStatus(metisResult.status);
        imageUrl = metisResult.imageUrl;
        console.log('[image-generation] COMPLETED → imageUrl:', imageUrl ? `${imageUrl.slice(0, 80)}...` : 'MISSING');
        if (record.status !== newStatus) {
          await db.query(
            `UPDATE image_generations SET status = 'COMPLETED', image_url = ? WHERE id = ?`,
            [imageUrl, record.id]
          );
        }
        // Always use the latest imageUrl from Metis (even if DB status didn't change)
        imageUrl = metisResult.imageUrl;
      } else if (metisResult.status === 'ERROR') {
        newStatus = toDbStatus(metisResult.status);
        errorText = metisResult.error;
        if (record.status !== newStatus) {
          await db.query(
            `UPDATE image_generations SET status = 'ERROR', error = ? WHERE id = ?`,
            [errorText, record.id]
          );
        }
      } else if (metisResult.status === 'CANCELLED') {
        // Old ENUM doesn't have CANCELLED — map to ERROR
        newStatus = 'ERROR';
        errorText = metisResult.error || 'Task was cancelled.';
        if (record.status !== newStatus) {
          await db.query(
            `UPDATE image_generations SET status = 'ERROR', error = ? WHERE id = ?`,
            [errorText, record.id]
          );
        }
      } else {
        // Non-terminal Metis statuses (QUEUE, WAITING, RUNNING) → map to safe DB value
        newStatus = toDbStatus(metisResult.status);
        if (record.status !== newStatus) {
          await db.query(
            `UPDATE image_generations SET status = ? WHERE id = ?`,
            [newStatus, record.id]
          );
        }
      }

      return res.json({
        success: true,
        taskId,
        status: newStatus,
        imageUrl: imageUrl ? `/api/images/serve/${taskId}` : null,
        error: errorText || null,
        createdAt: record.created_at,
        updatedAt: record.updated_at
      });
    } catch (error) {
      console.error('[image-generation] getImageStatus failed:', error?.message || error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch task status.'
      });
    }
  };

  /**
   * GET /api/images/serve/:taskId
   * Proxies the generated image through the backend to avoid CORS issues.
   */
  const serveImage = async (req, res) => {
    try {
      const { taskId } = req.params;

      if (!taskId) {
        return res.status(400).json({ success: false, error: 'taskId is required.' });
      }

      console.log('[image-generation] serveImage REQUEST → taskId:', taskId);

      // Find the record in DB (public endpoint — taskId acts as access control)
      const [rows] = await db.query(
        `SELECT id, task_id, image_url, status FROM image_generations WHERE task_id = ? LIMIT 1`,
        [taskId]
      );

      if (rows.length === 0) {
        console.log('[image-generation] serveImage → NOT FOUND in DB');
        return res.status(404).json({ success: false, error: 'Task not found.' });
      }

      const record = rows[0];
      console.log('[image-generation] serveImage → DB record:', { status: record.status, hasUrl: !!record.image_url, urlPreview: record.image_url ? record.image_url.slice(0, 60) + '...' : null });

      if (record.status !== 'COMPLETED' || !record.image_url) {
        console.log('[image-generation] serveImage → not ready:', { status: record.status, hasUrl: !!record.image_url });
        return res.status(404).json({ success: false, error: 'Image not available yet.' });
      }

      console.log('[image-generation] serveImage → proxying:', record.image_url.slice(0, 80) + '...');

      // Fetch image from Metis/Azure and proxy it
      const axios = require('axios');
      const imageResponse = await axios.get(record.image_url, {
        responseType: 'arraybuffer',
        timeout: 30000
      });

      const contentType = imageResponse.headers['content-type'] || 'image/jpeg';
      console.log('[image-generation] serveImage → SUCCESS, size:', imageResponse.data.length, 'contentType:', contentType);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.send(imageResponse.data);
    } catch (error) {
      const statusCode = error?.response?.status;
      console.error('[image-generation] serveImage FAILED:', {
        message: error?.message || error,
        statusCode,
        responseError: error?.response?.data
      });

      if (statusCode === 404) {
        return res.status(404).json({ success: false, error: 'Image not found on storage.' });
      }
      if (statusCode === 403) {
        return res.status(403).json({ success: false, error: 'Access denied to image.' });
      }
      if (statusCode === 410) {
        return res.status(410).json({ success: false, error: 'Image has been removed.' });
      }
      return res.status(500).json({ success: false, error: 'Failed to serve image.' });
    }
  };

  return {
    generateImage,
    getImageStatus,
    serveImage
  };
}

module.exports = { createImageGenerationController };
