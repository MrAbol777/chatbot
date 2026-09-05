'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createImageCapacityGuard } = require('./image-capacity.middleware');

function responseStub() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    locals: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('image capacity guard rejects when user active jobs reach the configured limit', async () => {
  const db = {
    query: async () => [[{ total_active: 3, user_active: 2 }]]
  };
  const guard = createImageCapacityGuard({ db, maxActive: 6, maxActivePerUser: 2 });
  const res = responseStub();
  let passed = false;

  await guard({ user: { id: 'user-1' }, headers: {} }, res, () => { passed = true; });

  assert.equal(passed, false);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error, 'IMAGE_CAPACITY_REACHED');
  assert.equal(res.headers['retry-after'], '5');
});

test('image capacity guard rejects when global active jobs reach the configured limit', async () => {
  const db = {
    query: async () => [[{ total_active: 6, user_active: 1 }]]
  };
  const guard = createImageCapacityGuard({ db, maxActive: 6, maxActivePerUser: 2 });
  const res = responseStub();
  let passed = false;

  await guard({ user: { id: 'user-2' }, headers: {} }, res, () => { passed = true; });

  assert.equal(passed, false);
  assert.equal(res.statusCode, 429);
});

test('image capacity guard allows work while both limits have room', async () => {
  const db = {
    query: async () => [[{ total_active: 2, user_active: 1 }]]
  };
  const guard = createImageCapacityGuard({ db, maxActive: 6, maxActivePerUser: 2 });
  const res = responseStub();
  let passed = false;

  await guard({ user: { id: 'user-3' }, headers: {} }, res, () => { passed = true; });

  assert.equal(passed, true);
  assert.equal(res.statusCode, 200);
});

test('image capacity guard lets an idempotent replay through even when capacity is full', async () => {
  let calls = 0;
  const db = {
    query: async () => {
      calls += 1;
      if (calls === 1) return [[{ id: 42 }]];
      throw new Error('capacity query should not run for replay');
    }
  };
  const guard = createImageCapacityGuard({ db, maxActive: 1, maxActivePerUser: 1 });
  const res = responseStub();
  let passed = false;

  await guard({
    user: { id: 'user-4' },
    headers: { 'idempotency-key': 'request-existing-123' }
  }, res, () => { passed = true; });

  assert.equal(passed, true);
  assert.equal(calls, 1);
  assert.equal(res.locals.imageIdempotentReplay, true);
});
