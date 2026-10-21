const test = require('node:test');
const assert = require('node:assert/strict');

const { isDevelopmentOrigin } = require('./dev-origins');

test('accepts localhost and private LAN origins used for phone testing', () => {
  for (const origin of [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://192.168.1.102:5173',
    'http://10.0.0.7:5173',
    'http://172.16.4.2:5173',
    'http://172.31.255.1:3000'
  ]) {
    assert.equal(isDevelopmentOrigin(origin), true, origin);
  }
});

test('rejects public hosts, look-alikes and malformed origins', () => {
  for (const origin of [
    'http://192.169.1.1:5173',
    'http://172.32.0.1:5173',
    'http://172.15.0.1:5173',
    'http://8.8.8.8:5173',
    'http://192.168.1.1.evil.com:5173',
    'http://localhost.evil.com:5173',
    'https://danoa.ir',
    'http://192.168.1.102:5173/path',
    'http://user:pass@192.168.1.102:5173',
    'ftp://192.168.1.102',
    'null',
    '',
    undefined
  ]) {
    assert.equal(isDevelopmentOrigin(origin), false, String(origin));
  }
});
