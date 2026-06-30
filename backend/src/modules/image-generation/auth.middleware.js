const jwt = require('jsonwebtoken');

function createAuthMiddleware({ jwtSecret, db }) {
  if (!jwtSecret) {
    throw new Error('jwtSecret is required for auth middleware');
  }

  return async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, jwtSecret);
      const userId = typeof decoded?.sub === 'string' || typeof decoded?.sub === 'number' ? String(decoded.sub).trim() : '';
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Invalid or expired token.'
        });
      }

      if (db && typeof db.query === 'function') {
        const [rows] = await db.query('SELECT user_id FROM app_users WHERE user_id = ? LIMIT 1', [userId]);
        if (!rows[0]) {
          return res.status(401).json({
            success: false,
            error: 'Invalid or expired token.'
          });
        }
      }

      req.user = { id: userId };
      return next();
    } catch (error) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token.'
      });
    }
  };
}

module.exports = { createAuthMiddleware };
