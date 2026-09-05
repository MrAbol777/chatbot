'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createImageCapacityGuard } = require('./image-capacity.middleware');

function responseStub() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
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

  await guard({ user: { id: 'user-1' } }, res, () => { passed = true; });

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

  await guard({ user: { id: 'user-2' } }, res, () => { passed = true; });

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

  await guard({ user: { id: 'user-3' } }, res, () => { passed = true; });

  assert.equal(passed, true);
  assert.equal(res.statusCode, 200);
});
