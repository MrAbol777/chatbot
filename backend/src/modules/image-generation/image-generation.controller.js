/**
 * Image generation controller — handles generate / status / serve routes.
 *
 * Task lifecycle: QUEUE → RUNNING → COMPLETED | ERROR
 * Metis v2 async API is used internally:
 *   POST /api/v2/generate        → returns { id: metisTaskId }
 *   GET  /api/v2/generate/:taskId → returns { status, generations[] }
 */
function createImageGenerationController({ imageGenerationService, db }) {

  /**
   * POST /api/images/generate
   * Body: { prompt: string }
   * Returns: { success, taskId }
   *
   * Calls Metis to create an async task, saves the Metis task_id in DB,
   * then fires a background poller to update status as it completes.
   */
  const generateImage = async (req, res) => {
    try {
      const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
      if (!prompt) {
        return res.status(400).json({ success: false, error: 'Prompt is required.' });
      }

      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Authentication required.' });
      }

      // 1. Call Metis to start async task
      const metisTaskId = await imageGenerationService.createImageGeneration(prompt);
      console.log('[image-generation] generateImage: Metis task created', { metisTaskId, userId, prompt: prompt.slice(0, 50) });

      // 2. Insert DB record with Metis task_id so frontend can poll
      const [insertResult] = await db.query(
        `INSERT INTO image_generations (user_id, task_id, prompt, status)
         VALUES (?, ?, ?, 'QUEUE')`,
        [userId, metisTaskId, prompt]
      );
      const dbRecordId = insertResult.insertId;
      const taskId = String(dbRecordId);

      // 3. Fire-and-forget: poll Metis until terminal state, update DB
      (async () => {
        try {
          await db.query(`UPDATE image_generations SET status = 'RUNNING' WHERE id = ?`, [dbRecordId]);

          const POLL_INTERVAL_MS = 2000;
          const MAX_POLLS = 90;
          let polls = 0;

          while (polls < MAX_POLLS) {
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
            polls += 1;

            let metisResult;
            try {
              metisResult = await imageGenerationService.getImageStatus(metisTaskId);
            } catch (pollError) {
              console.warn('[image-generation] poll Metis unreachable:', pollError?.message);
              continue; // keep polling
            }

            if (metisResult.status === 'COMPLETED') {
              await db.query(
                `UPDATE image_generations SET status = 'COMPLETED', image_url = ? WHERE id = ?`,
                [metisResult.imageUrl, dbRecordId]
              );
              console.log('[image-generation] generateImage: task completed', { dbRecordId, urlPreview: metisResult.imageUrl?.slice(0, 80) });
              return;
            }

            if (metisResult.status === 'ERROR') {
              await db.query(
                `UPDATE image_generations SET status = 'ERROR', error = ? WHERE id = ?`,
                [metisResult.error || 'MetisAI task failed.', dbRecordId]
              );
              console.log('[image-generation] generateImage: task errored', { dbRecordId, error: metisResult.error });
              return;
            }

            // Non-terminal (QUEUE, WAITING, RUNNING) — keep polling
          }

          // Timed out
          await db.query(
            `UPDATE image_generations SET status = 'ERROR', error = ? WHERE id = ?`,
            ['ساخت عکس بیش از حد طول کشید.', dbRecordId]
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error('[image-generation] generateImage background poller failed:', { dbRecordId, message });
          try {
            await db.query(
              `UPDATE image_generations SET status = 'ERROR', error = ? WHERE id = ?`,
              [message, dbRecordId]
            );
          } catch {
            // DB write failed — nothing we can do
          }
        }
      })();

      return res.status(202).json({
        success: true,
        taskId,
        message: 'Image generation started. Use GET /api/images/status/:taskId to check progress.'
      });
    } catch (error) {
      console.error('[image-generation] generateImage failed:', error instanceof Error ? error.message : String(error));
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Image generation failed.'
      });
    }
  };

  /**
   * GET /api/images/status/:taskId
   * Returns: { success, taskId, status, imageUrl?, error? }
   *
   * Reads from DB; if still non-terminal (RUNNING), also polls Metis once
   * and updates the DB record so the next poll is faster.
   */
  const getImageStatus = async (req, res) => {
    try {
      const { taskId } = req.params;
      const userId = req.user?.id;

      if (!taskId) {
        return res.status(400).json({ success: false, error: 'taskId is required.' });
      }

      // Find by DB numeric id or stored metis task_id
      const [rows] = await db.query(
        `SELECT id, task_id, prompt, status, image_url, error, created_at, updated_at
         FROM image_generations
         WHERE (id = ? OR task_id = ?) AND user_id = ?
         LIMIT 1`,
        [taskId, taskId, userId]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Task not found or you do not have permission to access it.'
        });
      }

      const record = rows[0];

      // Terminal states — return immediately from DB
      if (record.status === 'COMPLETED' || record.status === 'ERROR') {
        return res.json({
          success: true,
          taskId: record.task_id,
          status: record.status,
          imageUrl: record.image_url ? `/api/images/serve/${record.id}` : null,
          error: record.error || null,
          createdAt: record.created_at,
          updatedAt: record.updated_at
        });
      }

      // Non-terminal — poll Metis once and update DB
      let metisResult;
      try {
        metisResult = await imageGenerationService.getImageStatus(record.task_id);
      } catch (metisError) {
        console.warn('[image-generation] getImageStatus Metis unreachable:', metisError?.message);
        // Return current DB state with a warning
        return res.json({
          success: true,
          taskId: record.task_id,
          status: record.status,
          imageUrl: record.image_url ? `/api/images/serve/${record.id}` : null,
          error: record.error || null,
          metisUnreachable: true,
          createdAt: record.created_at,
          updatedAt: record.updated_at
        });
      }

      let newStatus = record.status;
      let imageUrl = record.image_url;
      let errorText = record.error;

      if (metisResult.status === 'COMPLETED') {
        newStatus = 'COMPLETED';
        imageUrl = metisResult.imageUrl;
        await db.query(
          `UPDATE image_generations SET status = 'COMPLETED', image_url = ? WHERE id = ?`,
          [imageUrl, record.id]
        );
      } else if (metisResult.status === 'ERROR') {
        newStatus = 'ERROR';
        errorText = metisResult.error || 'MetisAI task failed.';
        await db.query(
          `UPDATE image_generations SET status = 'ERROR', error = ? WHERE id = ?`,
          [errorText, record.id]
        );
      } else {
        // Metis is still working — update to the current status
        const toDbStatus = (s) => {
          const u = String(s || '').toUpperCase();
          if (['COMPLETED'].includes(u)) return 'COMPLETED';
          if (['ERROR', 'CANCELLED'].includes(u)) return 'ERROR';
          if (u === 'RUNNING') return 'RUNNING';
          if (u === 'WAITING') return 'RUNNING';
          if (u === 'IN_PROGRESS') return 'RUNNING';
          if (u === 'QUEUE') return 'QUEUE';
          return record.status; // keep DB value for unknown
        };
        newStatus = toDbStatus(metisResult.status);
        if (newStatus !== record.status) {
          await db.query(
            `UPDATE image_generations SET status = ? WHERE id = ?`,
            [newStatus, record.id]
          );
        }
      }

      return res.json({
        success: true,
        taskId: record.task_id,
        status: newStatus,
        imageUrl: imageUrl ? `/api/images/serve/${record.id}` : null,
        error: errorText || null,
        createdAt: record.created_at,
        updatedAt: record.updated_at
      });
    } catch (error) {
      console.error('[image-generation] getImageStatus failed:', error instanceof Error ? error.message : String(error));
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch task status.'
      });
    }
  };

  /**
   * GET /api/images/serve/:taskId
   * Public endpoint — proxies the generated image through the backend.
   * No auth required; the taskId itself acts as access control.
   */
  const serveImage = async (req, res) => {
    try {
      const { taskId } = req.params;

      if (!taskId) {
        return res.status(400).json({ success: false, error: 'taskId is required.' });
      }

      const [rows] = await db.query(
        `SELECT id, task_id, image_url, status FROM image_generations WHERE id = ? OR task_id = ? LIMIT 1`,
        [taskId, taskId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Task not found.' });
      }

      const record = rows[0];

      if (record.status !== 'COMPLETED' || !record.image_url) {
        return res.status(404).json({ success: false, error: 'Image not available yet.' });
      }

      // Proxy remote image URL
      try {
        const imageResponse = await fetch(record.image_url);
        if (!imageResponse.ok) {
          return res.status(imageResponse.status).json({ success: false, error: 'Failed to fetch image.' });
        }

        const buffer = Buffer.from(await imageResponse.arrayBuffer());
        const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.send(buffer);
      } catch {
        // If proxy fails, redirect the client to the raw URL
        return res.redirect(record.image_url);
      }
    } catch (error) {
      console.error('[image-generation] serveImage failed:', error instanceof Error ? error.message : String(error));
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
