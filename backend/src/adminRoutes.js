const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const { createAdminAnalyticsService } = require('./modules/admin/analytics/service');
const { createAdminAnalyticsRouter } = require('./modules/admin/analytics/routes');
const { createAdminSystemService } = require('./modules/admin/system/service');
const { createAdminSystemRouter } = require('./modules/admin/system/routes');
const { createAdminLogsService } = require('./modules/admin/logs/service');
const { createAdminLogsRouter } = require('./modules/admin/logs/routes');

const ADMIN_FILE_PATH = path.join(__dirname, '../admin.json');
const CONFIG_FILE_PATH = path.join(__dirname, '../config.json');
const AUDIT_LOG_PATH = path.join(__dirname, '../audit.log');
const SYSTEM_PROMPT_PATH = path.join(__dirname, '../system-prompt.txt');

const DEFAULT_CONFIG = {
  model: 'gpt-4o-mini',
  timeoutMs: 30000,
  features: {
    voiceInput: true,
    quickChips: true,
    practiceMode: true
  }
};

const now = () => new Date().toISOString();
const getDefaultSystemPrompt = async () => (await fs.readFile(SYSTEM_PROMPT_PATH, 'utf8')).trim();

const ensureAdminData = async () => {
  await fs.ensureFile(ADMIN_FILE_PATH);
  const raw = await fs.readFile(ADMIN_FILE_PATH, 'utf8');
  if (!raw.trim()) {
    const password_hash = await bcrypt.hash('admin123', 10);
    const seed = [
      {
        id: '1',
        username: 'admin',
        password_hash,
        role: 'superadmin',
        createdAt: now()
      }
    ];
    await fs.writeJson(ADMIN_FILE_PATH, seed, { spaces: 2 });
    return seed;
  }

  const admins = JSON.parse(raw);
  if (!Array.isArray(admins) || admins.length === 0) {
    const password_hash = await bcrypt.hash('admin123', 10);
    const seed = [
      {
        id: '1',
        username: 'admin',
        password_hash,
        role: 'superadmin',
        createdAt: now()
      }
    ];
    await fs.writeJson(ADMIN_FILE_PATH, seed, { spaces: 2 });
    return seed;
  }
  return admins;
};

const ensureConfigData = async () => {
  const defaultSystemPrompt = await getDefaultSystemPrompt();
  await fs.ensureFile(CONFIG_FILE_PATH);
  const raw = await fs.readFile(CONFIG_FILE_PATH, 'utf8');
  if (!raw.trim()) {
    const seedConfig = { ...DEFAULT_CONFIG, systemPrompt: defaultSystemPrompt };
    await fs.writeJson(CONFIG_FILE_PATH, seedConfig, { spaces: 2 });
    return seedConfig;
  }

  const parsed = JSON.parse(raw);
  return {
    model: typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model.trim() : DEFAULT_CONFIG.model,
    timeoutMs: Number.isFinite(Number(parsed.timeoutMs)) ? Number(parsed.timeoutMs) : DEFAULT_CONFIG.timeoutMs,
    features: {
      voiceInput: Boolean(parsed.features?.voiceInput),
      quickChips: Boolean(parsed.features?.quickChips),
      practiceMode: Boolean(parsed.features?.practiceMode)
    },
    systemPrompt:
      typeof parsed.systemPrompt === 'string' && parsed.systemPrompt.trim()
        ? parsed.systemPrompt.trim()
        : defaultSystemPrompt
  };
};

const readAuditLogs = async () => {
  await fs.ensureFile(AUDIT_LOG_PATH);
  const raw = await fs.readFile(AUDIT_LOG_PATH, 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_error) {
        return null;
      }
    })
    .filter(Boolean)
    .reverse();
};

const appendAudit = async ({ adminUsername, action, target, details }) => {
  await fs.ensureFile(AUDIT_LOG_PATH);
  const entry = {
    timestamp: now(),
    adminUsername: adminUsername || 'unknown',
    action,
    target: target || null,
    details: details || {}
  };
  await fs.appendFile(AUDIT_LOG_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
};

const parseBannedFilter = (value) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
};

function createAdminModule({ jwtSecret, cookieName = 'admin_token', onSystemPromptUpdated, adminApiKey = '', repositories }) {
  const router = express.Router();
  const isSystemPromptEditEnabled = () => process.env.ENABLE_SYSTEM_PROMPT_EDIT !== 'false';
  const usersRepository = repositories?.users;
  const analyticsRepository = repositories?.analytics;

  const loginLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'تعداد تلاش برای ورود زیاد است. لطفا یک دقیقه دیگر تلاش کنید.' }
  });

  const requireAdminAuth = (req, res, next) => {
    const token = req.cookies?.[cookieName];
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const payload = jwt.verify(token, jwtSecret);
      req.admin = payload;
      return next();
    } catch (_error) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  };

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
