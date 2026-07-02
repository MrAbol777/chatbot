const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const {
  getGuestIdFromUserId,
  isGuestUserId,
  normalizeGuestId
} = require('../../repositories/GuestRepository');
const { generateUserId } = require('../../repositories/helpers');

const GENERATED_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];
const GUEST_COOKIE_NAME = 'danoa_guest_id';
const DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-image';
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
function createImageGenerationController({
  imageGenerationService,
  db,
  plansRepository,
  settingsRepository,
  guestsRepository,
  conversationsRepository,
  eventsRepository,
  imageModelFallback
}) {
  const getImagesDir = () => path.join(__dirname, '../../../uploads/images-generated');

  const normalizeLimitValue = (value) => {
    if (value === null || value === undefined || value === '') return null;
    return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : null;
  };

  const limitFailureMessage = (reason) => {
    if (reason === 'daily') return 'محدودیت روزانه ساخت تصویر تمام شده';
    if (reason === 'hourly') return 'محدودیت ساعتی ساخت تصویر تمام شده';
    return 'ساخت تصویر برای این پلن غیرفعال است';
  };

  const normalizeModelValue = (value) => (typeof value === 'string' ? value.trim() : '');

  const resolveImageModel = async () => {
    let panelModel;
    if (settingsRepository && typeof settingsRepository.getStored === 'function') {
      panelModel = await settingsRepository.getStored('ai.image.model');
    }
    const configuredModel = normalizeModelValue(panelModel);
    if (configuredModel) return configuredModel;

    const envModel = normalizeModelValue(imageModelFallback);
    return envModel || DEFAULT_IMAGE_MODEL;
  };

  const setGuestCookie = (res, guestId) => {
    res.cookie(GUEST_COOKIE_NAME, guestId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 365 * 24 * 60 * 60 * 1000
    });
  };

  const getGuestImageLimits = async () => {
    if (!settingsRepository || typeof settingsRepository.get !== 'function') {
      return { daily: null, hourly: null };
    }
    const [daily, hourly] = await Promise.all([
      settingsRepository.get('guest.image_limit_daily'),
      settingsRepository.get('guest.image_limit_hourly')
    ]);
    return {
      daily: normalizeLimitValue(daily),
      hourly: normalizeLimitValue(hourly)
    };
  };

  const resolveUserContext = async (req, res) => {
    const authenticatedUserId = typeof req.user?.id === 'string' ? req.user.id.trim() : '';
    if (authenticatedUserId && !isGuestUserId(authenticatedUserId)) {
      return { userId: authenticatedUserId, isGuest: false, guestId: '' };
    }

    const existingGuestId = normalizeGuestId(req.cookies?.[GUEST_COOKIE_NAME] || getGuestIdFromUserId(authenticatedUserId));
    const guestId = existingGuestId || getGuestIdFromUserId(generateUserId({ isGuest: true }));
    if (!existingGuestId) {
      setGuestCookie(res, guestId);
    }

    if (!guestsRepository || typeof guestsRepository.ensureGuestUser !== 'function') {
      return { userId: generateUserId({ isGuest: true, uuid: guestId }), isGuest: true, guestId };
    }

    const guestUserId = await guestsRepository.ensureGuestUser(guestId);
    return { userId: guestUserId, isGuest: true, guestId };
  };

  const checkGuestImageLimits = async (userId) => {
    const limits = await getGuestImageLimits();
    if (limits.daily === 0 || limits.hourly === 0) {
      return { allowed: false, reason: 'disabled', plan: null, limits, limit: 0, usage: { daily: null, hourly: null } };
    }
    if (!plansRepository) {
      return { allowed: true, plan: null, limits, limit: null, usage: { daily: null, hourly: null } };
    }

    const dailyUsage =
      limits.daily === null || typeof plansRepository.getDailyUsage !== 'function'
        ? null
        : await plansRepository.getDailyUsage(userId);
    if (dailyUsage && Number(dailyUsage.imageCount || 0) >= limits.daily) {
      return {
        allowed: false,
        reason: 'daily',
        plan: null,
        limits,
        limit: limits.daily,
        usage: { daily: dailyUsage, hourly: null },
        remaining: 0
      };
    }

    const hourlyUsage =
      limits.hourly === null || typeof plansRepository.getHourlyUsage !== 'function'
        ? null
        : await plansRepository.getHourlyUsage(userId);
    if (hourlyUsage && Number(hourlyUsage.imageCount || 0) >= limits.hourly) {
      return {
        allowed: false,
        reason: 'hourly',
        plan: null,
        limits,
        limit: limits.hourly,
        usage: { daily: dailyUsage, hourly: hourlyUsage },
        remaining: 0
      };
    }

    return {
      allowed: true,
      plan: null,
      limits,
      limit: null,
      usage: { daily: dailyUsage, hourly: hourlyUsage },
      remaining: {
        daily: dailyUsage && limits.daily !== null ? Math.max(0, limits.daily - Number(dailyUsage.imageCount || 0)) : null,
        hourly: hourlyUsage && limits.hourly !== null ? Math.max(0, limits.hourly - Number(hourlyUsage.imageCount || 0)) : null
      }
    };
  };

  const resolveImageLimitState = async ({ userId, isGuest }) => {
    if (isGuest) {
      return checkGuestImageLimits(userId);
    }
    if (plansRepository && typeof plansRepository.checkImageLimits === 'function') {
      return plansRepository.checkImageLimits(userId);
    }
    if (plansRepository && typeof plansRepository.checkLimit === 'function') {
      return plansRepository.checkLimit(userId, 'image');
    }
    return { allowed: true, plan: null, limits: { daily: null, hourly: null }, usage: { daily: null, hourly: null } };
  };

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

  const runGenerationTask = async ({ dbRecordId, prompt, imageModel, userId }) => {
    try {
      await db.query(`UPDATE image_generations SET status = 'RUNNING' WHERE id = ?`, [dbRecordId]);

      const image = await imageGenerationService.generateImage(prompt, { imageModel });
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
      if (eventsRepository && typeof eventsRepository.logEvent === 'function') {
        await eventsRepository.logEvent(userId, 'image_generation_completed', 'image_generation', {
          taskId: String(dbRecordId),
          model: image.model
        });
      }
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
        if (eventsRepository && typeof eventsRepository.logEvent === 'function') {
          await eventsRepository.logEvent(userId, 'image_generation_failed', 'image_generation', {
            taskId: String(dbRecordId),
            error: message
          });
        }
      } catch (dbError) {
        console.error('[image-generation] failed to persist task error', {
          dbRecordId,
          message: dbError instanceof Error ? dbError.message : String(dbError)
        });
      }
    }
  };

  const createImageTask = async (req, res, { prompt }) => {
    const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
    if (!normalizedPrompt) {
      const error = new Error('Prompt is required.');
      error.statusCode = 400;
      error.publicPayload = { success: false, error: 'Prompt is required.' };
      throw error;
    }

    const { userId, isGuest, guestId } = await resolveUserContext(req, res);
    if (!userId) {
      const error = new Error('Authentication required.');
      error.statusCode = 401;
      error.publicPayload = { success: false, error: 'Authentication required.' };
      throw error;
    }

    const limitState = await resolveImageLimitState({ userId, isGuest });
    if (!limitState.allowed) {
      const error = new Error(limitFailureMessage(limitState.reason || 'daily'));
      error.userId = userId;
      error.statusCode = isGuest ? 403 : 402;
      error.publicPayload = {
        success: false,
        error: limitState.reason === 'disabled' ? 'IMAGE_GENERATION_DISABLED' : 'IMAGE_LIMIT_REACHED',
        reason: limitState.reason || 'daily',
        message: limitFailureMessage(limitState.reason || 'daily'),
        plan: limitState.plan?.id || null,
        limits: limitState.limits || null,
        limit: limitState.limit,
        usage: limitState.usage
      };
      throw error;
    }

    const providerTaskId = `gemini-${uuidv4()}`;
    const imageModel = await resolveImageModel();
    const [insertResult] = await db.query(
      `INSERT INTO image_generations (user_id, task_id, prompt, status)
       VALUES (?, ?, ?, 'QUEUE')`,
      [userId, providerTaskId, normalizedPrompt]
    );
    const dbRecordId = insertResult.insertId;
    const taskId = String(dbRecordId);

    if (plansRepository && typeof plansRepository.incrementUsage === 'function') {
      await plansRepository.incrementUsage(userId, 'image', 1);
    } else if (plansRepository && typeof plansRepository.incrementDailyUsage === 'function') {
      await plansRepository.incrementDailyUsage(userId, 'image', 1);
    }

    console.log('[image-generation] task created', {
      taskId,
      providerTaskId,
      userId,
      promptLength: normalizedPrompt.length
    });

    setImmediate(() => {
      void runGenerationTask({ dbRecordId, prompt: normalizedPrompt, imageModel, userId });
    });

    return {
      userId,
      isGuest,
      guestId,
      taskId,
      providerTaskId,
      status: 'QUEUE',
      imageUrl: null
    };
  };

  /**
   * POST /api/images/generate
   */
  const generateImage = async (req, res) => {
    try {
      const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
      const task = await createImageTask(req, res, { prompt });

      return res.status(202).json({
        success: true,
        taskId: task.taskId,
        message: 'Image generation started.'
      });
    } catch (error) {
      console.error('[image-generation] generateImage failed:', error instanceof Error ? error.message : String(error));
      return res.status(error?.statusCode || 500).json(error?.publicPayload || {
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
      const { userId } = await resolveUserContext(req, res);

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
      const imageUrlPath = `/api/images/result/${record.id}`;

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

        if (conversationsRepository && typeof conversationsRepository.updateImageTaskMessage === 'function') {
          await conversationsRepository.updateImageTaskMessage(userId, req.query?.conversationId, String(record.id), {
            type: 'image_result',
            content: 'تصویر آماده شد.',
            status: 'COMPLETED',
            images: [{ url: imageUrlPath, alt: record.prompt || 'تصویر ساخته شده' }]
          });
        }

        return res.json({
          success: true,
          taskId: String(record.id),
          status: 'COMPLETED',
          imageUrl: imageUrlPath,
          error: null
        });
      }

      if (record.status === 'ERROR') {
        if (conversationsRepository && typeof conversationsRepository.updateImageTaskMessage === 'function') {
          await conversationsRepository.updateImageTaskMessage(userId, req.query?.conversationId, String(record.id), {
            type: 'image_error',
            content: 'ساخت تصویر انجام نشد. مشکل از سرویس تصویر بود، نه درخواست تو. دوباره امتحان کن.',
            status: 'ERROR',
            images: undefined
          });
        }
        return res.json({
          success: true,
          taskId: String(record.id),
          status: 'ERROR',
          imageUrl: null,
          error: record.error || 'Image generation failed.'
        });
      }

      return res.json({
        success: true,
        taskId: String(record.id),
        status: record.status || 'QUEUE',
        imageUrl: null,
        error: null
      });
    } catch (error) {
      console.error('[image-generation] getImageStatus failed:', error instanceof Error ? error.message : String(error));
      return res.status(500).json({ success: false, error: 'Failed to fetch task status.' });
    }
  };

  const getImageResult = async (req, res) => {
    try {
      const { taskId } = req.params;
      const { userId } = await resolveUserContext(req, res);
      if (!taskId || !userId) {
        return res.status(400).json({ success: false, error: 'taskId is required.' });
      }

      const [rows] = await db.query(
        `SELECT id, task_id, status, image_url
         FROM image_generations
         WHERE (id = ? OR task_id = ?) AND user_id = ?
         LIMIT 1`,
        [taskId, taskId, userId]
      );
      if (rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Task not found.' });
      }

      const record = rows[0];
      if (record.status !== 'COMPLETED') {
        return res.status(409).json({ success: false, error: 'Image is not ready.' });
      }

      const generatedImage = await findGeneratedImage(record.id);
      if (!generatedImage) {
        return res.status(404).json({ success: false, error: 'Image not found.' });
      }

      res.setHeader('Content-Type', generatedImage.mimeType);
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return fs.createReadStream(generatedImage.fullPath).pipe(res);
    } catch (error) {
      console.error('[image-generation] getImageResult failed:', error instanceof Error ? error.message : String(error));
      return res.status(500).json({ success: false, error: 'Failed to fetch image.' });
    }
  };

  /**
   * GET /api/images/serve/:taskId — fallback public serve endpoint.
   */
  const serveImage = async (req, res) => {
    return res.status(410).json({ success: false, error: 'Use /api/images/result/:taskId.' });
  };

  return {
    createImageTask,
    resolveUserContext,
    generateImage,
    getImageStatus,
    getImageResult,
    serveImage
  };
}

module.exports = { createImageGenerationController };
