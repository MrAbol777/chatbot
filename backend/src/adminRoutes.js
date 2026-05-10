const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const {
  readDB,
  listUsersWithConversationStats,
  setUserBanStatus,
  deleteUserAndConversations,
  getUserFullProfile,
  getTotalUsers,
  getActiveUsersToday,
  getApiCallsToday,
  getErrorCountToday,
  getUserGrowth,
  getApiUsage,
  getErrorDistribution,
  getRecentAuditLogs
} = require('../db');

const ADMIN_FILE_PATH = path.join(__dirname, '../admin.json');
const CONFIG_FILE_PATH = path.join(__dirname, '../config.json');
const AUDIT_LOG_PATH = path.join(__dirname, '../audit.log');

const DEFAULT_CONFIG = {
  model: 'gemini-2.0-flash',
  timeoutMs: 30000,
  features: {
    voiceInput: true,
    quickChips: true,
    practiceMode: true
  }
};

const now = () => new Date().toISOString();

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
  await fs.ensureFile(CONFIG_FILE_PATH);
  const raw = await fs.readFile(CONFIG_FILE_PATH, 'utf8');
  if (!raw.trim()) {
    await fs.writeJson(CONFIG_FILE_PATH, DEFAULT_CONFIG, { spaces: 2 });
    return DEFAULT_CONFIG;
  }

  const parsed = JSON.parse(raw);
  return {
    model: typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model.trim() : DEFAULT_CONFIG.model,
    timeoutMs: Number.isFinite(Number(parsed.timeoutMs)) ? Number(parsed.timeoutMs) : DEFAULT_CONFIG.timeoutMs,
    features: {
      voiceInput: Boolean(parsed.features?.voiceInput),
      quickChips: Boolean(parsed.features?.quickChips),
      practiceMode: Boolean(parsed.features?.practiceMode)
    }
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

const createAdminRouter = ({ jwtSecret, cookieName = 'admin_token' }) => {
  const router = express.Router();

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

  router.get('/users', requireAdminAuth, (req, res) => {
    const { q = '', phone = '', isBanned, page = '1', pageSize = '20' } = req.query;
    const result = listUsersWithConversationStats({
      search: q,
      phone,
      isBanned: parseBannedFilter(isBanned),
      page,
      pageSize
    });
    return res.json(result);
  });

  router.get('/dashboard/stats', requireAdminAuth, (_req, res) => {
    return res.json({
      kpis: {
        totalUsers: getTotalUsers(),
        activeUsersToday: getActiveUsersToday(),
        apiCallsToday: getApiCallsToday(),
        errorCountToday: getErrorCountToday()
      },
      userGrowth: getUserGrowth(7),
      apiUsage: getApiUsage(7),
      errorDistribution: getErrorDistribution(),
      recentActivities: getRecentAuditLogs(10)
    });
  });

  router.get('/users/:id', requireAdminAuth, (req, res) => {
    const profile = getUserFullProfile(req.params.id);
    if (!profile) {
      return res.status(404).json({ error: 'کاربر پیدا نشد.' });
    }
    return res.json(profile);
  });

  router.patch('/users/:id/ban', requireAdminAuth, async (req, res) => {
    const isBanned = Boolean(req.body?.isBanned);
    const user = setUserBanStatus(req.params.id, isBanned);
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
    const result = deleteUserAndConversations(req.params.id);
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

  router.get('/errors', requireAdminAuth, (req, res) => {
    const { errorType = '', from = '', to = '' } = req.query;
    const data = readDB();
    let errors = Array.isArray(data.errors) ? data.errors : [];

    if (typeof errorType === 'string' && errorType.trim()) {
      errors = errors.filter((item) => String(item.error_type || '') === errorType.trim());
    }

    if (typeof from === 'string' && from.trim()) {
      const fromDate = new Date(from).getTime();
      if (!Number.isNaN(fromDate)) {
        errors = errors.filter((item) => new Date(item.created_at || 0).getTime() >= fromDate);
      }
    }

    if (typeof to === 'string' && to.trim()) {
      const toDate = new Date(to).getTime();
      if (!Number.isNaN(toDate)) {
        errors = errors.filter((item) => new Date(item.created_at || 0).getTime() <= toDate);
      }
    }

    errors.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    return res.json({ items: errors });
  });

  router.get('/config', requireAdminAuth, async (_req, res) => {
    const config = await ensureConfigData();
    return res.json(config);
  });

  router.put('/config', requireAdminAuth, async (req, res) => {
    const current = await ensureConfigData();
    const nextConfig = {
      model: typeof req.body?.model === 'string' && req.body.model.trim() ? req.body.model.trim() : current.model,
      timeoutMs: Number.isFinite(Number(req.body?.timeoutMs)) ? Number(req.body.timeoutMs) : current.timeoutMs,
      features: {
        voiceInput: Boolean(req.body?.features?.voiceInput),
        quickChips: Boolean(req.body?.features?.quickChips),
        practiceMode: Boolean(req.body?.features?.practiceMode)
      }
    };

    await fs.writeJson(CONFIG_FILE_PATH, nextConfig, { spaces: 2 });
    await appendAudit({
      adminUsername: req.admin?.username,
      action: 'update_config',
      target: 'config',
      details: {
        modelBefore: current.model,
        modelAfter: nextConfig.model,
        timeoutMsBefore: current.timeoutMs,
        timeoutMsAfter: nextConfig.timeoutMs
      }
    });

    if (current.model !== nextConfig.model) {
      await appendAudit({
        adminUsername: req.admin?.username,
        action: 'change_model',
        target: 'model',
        details: { from: current.model, to: nextConfig.model }
      });
    }

    return res.json({ success: true, config: nextConfig });
  });

  router.get('/reports/csv', requireAdminAuth, (req, res) => {
    const includeUsers = req.query.users === '1';
    const includeErrors = req.query.errors === '1';
    const includeConversationSummary = req.query.conversations === '1';
    const data = readDB();
    const lines = [];

    if (includeUsers) {
      lines.push('USERS');
      lines.push('name,age,phone,registered_at,conversation_count');
      const byUser = new Map();
      for (const c of data.conversations || []) {
        const key = String(c.user_id || '');
        byUser.set(key, (byUser.get(key) || 0) + 1);
      }
      for (const user of data.users || []) {
        lines.push(
          [user.name || '', user.age || '', user.phone || '', user.registered_at || '', byUser.get(String(user.user_id)) || 0]
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(',')
        );
      }
      lines.push('');
    }

    if (includeErrors) {
      lines.push('ERRORS');
      lines.push('type,endpoint,status_code,message,time');
      for (const item of data.errors || []) {
        lines.push(
          [item.error_type || '', item.endpoint || '', item.status_code || '', item.details || '', item.created_at || '']
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(',')
        );
      }
      lines.push('');
    }

    if (includeConversationSummary) {
      let total = 0;
      let academic = 0;
      let emotional = 0;
      let creative = 0;
      for (const event of data.events || []) {
        if (event.event_type === 'message_sent') {
          total += 1;
          if (event.category === 'academic') academic += 1;
          if (event.category === 'emotional') emotional += 1;
          if (event.category === 'creative') creative += 1;
        }
      }

      lines.push('CONVERSATION_SUMMARY');
      lines.push('total_messages,academic,emotional,creative');
      lines.push([total, academic, emotional, creative].join(','));
      lines.push('');
    }

    const csv = lines.join('\n');
    const fileName = `admin-report-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.send(`\uFEFF${csv}`);
  });

  router.get('/audit-logs', requireAdminAuth, async (req, res) => {
    const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize || '20'), 10) || 20));
    const logs = await readAuditLogs();
    const start = (page - 1) * pageSize;
    const items = logs.slice(start, start + pageSize);

    return res.json({
      items,
      total: logs.length,
      page,
      pageSize
    });
  });

  return { router, requireAdminAuth, ensureAdminData, ensureConfigData };
};

module.exports = {
  createAdminRouter,
  ensureConfigData,
  ensureAdminData
};
