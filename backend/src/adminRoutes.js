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
const { createAdminSettingsService } = require('./modules/admin/settings/service');
const { createAdminSettingsRouter } = require('./modules/admin/settings/routes');
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
  const plansRepository = repositories?.plans;
  const supervisedOtpRepository = repositories?.supervisedOtp;

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

  router.get('/subscriptions', requireAdminAuth, async (_req, res) => {
    try {
      const [subscriptions, usersResult] = await Promise.all([
        plansRepository.readUserSubscriptions(),
        analyticsRepository.listUsersWithConversationStats({ page: 1, pageSize: 100 })
      ]);
      const plans = await plansRepository.listPlans();
      const planById = new Map(plans.map((plan) => [plan.id, plan]));
      const userById = new Map((usersResult.items || []).map((user) => [String(user.user_id), user]));
      const userSubscriptions = subscriptions.map((item) => ({
        ...item,
        plan: planById.get(item.planId) || null,
        user: userById.get(String(item.userId)) || null
      }));
      return res.json({
        plans,
        userSubscriptions,
        users: usersResult.items || [],
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'خطا در دریافت اشتراک‌ها' });
    }
  });

  router.put('/subscriptions/plans/:id', requireAdminAuth, async (req, res) => {
    try {
      const planId = String(req.params.id || '').trim();
      const current = await plansRepository.getPlanById(planId);
      if (!current) {
        return res.status(404).json({ error: 'پلن پیدا نشد.' });
      }

      const nextPlan = {
        ...current,
        ...req.body,
        id: planId,
        features: Array.isArray(req.body?.features)
          ? req.body.features
          : typeof req.body?.featuresText === 'string'
            ? req.body.featuresText.split('\n').map((item) => item.trim()).filter(Boolean)
            : current.features
      };
      const savedPlan = await plansRepository.upsertPlan(nextPlan);

      await appendAudit({
        adminUsername: req.admin?.username,
        action: 'update_subscription_plan',
        target: planId,
        details: { name: nextPlan.name, isActive: nextPlan.isActive }
      });

      return res.json({ success: true, plan: savedPlan });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'ذخیره پلن ناموفق بود.' });
    }
  });

  router.patch('/subscriptions/plans/:id/active', requireAdminAuth, async (req, res) => {
    try {
      const planId = String(req.params.id || '').trim();
      const plan = await plansRepository.setPlanActive(planId, Boolean(req.body?.isActive));
      if (!plan) {
        return res.status(404).json({ error: 'پلن پیدا نشد.' });
      }
      await appendAudit({
        adminUsername: req.admin?.username,
        action: 'toggle_subscription_plan',
        target: planId,
        details: { isActive: plan.isActive }
      });
      return res.json({ success: true, plan });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'تغییر وضعیت پلن ناموفق بود.' });
    }
  });

  router.post('/subscriptions/assign', requireAdminAuth, async (req, res) => {
    try {
      const userId = String(req.body?.userId || '').trim();
      const planId = String(req.body?.planId || '').trim();
      const expiresAt = typeof req.body?.expiresAt === 'string' && req.body.expiresAt.trim() ? req.body.expiresAt.trim() : null;
      if (!userId || !planId) {
        return res.status(400).json({ error: 'کاربر و پلن الزامی است.' });
      }

      const user = await usersRepository.getUserFullProfile(userId);
      if (!user) {
        return res.status(404).json({ error: 'کاربر پیدا نشد.' });
      }

      const plan = await plansRepository.getPlanById(planId);
      if (!plan) {
        return res.status(404).json({ error: 'پلن پیدا نشد.' });
      }

      const assignedAt = new Date().toISOString();
      const nextSubscription = {
        userId,
        planId,
        status: 'active',
        assignedAt,
        expiresAt,
        note: typeof req.body?.note === 'string' ? req.body.note.trim() : ''
      };
      const subscriptions = await plansRepository.readUserSubscriptions();
      const userSubscriptions = await plansRepository.writeUserSubscriptions([
        nextSubscription,
        ...subscriptions.filter((item) => String(item.userId) !== userId)
      ]);

      await appendAudit({
        adminUsername: req.admin?.username,
        action: 'assign_subscription',
        target: userId,
        details: { planId, expiresAt }
      });

      return res.json({ success: true, subscription: userSubscriptions.find((item) => item.userId === userId) });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'اختصاص اشتراک ناموفق بود.' });
    }
  });

  router.delete('/subscriptions/users/:userId', requireAdminAuth, async (req, res) => {
    try {
      const userId = String(req.params.userId || '').trim();
      const subscriptions = await plansRepository.readUserSubscriptions();
      const before = subscriptions.length;
      const userSubscriptions = await plansRepository.writeUserSubscriptions(
        subscriptions.filter((item) => String(item.userId) !== userId)
      );

      await appendAudit({
        adminUsername: req.admin?.username,
        action: 'cancel_subscription',
        target: userId,
        details: { removed: before !== userSubscriptions.length }
      });

      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'لغو اشتراک ناموفق بود.' });
    }
  });

  router.get('/supervised-otp', requireAdminAuth, async (_req, res) => {
    try {
      if (!supervisedOtpRepository) return res.status(503).json({ error: 'Supervised OTP repository is not available.' });
      return res.json(await supervisedOtpRepository.getConfig());
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'خطا در دریافت Supervised OTP' });
    }
  });

  router.put('/supervised-otp', requireAdminAuth, async (req, res) => {
    try {
      if (!supervisedOtpRepository) return res.status(503).json({ error: 'Supervised OTP repository is not available.' });
      const config = await supervisedOtpRepository.updateConfig({
        enabled: Boolean(req.body?.enabled),
        code: req.body?.code,
        expires_at: req.body?.expires_at,
        max_uses: req.body?.max_uses
      });
      await appendAudit({
        adminUsername: req.admin?.username,
        action: 'update_supervised_otp',
        target: 'supervised_otp',
        details: {
          enabled: config.enabled,
          hasCode: config.hasCode,
          expires_at: config.expires_at,
          max_uses: config.max_uses
        }
      });
      return res.json(config);
    } catch (error) {
      const statusCode = Number(error?.statusCode || 500);
      return res.status(statusCode).json({ error: error instanceof Error ? error.message : 'ذخیره Supervised OTP ناموفق بود.' });
    }
  });

  router.post('/supervised-otp/reset-used-count', requireAdminAuth, async (req, res) => {
    try {
      if (!supervisedOtpRepository) return res.status(503).json({ error: 'Supervised OTP repository is not available.' });
      const config = await supervisedOtpRepository.resetUsedCount();
      await appendAudit({
        adminUsername: req.admin?.username,
        action: 'reset_supervised_otp_used_count',
        target: 'supervised_otp',
        details: {}
      });
      return res.json(config);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'ریست شمارنده Supervised OTP ناموفق بود.' });
    }
  });

  router.delete('/supervised-otp', requireAdminAuth, async (req, res) => {
    try {
      if (!supervisedOtpRepository) return res.status(503).json({ error: 'Supervised OTP repository is not available.' });
      const config = await supervisedOtpRepository.deleteCode();
      await appendAudit({
        adminUsername: req.admin?.username,
        action: 'delete_supervised_otp',
        target: 'supervised_otp',
        details: {}
      });
      return res.json(config);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'حذف Supervised OTP ناموفق بود.' });
    }
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
    getStats: (...args) => analyticsRepository.getStats(...args),
    getPlanSubscriptions: (...args) => plansRepository.readUserSubscriptions(...args),
    getSupervisedOtpUsage: (...args) => supervisedOtpRepository?.listUsage?.(...args)
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

  const settingsService = createAdminSettingsService({
    settingsRepository: repositories.settings,
    appendAudit
  });
  const settingsRouter = createAdminSettingsRouter({
    settingsService,
    requireAdminAuth
  });

  router.use(analyticsRouter);
  router.use(systemRouter);
  router.use(settingsRouter);
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
