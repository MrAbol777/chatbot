const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { createRequirePrincipal } = require('../auth/principal');

const uploadRoot = path.resolve(__dirname, '../../../uploads/broadcasts');
const allowedImageTypes = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp']
]);

const imageStorage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadRoot),
  filename: (_req, file, callback) => callback(null, `${uuidv4()}${allowedImageTypes.get(file.mimetype) || '.bin'}`)
});

const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(null, allowedImageTypes.has(file.mimetype))
});

const sendError = (res, error) => {
  const code = error instanceof Error ? error.message : String(error);
  const messages = {
    MESSAGE_REQUIRED: 'متن پیام الزامی است.',
    MESSAGE_TOO_LONG: 'متن پیام بیش از حد طولانی است.',
    INVALID_AUDIENCE_TYPE: 'نوع گیرندگان نامعتبر است.',
    INVALID_DISPLAY_MODE: 'نوع نمایش پیام نامعتبر است.',
    INVALID_PRIORITY: 'اولویت پیام نامعتبر است.',
    ONE_USER_REQUIRED: 'برای پیام تک‌کاربره دقیقاً یک کاربر انتخاب کنید.',
    USERS_REQUIRED: 'حداقل یک کاربر انتخاب کنید.',
    ALL_USERS_CANNOT_HAVE_IDS: 'برای ارسال به همه، شناسه کاربر ارسال نکنید.',
    INVALID_SCHEDULE_DATE: 'تاریخ زمان‌بندی نامعتبر است.',
    INVALID_EXPIRY_DATE: 'تاریخ انقضا نامعتبر است.',
    SCHEDULE_MUST_BE_FUTURE: 'زمان‌بندی باید در آینده باشد.',
    EXPIRY_MUST_BE_AFTER_SCHEDULE: 'تاریخ انقضا باید بعد از زمان ارسال باشد.',
    SCHEDULE_DATE_REQUIRED: 'برای ارسال زمان‌بندی‌شده، تاریخ و ساعت را مشخص کنید.',
    USE_SCHEDULED_FOR_FUTURE: 'برای زمان آینده، حالت زمان‌بندی‌شده را انتخاب کنید.'
  };
  const known = messages[code];
  return res.status(400).json({ error: known || 'BROADCAST_MESSAGE_FAILED', message: known || 'عملیات پیام انجام نشد.' });
};

function createAdminBroadcastMessagesRouter({ requireAdminAuth, repository, appendAudit }) {
  const router = express.Router();
  fs.ensureDirSync(uploadRoot);

  router.get('/broadcast-messages/users', requireAdminAuth, async (req, res, next) => {
    try {
      return res.json(await repository.listUsers({
        page: req.query.page,
        pageSize: req.query.pageSize,
        query: req.query.q
      }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/broadcast-messages/upload-image', requireAdminAuth, (req, res) => {
    uploadImage.single('image')(req, res, (error) => {
      if (error || !req.file) {
        return res.status(400).json({ error: 'INVALID_IMAGE', message: 'تصویر معتبر نیست یا حجم آن بیش از ۵ مگابایت است.' });
      }
      return res.json({ imageUrl: `/api/notifications/assets/${encodeURIComponent(req.file.filename)}` });
    });
  });

  router.get('/broadcast-messages', requireAdminAuth, async (req, res, next) => {
    try {
      return res.json(await repository.list({ page: req.query.page, pageSize: req.query.pageSize, status: req.query.status, query: req.query.q }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/broadcast-messages', requireAdminAuth, async (req, res, next) => {
    try {
      const input = { ...req.body };
      input.status = input.sendMode === 'now' ? 'published' : input.sendMode === 'scheduled' ? 'scheduled' : 'draft';
      const result = await repository.create(input, req.admin?.username);
      await appendAudit({
        adminUsername: req.admin?.username,
        action: 'broadcast_message_created',
        target: result.id,
        details: { status: result.status, audienceType: input.audienceType, recipientCount: result.recipientCount }
      });
      return res.status(201).json(result);
    } catch (error) {
      if (String(error?.code || '').startsWith('ER_NO_REFERENCED_ROW')) {
        return res.status(400).json({ error: 'ADMIN_NOT_FOUND', message: 'ادمین سازنده پیام معتبر نیست.' });
      }
      if (String(error?.code || '').startsWith('ER_DUP_ENTRY')) {
        return res.status(409).json({ error: 'DUPLICATE_MESSAGE', message: 'ثبت پیام تکراری است.' });
      }
      if (['MESSAGE_REQUIRED', 'MESSAGE_TOO_LONG', 'INVALID_AUDIENCE_TYPE', 'INVALID_DISPLAY_MODE', 'INVALID_PRIORITY', 'ONE_USER_REQUIRED', 'USERS_REQUIRED', 'ALL_USERS_CANNOT_HAVE_IDS', 'INVALID_SCHEDULE_DATE', 'INVALID_EXPIRY_DATE', 'SCHEDULE_MUST_BE_FUTURE', 'EXPIRY_MUST_BE_AFTER_SCHEDULE', 'SCHEDULE_DATE_REQUIRED', 'USE_SCHEDULED_FOR_FUTURE'].includes(error?.message)) {
        return sendError(res, error);
      }
      return next(error);
    }
  });

  router.get('/broadcast-messages/:id', requireAdminAuth, async (req, res, next) => {
    try {
      const item = await repository.getById(req.params.id);
      return item ? res.json(item) : res.status(404).json({ error: 'NOT_FOUND', message: 'پیام پیدا نشد.' });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/broadcast-messages/:id/stats', requireAdminAuth, async (req, res, next) => {
    try {
      return res.json(await repository.getStats(req.params.id));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/broadcast-messages/:id/cancel', requireAdminAuth, async (req, res, next) => {
    try {
      const cancelled = await repository.cancel(req.params.id);
      if (!cancelled) return res.status(409).json({ error: 'CANNOT_CANCEL', message: 'این پیام دیگر قابل لغو نیست.' });
      await appendAudit({ adminUsername: req.admin?.username, action: 'broadcast_message_cancelled', target: req.params.id, details: {} });
      return res.json({ success: true });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/broadcast-messages/:id', requireAdminAuth, async (req, res, next) => {
    try {
      const removed = await repository.remove(req.params.id);
      if (!removed) return res.status(409).json({ error: 'CANNOT_DELETE', message: 'فقط پیش‌نویس یا پیام لغوشده قابل حذف است.' });
      await appendAudit({ adminUsername: req.admin?.username, action: 'broadcast_message_deleted', target: req.params.id, details: {} });
      return res.json({ success: true });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

function createUserBroadcastMessagesRouter({ principalResolver, repository }) {
  const router = express.Router();
  const requirePrincipal = createRequirePrincipal(principalResolver);

  router.get('/api/notifications/assets/:fileName', async (req, res) => {
    const fileName = String(req.params.fileName || '');
    if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(fileName)) return res.status(404).end();
    const filePath = path.join(uploadRoot, fileName);
    return res.sendFile(filePath, (error) => {
      if (error && !res.headersSent) res.status(error.statusCode || 404).end();
    });
  });

  router.get('/api/notifications', requirePrincipal, async (req, res, next) => {
    try {
      return res.json({ items: await repository.listForUser(req.authPrincipal.userId, req.query.limit) });
    } catch (error) {
      return next(error);
    }
  });

  const action = (field) => async (req, res, next) => {
    try {
      await repository.mark(req.params.id, req.authPrincipal.userId, field);
      return res.json({ success: true });
    } catch (error) {
      return next(error);
    }
  };

  router.post('/api/notifications/:id/view', requirePrincipal, action('viewed_at'));
  router.post('/api/notifications/:id/dismiss', requirePrincipal, action('dismissed_at'));
  router.post('/api/notifications/:id/acknowledge', requirePrincipal, action('acknowledged_at'));
  router.post('/api/notifications/:id/click', requirePrincipal, action('clicked_at'));

  return router;
}

module.exports = { createAdminBroadcastMessagesRouter, createUserBroadcastMessagesRouter, uploadRoot };
