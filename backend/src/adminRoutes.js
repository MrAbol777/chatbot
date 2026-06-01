const express = require('express');
const fs = require('fs-extra');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { createAdminAnalyticsService } = require('./modules/admin/analytics/service');
const { createAdminAnalyticsRouter } = require('./modules/admin/analytics/routes');
const { createAdminSystemService } = require('./modules/admin/system/service');
const { createAdminSystemRouter } = require('./modules/admin/system/routes');
const { createAdminLogsService } = require('./modules/admin/logs/service');
const { createAdminLogsRouter } = require('./modules/admin/logs/routes');
const { createLoginLimiter, createRequireAdminAuth, parseBannedFilter } = require('./modules/admin/common/auth');
const {
  CONFIG_FILE_PATH,
  DEFAULT_CONFIG,
  ensureAdminData,
  ensureConfigData,
  readAuditLogs,
  appendAudit
} = require('./modules/admin/common/storage');

function createAdminModule({ jwtSecret, cookieName = 'admin_token', onSystemPromptUpdated, adminApiKey = '', repositories }) {
  const router = express.Router();
  const isSystemPromptEditEnabled = () => process.env.ENABLE_SYSTEM_PROMPT_EDIT !== 'false';
  const usersRepository = repositories?.users;
  const analyticsRepository = repositories?.analytics;

  const loginLimiter = createLoginLimiter();
  const requireAdminAuth = createRequireAdminAuth({
    cookieName,
    jwtSecret
  });

  router.post('/login', loginLimiter, async (req, res) => {
    try {
      const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';

      if (!username || !password) {
        return res.status(400).json({ error: 'نام کاربری یا رمز عبور نامعتبر است.' });
      }

      const admins = await ensureAdminData();
      const admin = admins.find((item) => item.username === username);
      if (!admin) {
        return res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است.' });
      }

      const ok = await bcrypt.compare(password, admin.password_hash);
      if (!ok) {
        return res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است.' });
      }

      const token = jwt.sign(
        {
          id: admin.id,
          username: admin.username,
          role: admin.role
        },
        jwtSecret,
        { expiresIn: '8h' }
      );

      res.cookie(cookieName, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 8 * 60 * 60 * 1000
      });

      await appendAudit({
        adminUsername: admin.username,
        action: 'admin_login',
        target: admin.id,
        details: { role: admin.role }
      });

      return res.json({
        success: true,
        admin: { username: admin.username, role: admin.role }
      });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'خطا در ورود ادمین' });
    }
  });

  router.post('/logout', requireAdminAuth, async (req, res) => {
    res.clearCookie(cookieName);
    await appendAudit({
      adminUsername: req.admin?.username,
      action: 'admin_logout',
      target: req.admin?.id,
      details: {}
    });
    return res.json({ success: true });
  });

  router.get('/me', requireAdminAuth, (req, res) => {
    return res.json({ admin: req.admin });
  });

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
      return res.json(profile);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'خطا در دریافت کاربر' });
    }
  });

  router.patch('/users/:id/ban', requireAdminAuth, async (req, res) => {
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

    return res.json({ success: true, user });
  });

  router.delete('/users/:id', requireAdminAuth, async (req, res) => {
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
  });

  const analyticsService = createAdminAnalyticsService({
    analyticsRepository: { readDB: (...args) => analyticsRepository.readDB(...args) },
    getTotalUsers: (...args) => analyticsRepository.getTotalUsers(...args),
    getActiveUsersToday: (...args) => analyticsRepository.getActiveUsersToday(...args),
    getApiCallsToday: (...args) => analyticsRepository.getApiCallsToday(...args),
    getErrorCountToday: (...args) => analyticsRepository.getErrorCountToday(...args),
    getUserGrowth: (...args) => analyticsRepository.getUserGrowth(...args),
    getApiUsage: (...args) => analyticsRepository.getApiUsage(...args),
    getErrorDistribution: (...args) => analyticsRepository.getErrorDistribution(...args),
    getRecentAuditLogs: (...args) => analyticsRepository.getRecentAuditLogs(...args),
    getStats: (...args) => analyticsRepository.getStats(...args)
  });
  const analyticsRouter = createAdminAnalyticsRouter({
    analyticsService,
    adminApiKey,
    requireAdminAuth
  });

  const systemService = createAdminSystemService({
    ensureConfigData,
    fileStore: fs,
    configFilePath: CONFIG_FILE_PATH,
    appendAudit,
    isSystemPromptEditEnabled,
    onSystemPromptUpdated,
    defaultConfig: DEFAULT_CONFIG,
    readJson: fs.readJson,
    writeJson: fs.writeJson
  });
  const systemRouter = createAdminSystemRouter({
    systemService,
    requireAdminAuth
  });

  const logsService = createAdminLogsService({
    readDB: (...args) => analyticsRepository.readDB(...args),
    readAuditLogs
  });
  const logsRouter = createAdminLogsRouter({
    logsService,
    requireAdminAuth
  });

  router.use(analyticsRouter);
  router.use(systemRouter);
  router.use(logsRouter);

  return {
    router,
    requireAdminAuth,
    ensureAdminData,
    ensureConfigData
  };
}

function createAdminRouter(deps) {
  return createAdminModule(deps);
}

module.exports = {
  createAdminModule,
  createAdminRouter,
  ensureConfigData,
  ensureAdminData
};
