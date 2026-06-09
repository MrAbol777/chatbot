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
      await db.query(
        `INSERT INTO image_generations (user_id, task_id, prompt, status)
         VALUES (?, ?, ?, 'QUEUE')`,
        [userId, taskId, prompt]
      );

      return res.status(202).json({
        success: true,
        taskId,
        message: 'Image generation started. Use GET /api/images/status/:taskId to check progress.'
      });
    } catch (error) {
      console.error('[image-generation] generateImage failed:', error?.message || error);
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
          imageUrl: record.image_url || null,
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
          imageUrl: record.image_url || null,
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
      const VALID_STATUSES = new Set(['QUEUE', 'WAITING', 'RUNNING', 'COMPLETED', 'ERROR', 'CANCELLED']);

      if (metisResult.status === 'COMPLETED') {
        newStatus = 'COMPLETED';
        imageUrl = metisResult.imageUrl;
        await db.query(
          `UPDATE image_generations SET status = 'COMPLETED', image_url = ? WHERE id = ?`,
          [imageUrl, record.id]
        );
      } else if (metisResult.status === 'ERROR') {
        newStatus = 'ERROR';
        errorText = metisResult.error;
        await db.query(
          `UPDATE image_generations SET status = 'ERROR', error = ? WHERE id = ?`,
          [errorText, record.id]
        );
      } else if (metisResult.status === 'CANCELLED') {
        newStatus = 'CANCELLED';
        errorText = metisResult.error || 'Task was cancelled.';
        await db.query(
          `UPDATE image_generations SET status = 'CANCELLED', error = ? WHERE id = ?`,
          [errorText, record.id]
        );
      } else {
        // Pass through non-terminal Metis statuses directly (QUEUE, WAITING, RUNNING)
        const metisStatus = String(metisResult.status || '').toUpperCase();
        if (VALID_STATUSES.has(metisStatus)) {
          newStatus = metisStatus;
        } else {
          // Unknown status → default to QUEUE
          newStatus = 'QUEUE';
        }
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
        imageUrl: imageUrl || null,
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

  return {
    generateImage,
    getImageStatus
  };
}

module.exports = { createImageGenerationController };
