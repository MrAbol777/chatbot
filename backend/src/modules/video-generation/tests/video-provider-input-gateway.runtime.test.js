'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createGatewayApp, gatewayPort } = require('../../../../scripts/run-video-provider-input-gateway');

function request(server, method, pathname) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: address.port, path: pathname, method }, (res) => {
      res.resume();
      res.once('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    req.once('error', reject);
    req.end();
  });
}

test('dedicated provider-input gateway exposes no app, admin, upload, or health routes', async () => {
  let queries = 0;
  const env = {
    NODE_ENV: 'test',
    VIDEO_PROVIDER_INPUT_SIGNING_SECRET: 'g'.repeat(48),
    VIDEO_PROVIDER_INPUT_PUBLIC_BASE_URL: 'http://127.0.0.1:3100',
    VIDEO_PROVIDER_INPUT_TTL_SECONDS: '300'
  };
  const app = createGatewayApp({ db: { query: async () => { queries += 1; return [[]]; } }, env });
  const server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  try {
    for (const [method, pathname] of [['GET', '/'], ['GET', '/api/health'], ['POST', '/api/video-generations/input-media'], ['POST', '/api/video-provider-input/not-a-token']]) {
      const response = await request(server, method, pathname);
      assert.equal(response.status, 404);
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
    }
    const signedPath = await request(server, 'GET', '/api/video-provider-input/not-a-token');
    assert.equal(signedPath.status, 404);
    assert.equal(queries, 0);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('provider-input gateway port is validated before bind', () => {
  assert.equal(gatewayPort({ VIDEO_PROVIDER_GATEWAY_PORT: '3100' }), 3100);
  assert.throws(() => gatewayPort({ VIDEO_PROVIDER_GATEWAY_PORT: '80' }), /between 1024 and 65535/);
  assert.throws(() => gatewayPort({ VIDEO_PROVIDER_GATEWAY_PORT: 'invalid' }), /between 1024 and 65535/);
});
