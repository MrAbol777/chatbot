'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createChatConcurrencyGate } = require('./chat-pressure.middleware');

function responseStub() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.body = null;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.setHeader = (name, value) => { res.headers[String(name).toLowerCase()] = String(value); };
  return res;
}

test('chat concurrency gate rejects requests above per-user limit and releases on finish', () => {
  const gate = createChatConcurrencyGate({ maxPerUser: 2, maxGlobal: 10 });
  const req = () => ({ user: { id: 'user-1' } });
  const res1 = responseStub();
  const res2 = responseStub();
  const res3 = responseStub();
  let passed = 0;

  gate(req(), res1, () => { passed += 1; });
  gate(req(), res2, () => { passed += 1; });
  gate(req(), res3, () => { passed += 1; });

  assert.equal(passed, 2);
  assert.equal(res3.statusCode, 429);
  assert.equal(res3.body.error, 'CHAT_CAPACITY_REACHED');

  res1.emit('finish');
  const res4 = responseStub();
  gate(req(), res4, () => { passed += 1; });
  assert.equal(passed, 3);
});

test('chat concurrency gate enforces global limit across users', () => {
  const gate = createChatConcurrencyGate({ maxPerUser: 5, maxGlobal: 2 });
  const responses = [responseStub(), responseStub(), responseStub()];
  let passed = 0;
  gate({ user: { id: 'a' } }, responses[0], () => { passed += 1; });
  gate({ user: { id: 'b' } }, responses[1], () => { passed += 1; });
  gate({ user: { id: 'c' } }, responses[2], () => { passed += 1; });
  assert.equal(passed, 2);
  assert.equal(responses[2].statusCode, 429);
});
