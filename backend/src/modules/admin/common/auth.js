const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const parseBannedFilter = (value) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
};

const hashAdminSessionId = (value) =>
  crypto.createHash('sha256').update(String(value || '')).digest('hex');

const normalizeAdminUpdatedAt = (value) => {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const buildAdminStateFingerprint = (admin = {}) =>
  crypto.createHash('sha256')
    .update([
      String(admin.id ?? ''),
      String(admin.username || ''),
      String(admin.role || '').trim().toLowerCase(),
      String(admin.password_hash || ''),
      String(normalizeAdminUpdatedAt(admin.updated_at))
    ].join('|'))
    .digest('hex');

function createLoginLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'تعداد تلاش برای ورود زیاد است. لطفا یک دقیقه دیگر تلاش کنید.' }
  });
}

function createAdminActionLimiter({ windowMs = 30 * 1000, max = 20, message = 'تعداد عملیات بیش از حد مجاز است. لطفا چند ثانیه بعد تلاش کنید.' } = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'RATE_LIMIT_EXCEEDED', message }
  });
}

function createRequireAdminAuth({ cookieName = 'admin_token', jwtSecret, adminRepository }) {
  if (!adminRepository || typeof adminRepository.findById !== 'function' || typeof adminRepository.isSessionRevoked !== 'function') {
    throw new Error('adminRepository with persistent session checks is required');
  }

  return async (req, res, next) => {
    const token = req.cookies?.[cookieName];
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const payload = jwt.verify(token, jwtSecret);
      const adminId = payload?.id === undefined || payload?.id === null ? '' : String(payload.id).trim();
      const sessionId = typeof payload?.sid === 'string' ? payload.sid.trim() : '';
      const state = typeof payload?.adminState === 'string' ? payload.adminState.trim() : '';
      if (!adminId || !sessionId || !state) {
        return res.status(401).json({ error: 'SESSION_REVOKED' });
      }

      const [currentAdmin, revoked] = await Promise.all([
        adminRepository.findById(adminId),
        adminRepository.isSessionRevoked(hashAdminSessionId(sessionId))
      ]);
      if (!currentAdmin || revoked) {
        return res.status(401).json({ error: 'SESSION_REVOKED', message: 'نشست مدیریت منقضی شده است. لطفا دوباره وارد شوید.' });
      }

      const expectedState = buildAdminStateFingerprint(currentAdmin);
      const sameState = state.length === expectedState.length && crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expectedState));
      const sameUsername = String(payload.username || '') === String(currentAdmin.username || '');
      const sameRole = String(payload.role || '').trim().toLowerCase() === String(currentAdmin.role || '').trim().toLowerCase();
      if (!sameState || !sameUsername || !sameRole) {
        return res.status(401).json({ error: 'SESSION_REVOKED', message: 'سطح دسترسی مدیریت تغییر کرده است. لطفا دوباره وارد شوید.' });
      }

      req.admin = {
        ...payload,
        id: currentAdmin.id,
        username: currentAdmin.username,
        role: currentAdmin.role
      };
      return next();
    } catch (_error) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  };
}

const ADMIN_ROLES = Object.freeze({
  SUPERADMIN: 'superadmin',
  ADMIN: 'admin',
  FINANCE: 'finance',
  MODERATOR: 'moderator',
  DEVELOPER: 'developer',
  SUPPORT: 'support'
});

function createRequireAdminRole(allowedRoles = []) {
  const allowedSet = new Set(
    (Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles])
      .map((r) => String(r).trim().toLowerCase())
  );
  allowedSet.add(ADMIN_ROLES.SUPERADMIN);

  return (req, res, next) => {
    const role = String(req.admin?.role || '').trim().toLowerCase();
    if (!role || !allowedSet.has(role)) {
      return res.status(403).json({
        error: 'INSUFFICIENT_PERMISSIONS',
        message: 'سطح دسترسی شما برای انجام این عملیات کافی نیست.'
      });
    }
    return next();
  };
}

function maskPhoneNumber(phone, role = '') {
  if (!phone || typeof phone !== 'string') return phone;
  const cleanRole = String(role).trim().toLowerCase();
  if (cleanRole === ADMIN_ROLES.SUPERADMIN || cleanRole === ADMIN_ROLES.ADMIN) {
    return phone;
  }
  const cleanPhone = phone.trim();
  if (cleanPhone.length <= 4) return '***';
  if (cleanPhone.length <= 7) return `${cleanPhone.slice(0, 3)}***`;
  return `${cleanPhone.slice(0, 4)}***${cleanPhone.slice(-4)}`;
}

module.exports = {
  ADMIN_ROLES,
  parseBannedFilter,
  createLoginLimiter,
  createAdminActionLimiter,
  createRequireAdminAuth,
  createRequireAdminRole,
  hashAdminSessionId,
  buildAdminStateFingerprint,
  maskPhoneNumber
};
