const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const parseBannedFilter = (value) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
};

// In-memory token version / revocation store for immediate session invalidation
const adminTokenVersions = new Map();

const getAdminTokenVersion = (adminId) => adminTokenVersions.get(String(adminId)) || 1;
const bumpAdminTokenVersion = (adminId) => {
  const next = (adminTokenVersions.get(String(adminId)) || 1) + 1;
  adminTokenVersions.set(String(adminId), next);
  return next;
};
const revokeAdminToken = (adminId) => bumpAdminTokenVersion(adminId);

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

function createRequireAdminAuth({ cookieName = 'admin_token', jwtSecret }) {
  return (req, res, next) => {
    const token = req.cookies?.[cookieName];
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const payload = jwt.verify(token, jwtSecret);
      if (payload?.id) {
        const expectedVersion = getAdminTokenVersion(payload.id);
        const tokenVersion = payload.tokenVersion || 1;
        if (tokenVersion < expectedVersion) {
          return res.status(401).json({ error: 'SESSION_REVOKED', message: 'نشست کاربری شما منقضی شده است. لطفا مجددا وارد شوید.' });
        }
      }
      req.admin = payload;
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
  // superadmin is always permitted by default
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

/**
 * PII Data Masking helper:
 * Full phone number is only visible to superadmin and admin.
 * For other roles (moderator, support, developer, finance), phone number is masked.
 */
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
  getAdminTokenVersion,
  bumpAdminTokenVersion,
  revokeAdminToken,
  maskPhoneNumber
};
