const express = require('express');
const fs = require('fs-extra');
const {
  ADMIN_ROLES,
  createAdminActionLimiter,
  createRequireAdminRole,
  parseBannedFilter,
  maskPhoneNumber
} = require('../common/auth');

const ADMIN_IMAGE_MIME_FALLBACK = 'image/jpeg';
const isSafeRedirectImageUrl = (value) => {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
};

function createAdminUsersRouter({
  requireAdminAuth,
  usersRepository,
  analyticsRepository,
  repositories,
  appendAudit
}) {
  const router = express.Router();

  router.get('/users', requireAdminAuth, async (req, res) => {
    try {
      const { q = '', phone = '', isBanned, page = '1', pageSize = '20' } = req.query;
      const result = await analyticsRepository.listUsersWithConversationStats({
        search: q,
        phone,
        isBanned: parseBannedFilter(isBanned),
        page,
        pageSize
      });
      if (Array.isArray(result?.items)) {
        result.items = result.items.map((item) => ({
          ...item,
          phone: maskPhoneNumber(item.phone, req.admin?.role)
        }));
      }
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'خطا در دریافت کاربران' });
    }
  });

  router.get('/users/:id', requireAdminAuth, async (req, res) => {
    try {
      const profile = await usersRepository.getUserFullProfile(req.params.id);
      if (!profile) {
        return res.status(404).json({ error: 'کاربر پیدا نشد.' });
      }
      if (profile.user) {
        profile.user.phone = maskPhoneNumber(profile.user.phone, req.admin?.role);
      }
      return res.json(profile);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'خطا در دریافت کاربر' });
    }
  });

  router.get('/image-generations', requireAdminAuth, async (req, res) => {
    try {
      const query = String(req.query?.q || '').trim().slice(0, 191);
      const status = String(req.query?.status || '').trim().toUpperCase();
      const page = Math.max(1, Number.parseInt(String(req.query?.page || '1'), 10) || 1);
      const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query?.pageSize || '20'), 10) || 20));
      const offset = (page - 1) * pageSize;
      const allowedStatuses = new Set(['QUEUE', 'WAITING', 'RUNNING', 'COMPLETED', 'ERROR', 'CANCELLED']);
      const filters = ['g.deleted_at IS NULL'];
      const values = [];

      if (status && allowedStatuses.has(status)) {
        filters.push('g.status = ?');
        values.push(status);
      }
      if (query) {
        filters.push('(u.name LIKE ? OR u.phone LIKE ? OR g.original_prompt LIKE ? OR g.prompt LIKE ?)');
        const search = `%${query}%`;
        values.push(search, search, search, search);
      }

      const where = filters.join(' AND ');
      const [countResult, itemsResult] = await Promise.all([
        repositories.db.query(
          `SELECT COUNT(*) AS total
           FROM image_generations g
           INNER JOIN app_users u ON u.user_id = g.user_id
           WHERE ${where}`,
          values
        ),
        repositories.db.query(
          `SELECT g.id, g.task_id, g.user_id, g.original_prompt, g.refined_prompt, g.prompt,
                  g.status, g.operation, g.created_at, g.provider, g.model_admin_value,
                  u.name AS user_name, u.phone AS user_phone, u.age AS user_age
           FROM image_generations g
           INNER JOIN app_users u ON u.user_id = g.user_id
           WHERE ${where}
           ORDER BY g.created_at DESC, g.id DESC
           LIMIT ? OFFSET ?`,
          [...values, pageSize, offset]
        )
      ]);
      const [countRows] = countResult;
      const [items] = itemsResult;
      const totalRow = countRows[0];

      const rows = items.map((item) => ({
        id: String(item.id),
        taskId: item.task_id,
        userId: item.user_id,
        user: {
          name: item.user_name || 'کاربر',
          phone: item.user_phone || null,
          age: item.user_age ?? null
        },
        originalPrompt: item.original_prompt || item.prompt || '',
        apiPrompt: item.refined_prompt || item.prompt || '',
        status: item.status,
        operation: item.operation || 'generate',
        createdAt: item.created_at,
        provider: item.provider || null,
        model: item.model_admin_value || null,
        imageUrl: item.status === 'COMPLETED'
          ? `/api/admin/users/${encodeURIComponent(String(item.user_id))}/images/${encodeURIComponent(String(item.id))}`
          : null
      }));

      return res.json({ items: rows, total: Number(totalRow?.total || 0), page, pageSize });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'خطا در دریافت تصاویر ساخته‌شده' });
    }
  });

  router.get('/users/:id/images/:taskId', requireAdminAuth, async (req, res) => {
    try {
      const userId = String(req.params.id || '').trim();
      const taskId = String(req.params.taskId || '').trim();
      if (!userId || !taskId) {
        return res.status(400).json({ error: 'شناسه کاربر و تصویر الزامی است.' });
      }

      const [rows] = await repositories.db.query(
        `SELECT id, task_id, status, image_url, local_file_path, mime_type
         FROM image_generations
         WHERE (id = ? OR task_id = ?) AND user_id = ?
         LIMIT 1`,
        [taskId, taskId, userId]
      );
      const record = rows[0];
      if (!record) {
        return res.status(404).json({ error: 'تصویر پیدا نشد.' });
      }
      if (record.status !== 'COMPLETED') {
        return res.status(409).json({ error: 'تصویر هنوز آماده نیست.' });
      }

      const localPath = typeof record.local_file_path === 'string' ? record.local_file_path.trim() : '';
      if (localPath && await fs.pathExists(localPath)) {
        const stat = await fs.stat(localPath);
        if (!stat.isFile() || stat.size <= 0) {
          return res.status(404).json({ error: 'فایل تصویر پیدا نشد.' });
        }
        res.type(record.mime_type || ADMIN_IMAGE_MIME_FALLBACK);
        res.setHeader('Cache-Control', 'private, max-age=300');
        return fs.createReadStream(localPath).pipe(res);
      }

      if (isSafeRedirectImageUrl(record.image_url)) {
        return res.redirect(record.image_url);
      }

      return res.status(404).json({ error: 'فایل تصویر پیدا نشد.' });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'خطا در دریافت تصویر' });
    }
  });

  router.patch(
    '/users/:id/ban',
    requireAdminAuth,
    createAdminActionLimiter({ max: 20 }),
    createRequireAdminRole([ADMIN_ROLES.SUPERADMIN, ADMIN_ROLES.ADMIN, ADMIN_ROLES.MODERATOR]),
    async (req, res) => {
      const isBanned = Boolean(req.body?.isBanned);
      const user = await usersRepository.setUserBanStatus(req.params.id, isBanned);
      if (!user) {
        return res.status(404).json({ error: 'کاربر پیدا نشد.' });
      }

      await appendAudit({
        adminUsername: req.admin?.username,
        action: isBanned ? 'ban_user' : 'unban_user',
        target: req.params.id,
        details: { isBanned }
      });

      return res.json({ success: true, user: { ...user, phone: maskPhoneNumber(user.phone, req.admin?.role) } });
    }
  );

  router.delete(
    '/users/:id',
    requireAdminAuth,
    createAdminActionLimiter({ max: 10 }),
    createRequireAdminRole([ADMIN_ROLES.SUPERADMIN]),
    async (req, res) => {
      const result = await usersRepository.deleteUserAndConversations(req.params.id);
      if (!result.deleted) {
        return res.status(404).json({ error: 'کاربر پیدا نشد.' });
      }

      await appendAudit({
        adminUsername: req.admin?.username,
        action: 'delete_user',
        target: req.params.id,
        details: { deletedConversations: result.conversationCount }
      });

      return res.json({ success: true, ...result });
    }
  );

  router.get('/moderation/flagged', requireAdminAuth, async (req, res) => {
    try {
      const [flaggedUsers] = await repositories.db.query(
        `SELECT user_id, name, phone, age, is_banned, created_at, updated_at
         FROM app_users
         WHERE is_banned = 1
         ORDER BY updated_at DESC LIMIT 30`
      ).catch(() => [[]]);

      const [flaggedImages] = await repositories.db.query(
        `SELECT g.id, g.task_id, g.user_id, g.original_prompt, g.prompt, g.status, g.created_at,
                u.name AS user_name, u.phone AS user_phone
         FROM image_generations g
         LEFT JOIN app_users u ON u.user_id = g.user_id
         WHERE g.status IN ('ERROR', 'CANCELLED')
         ORDER BY g.created_at DESC LIMIT 30`
      ).catch(() => [[]]);

      return res.json({
        users: (flaggedUsers || []).map((u) => ({
          user_id: u.user_id,
          name: u.name,
          phone: maskPhoneNumber(u.phone, req.admin?.role),
          age: u.age,
          isBanned: Boolean(u.is_banned),
          createdAt: u.created_at,
          updatedAt: u.updated_at
        })),
        images: (flaggedImages || []).map((img) => ({
          id: String(img.id),
          taskId: img.task_id,
          userId: img.user_id,
          userName: img.user_name || 'کاربر',
          userPhone: maskPhoneNumber(img.user_phone, req.admin?.role),
          prompt: img.original_prompt || img.prompt || '',
          status: img.status,
          createdAt: img.created_at
        }))
      });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'خطا در دریافت موارد پرچم‌گذاری‌شده' });
    }
  });

  return router;
}

module.exports = { createAdminUsersRouter };
