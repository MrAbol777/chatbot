'use strict';

const normalizeRoute = (req) => {
  const originalPath = String(req.originalUrl || req.path || '/api/unknown').split('?')[0];
  const originalSegments = originalPath.split('/').filter(Boolean);
  const pattern = typeof req.route?.path === 'string' ? req.route.path : '';
  const patternSegments = pattern.split('/').filter(Boolean);

  if (patternSegments.length > 0 && patternSegments.length <= originalSegments.length) {
    const offset = originalSegments.length - patternSegments.length;
    patternSegments.forEach((segment, index) => {
      if (segment.startsWith(':')) originalSegments[offset + index] = ':id';
    });
  }

  const routedPath = `/${originalSegments.join('/')}`;

  return routedPath
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, ':id')
    .replace(/\/[0-9]{2,}(?=\/|$)/g, '/:id')
    .replace(/\/[A-Za-z0-9_-]{32,}(?=\/|$)/g, '/:id')
    .slice(0, 191);
};

function createRequestMetricsMiddleware({ repository, logger = console }) {
  if (!repository || typeof repository.recordRequest !== 'function') {
    throw new Error('MONITORING_REPOSITORY_REQUIRED');
  }

  return (req, res, next) => {
    if (!String(req.originalUrl || '').startsWith('/api/')) return next();
    if (String(req.originalUrl || '').startsWith('/api/admin/monitoring')) return next();

    const startedAt = process.hrtime.bigint();
    res.once('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      void repository.recordRequest({
        requestId: res.locals.requestId,
        method: req.method,
        route: normalizeRoute(req),
        statusCode: res.statusCode,
        durationMs
      }).catch((error) => {
        logger?.warn?.('[monitoring] request metric write failed', {
          code: error?.code || 'MONITORING_WRITE_FAILED'
        });
      });
    });
    next();
  };
}

module.exports = { createRequestMetricsMiddleware, normalizeRoute };
