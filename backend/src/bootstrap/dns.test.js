'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const dns = require('dns');
const { initDns, dnsCache } = require('./dns');

test('resilient DNS resolver initializes and resolves configured overrides', async () => {
  initDns({
    env: {
      METIS_IP: '45.94.254.27',
      DNS_HOST_OVERRIDES: 'test.example.internal=10.0.0.1'
    },
    logger: { log: () => {} }
  });

  assert.equal(dnsCache.get('api.metisai.ir'), '45.94.254.27');
  assert.equal(dnsCache.get('test.example.internal'), '10.0.0.1');

  // Test callback with options object
  await new Promise((resolve, reject) => {
    dns.lookup('api.metisai.ir', { family: 4 }, (err, address, family) => {
      if (err) return reject(err);
      assert.equal(address, '45.94.254.27');
      assert.equal(family, 4);
      resolve();
    });
  });

  // Test callback with options.all = true
  await new Promise((resolve, reject) => {
    dns.lookup('api.metisai.ir', { all: true }, (err, addresses) => {
      if (err) return reject(err);
      assert.deepEqual(addresses, [{ address: '45.94.254.27', family: 4 }]);
      resolve();
    });
  });

  // Test callback without options argument
  await new Promise((resolve, reject) => {
    dns.lookup('test.example.internal', (err, address, family) => {
      if (err) return reject(err);
      assert.equal(address, '10.0.0.1');
      assert.equal(family, 4);
      resolve();
    });
  });
});
