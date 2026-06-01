const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const parseBannedFilter = (value) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
};

function createLoginLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'تعداد تلاش برای ورود زیاد است. لطفا یک دقیقه دیگر تلاش کنید.' }
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
      req.admin = payload;
      return next();
    } catch (_error) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  };
}

module.exports = {
  parseBannedFilter,
  createLoginLimiter,
  createRequireAdminAuth
};
