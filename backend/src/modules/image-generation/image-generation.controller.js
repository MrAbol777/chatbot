const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

const GENERATED_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];
const MIME_BY_EXTENSION = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp'
};

/**
 * Image generation controller — handles generate / status / serve routes.
 *
 * Gemini returns inline image bytes. We keep the existing API contract by
 * creating an internal task, doing generation in the background, and saving
 * uploads/images-generated/{id}.{ext} for same-origin serving.
 */
function createImageGenerationController({ imageGenerationService, db }) {
  const getImagesDir = () => path.join(__dirname, '../../../uploads/images-generated');

  const findGeneratedImage = async (recordId) => {
    const imagesDir = getImagesDir();
    for (const extension of GENERATED_IMAGE_EXTENSIONS) {
      const fullPath = path.join(imagesDir, `${recordId}.${extension}`);
      if (await fs.pathExists(fullPath)) {
        const stat = await fs.stat(fullPath);
        if (stat.isFile() && stat.size > 0) {
          return {
            fullPath,
            localPath: `images-generated/${recordId}.${extension}`,
            mimeType: MIME_BY_EXTENSION[extension] || 'application/octet-stream'
          };
        }
      }
    }
    return null;
  };

  const saveGeneratedImage = async ({ image, recordId }) => {
    if (!image?.buffer?.length) {
      throw new Error('Generated image data is empty.');
    }

    const extension = GENERATED_IMAGE_EXTENSIONS.includes(image.extension) ? image.extension : 'png';
    const imagesDir = getImagesDir();
    await fs.ensureDir(imagesDir);

    const localPath = `images-generated/${recordId}.${extension}`;
    const fullPath = path.join(imagesDir, `${recordId}.${extension}`);

    await fs.writeFile(fullPath, image.buffer);

    const stat = await fs.stat(fullPath);
    if (!stat.isFile() || stat.size <= 0) {
      throw new Error('Generated image file was not saved correctly.');
    }

    await fs.access(fullPath, fs.constants.R_OK);
    console.log('[image-generation] Image saved locally', {
      recordId,
      fullPath,
      mimeType: image.mimeType,
      size: stat.size
    });

    return { localPath, fullPath };
  };

  const runGenerationTask = async ({ dbRecordId, prompt }) => {
    try {
      await db.query(`UPDATE image_generations SET status = 'RUNNING' WHERE id = ?`, [dbRecordId]);

      const image = await imageGenerationService.generateImage(prompt);
      const { localPath } = await saveGeneratedImage({ image, recordId: dbRecordId });

      await db.query(
        `UPDATE image_generations SET status = 'COMPLETED', image_url = ?, error = NULL WHERE id = ?`,
        [localPath, dbRecordId]
      );

      console.log('[image-generation] task completed', {
        dbRecordId,
        localPath,
        model: image.model
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[image-generation] task failed', {
        dbRecordId,
        message
      });
      try {
        await db.query(
          `UPDATE image_generations SET status = 'ERROR', error = ? WHERE id = ?`,
          [message, dbRecordId]
        );
      } catch (dbError) {
        console.error('[image-generation] failed to persist task error', {
          dbRecordId,
          message: dbError instanceof Error ? dbError.message : String(dbError)
        });
      }
    }
  };

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

      const providerTaskId = `gemini-${uuidv4()}`;
      const [insertResult] = await db.query(
        `INSERT INTO image_generations (user_id, task_id, prompt, status)
         VALUES (?, ?, ?, 'QUEUE')`,
        [userId, providerTaskId, prompt]
      );
      const dbRecordId = insertResult.insertId;
      const taskId = String(dbRecordId);

      console.log('[image-generation] task created', {
        taskId,
        providerTaskId,
        userId,
        promptLength: prompt.length
      });

      setImmediate(() => {
        void runGenerationTask({ dbRecordId, prompt });
      });

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
      const imageUrlPath = `/api/uploads/images/${record.id}`;

      if (record.status === 'COMPLETED') {
        const generatedImage = await findGeneratedImage(record.id);
        if (!generatedImage) {
          await db.query(
            `UPDATE image_generations SET status = 'ERROR', error = ? WHERE id = ?`,
            ['Generated image file is missing.', record.id]
          );
          return res.json({
            success: true,
            taskId: record.task_id,
            status: 'ERROR',
            imageUrl: null,
            error: 'Generated image file is missing.'
          });
        }

        return res.json({
          success: true,
          taskId: record.task_id,
          status: 'COMPLETED',
          imageUrl: imageUrlPath,
          error: null
        });
      }

      if (record.status === 'ERROR') {
        return res.json({
          success: true,
          taskId: record.task_id,
          status: 'ERROR',
          imageUrl: null,
          error: record.error || 'Image generation failed.'
        });
      }

      return res.json({
        success: true,
        taskId: record.task_id,
        status: record.status || 'QUEUE',
        imageUrl: null,
        error: null
      });
    } catch (error) {
      console.error('[image-generation] getImageStatus failed:', error instanceof Error ? error.message : String(error));
      return res.status(500).json({ success: false, error: 'Failed to fetch task status.' });
    }
  };

  /**
   * GET /api/images/serve/:taskId — fallback public serve endpoint.
   */
  const serveImage = async (req, res) => {
    const { taskId } = req.params;
    const generatedImage = await findGeneratedImage(taskId);

    if (!generatedImage) {
      return res.status(404).json({ success: false, error: 'Image not found.' });
    }

    res.setHeader('Content-Type', generatedImage.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return fs.createReadStream(generatedImage.fullPath).pipe(res);
  };

  return {
    generateImage,
    getImageStatus,
    serveImage
  };
}

module.exports = { createImageGenerationController };
