const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { buildAdminStateFingerprint, hashAdminSessionId } = require('../common/auth');

function createAdminAuthRouter({
  jwtSecret,
  cookieName,
  loginLimiter,
  requireAdminAuth,
  ensureAdminData,
  appendAudit,
  revokeAdminSession
}) {
  const router = express.Router();
  if (typeof revokeAdminSession !== 'function') {
    throw new Error('revokeAdminSession is required');
  }

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

      const sessionId = crypto.randomUUID();
      const token = jwt.sign(
        {
          id: admin.id,
          username: admin.username,
          role: admin.role,
          sid: sessionId,
          adminState: buildAdminStateFingerprint(admin)
        },
        jwtSecret,
        { expiresIn: '8h' }
      );

      res.cookie(cookieName, token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 8 * 60 * 60 * 1000
      });

      await appendAudit({
        adminUsername: admin.username,
        action: 'admin_login',
        target: admin.id,
        details: { role: admin.role, sessionHash: hashAdminSessionId(sessionId) }
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
    try {
      const sessionHash = hashAdminSessionId(req.admin?.sid);
      await revokeAdminSession({
        sessionHash,
        adminUsername: req.admin?.username,
        adminId: req.admin?.id
      });
      res.clearCookie(cookieName, {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        path: '/'
      });
      await appendAudit({
        adminUsername: req.admin?.username,
        action: 'admin_logout',
        target: req.admin?.id,
        details: { sessionHash }
      });
      return res.json({ success: true });
    } catch (_error) {
      return res.status(500).json({ error: 'ADMIN_LOGOUT_FAILED' });
    }
  });

  router.get('/me', requireAdminAuth, (req, res) => {
    const { sid: _sid, adminState: _adminState, ...publicAdmin } = req.admin || {};
    return res.json({ admin: publicAdmin });
  });

  return router;
}

module.exports = { createAdminAuthRouter };
