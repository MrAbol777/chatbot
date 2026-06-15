const path = require('path');
const fs = require('fs-extra');

/**
 * Image generation controller — handles generate / status / serve routes.
 *
 * After Metis completes, the image is downloaded and saved to uploads/images-generated/{id}.webp
 * and served from there (no CORS issues).
 */
function createImageGenerationController({ imageGenerationService, db }) {

  /**
   * POST /api/images/generate
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

      const metisTaskId = await imageGenerationService.createImageGeneration(prompt);
      console.log('[image-generation] generateImage: Metis task created', { metisTaskId, userId, prompt: prompt.slice(0, 50) });

      const [insertResult] = await db.query(
        `INSERT INTO image_generations (user_id, task_id, prompt, status)
         VALUES (?, ?, ?, 'QUEUE')`,
        [userId, metisTaskId, prompt]
      );
      const dbRecordId = insertResult.insertId;
      const taskId = String(dbRecordId);

      // Ensure images-generated directory exists
      const imagesDir = path.join(__dirname, '../../../uploads/images-generated');
      await fs.ensureDir(imagesDir);

      // Background poller
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
              continue;
            }

            if (metisResult.status === 'COMPLETED') {
              // Save to local file first
              const localPath = `images-generated/${dbRecordId}.webp`;
              const fullPath = path.join(imagesDir, `${dbRecordId}.webp`);

              try {
                console.log('[image-generation] Downloading image from:', metisResult.imageUrl?.slice(0, 80));
                const imageResponse = await fetch(metisResult.imageUrl);
                if (!imageResponse.ok) {
                  throw new Error(`Failed to download: ${imageResponse.status}`);
                }
                const buffer = Buffer.from(await imageResponse.arrayBuffer());
                await fs.writeFile(fullPath, buffer);
                console.log('[image-generation] Image saved to:', fullPath, 'size:', buffer.length);
              } catch (downloadError) {
                console.error('[image-generation] Download failed:', downloadError?.message);
                // Still mark as completed — the serve endpoint will try from Metis URL as fallback
              }

              // Update DB BEFORE returning so frontend can immediately see COMPLETED
              await db.query(
                `UPDATE image_generations SET status = 'COMPLETED', image_url = ? WHERE id = ?`,
                [localPath, dbRecordId]
              );
              console.log('[image-generation] generateImage: task completed', { dbRecordId, localPath });
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
          }

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
            // DB write failed
          }
        }
      })();

      return res.status(202).json({
        success: true,
        taskId,
        message: 'Image generation started.'
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
   */
  const getImageStatus = async (req, res) => {
    try {
      const { taskId } = req.params;
      const userId = req.user?.id;

      if (!taskId) {
        return res.status(400).json({ success: false, error: 'taskId is required.' });
      }

      const [rows] = await db.query(
        `SELECT id, task_id, prompt, status, image_url, error, created_at, updated_at
         FROM image_generations
         WHERE (id = ? OR task_id = ?) AND user_id = ?
         LIMIT 1`,
        [taskId, taskId, userId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Task not found.' });
      }

      const record = rows[0];

      // Use relative URL — Vite proxy forwards /api to backend on same origin, avoiding CORS/CSP issues
      const imageUrlPath = `/api/uploads/images/${record.id}`;

      if (record.status === 'COMPLETED' || record.status === 'ERROR') {
        return res.json({
          success: true,
          taskId: record.task_id,
          status: record.status,
          imageUrl: record.status === 'COMPLETED' ? imageUrlPath : null,
          error: record.error || null
        });
      }

      let metisResult;
      try {
        metisResult = await imageGenerationService.getImageStatus(record.task_id);
      } catch (metisError) {
        return res.json({
          success: true,
          taskId: record.task_id,
          status: record.status,
          imageUrl: imageUrlPath,
          error: record.error || null,
          metisUnreachable: true
        });
      }

      let newStatus = record.status;
      const toDbStatus = (s) => {
        const u = String(s || '').toUpperCase();
        if (['COMPLETED'].includes(u)) return 'COMPLETED';
        if (['ERROR', 'CANCELLED'].includes(u)) return 'ERROR';
        if (['RUNNING', 'WAITING', 'IN_PROGRESS'].includes(u)) return 'RUNNING';
        if (u === 'QUEUE') return 'QUEUE';
        return record.status;
      };
      newStatus = toDbStatus(metisResult.status);

      if (newStatus !== record.status) {
        await db.query(`UPDATE image_generations SET status = ? WHERE id = ?`, [newStatus, record.id]);
      }

      return res.json({
        success: true,
        taskId: record.task_id,
        status: newStatus,
        imageUrl: null,
        error: null
      });
    } catch (error) {
      console.error('[image-generation] getImageStatus failed:', error instanceof Error ? error.message : String(error));
      return res.status(500).json({ success: false, error: 'Failed to fetch task status.' });
    }
  };

  /**
   * GET /api/images/serve/:taskId — fallback (not really needed now, served via /api/uploads)
   */
  const serveImage = async (req, res) => {
    const { taskId } = req.params;
    const imagesDir = path.join(__dirname, '../../../uploads/images-generated');
    const filePath = path.join(imagesDir, `${taskId}.webp`);

    console.log('[SERVE] id:', taskId);
    console.log('[SERVE] filePath:', filePath);
    console.log('[SERVE] exists:', fs.existsSync(filePath));

    if (!(await fs.pathExists(filePath))) {
      return res.status(404).json({ success: false, error: 'Image not found.' });
    }

    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return fs.createReadStream(filePath).pipe(res);
  };

  return {
    generateImage,
    getImageStatus,
    serveImage
  };
}

module.exports = { createImageGenerationController };
