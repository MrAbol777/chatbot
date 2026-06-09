const jwt = require('jsonwebtoken');

function createAuthMiddleware({ jwtSecret }) {
  if (!jwtSecret) {
    throw new Error('jwtSecret is required for auth middleware');
  }

  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Provide a valid Bearer token.'
      });
    }

    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, jwtSecret);
      req.user = { id: decoded.id || decoded.userId || decoded.sub };
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
