'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createRequestMetricsMiddleware, normalizeRoute } = require('./request-metrics.middleware');

test('request metrics middleware records API completion without query strings or identifiers', async () => {
  const records = [];
  const middleware = createRequestMetricsMiddleware({
    repository: { recordRequest: async (entry) => records.push(entry) },
    logger: { warn() {} }
  });
  const req = {
    originalUrl: '/api/users/123456/profile?secret=value',
    path: '/api/users/123456/profile',
    method: 'GET'
  };
  const res = new EventEmitter();
  res.locals = { requestId: 'request-1' };
  res.statusCode = 200;

  await new Promise((resolve) => {
    middleware(req, res, () => {
      res.emit('finish');
      setImmediate(resolve);
    });
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].route, '/api/users/:id/profile');
  assert.equal(records[0].statusCode, 200);
  assert.equal(records[0].requestId, 'request-1');
  assert.ok(records[0].durationMs >= 0);
});

test('monitoring endpoint excludes itself from request metrics', () => {
  let nextCalled = false;
  const middleware = createRequestMetricsMiddleware({
    repository: { recordRequest: async () => { throw new Error('must not be called'); } }
  });
  middleware({ originalUrl: '/api/admin/monitoring/overview', method: 'GET' }, {}, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(normalizeRoute({ path: '/api/items/1234' }), '/api/items/:id');
  assert.equal(normalizeRoute({
    originalUrl: '/api/admin/users/u-7/ban?reason=test',
    route: { path: '/users/:userId/ban' }
  }), '/api/admin/users/:id/ban');
});
