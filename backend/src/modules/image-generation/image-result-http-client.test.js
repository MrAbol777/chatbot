'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createImageResultHttpClient } = require('./image-result-http-client');

const PUBLIC_RECORDS = [{ address: '93.184.216.34', family: 4 }];
const createStub = () => {
  const calls = [];
  return {
    calls,
    post: async (...args) => ({ args }),
    get: async (...args) => {
      calls.push(args);
      return { data: Buffer.from('ok'), headers: { 'content-type': 'image/png' } };
    }
  };
};

test('binary image download accepts configured HTTPS host, pins DNS and disables redirects', async () => {
  const raw = createStub();
  const client = createImageResultHttpClient({
    httpClient: raw,
    imageConfig: { baseUrl: 'https://api.metisai.ir' },
    env: { IMAGE_RESULT_ALLOWED_HOSTS: 'cdn.example.com' },
    dnsResolver: async () => PUBLIC_RECORDS
  });

  await client.get('https://cdn.example.com/result.png', { responseType: 'arraybuffer', timeout: 1000 });
  assert.equal(raw.calls.length, 1);
  assert.equal(raw.calls[0][0], 'https://cdn.example.com/result.png');
  assert.equal(raw.calls[0][1].maxRedirects, 0);
  assert.equal(typeof raw.calls[0][1].httpsAgent?.options?.lookup, 'function');
});

test('binary image download rejects localhost and unlisted destinations', async () => {
  const raw = createStub();
  const client = createImageResultHttpClient({
    httpClient: raw,
    imageConfig: { baseUrl: 'https://api.metisai.ir' },
    env: {},
    dnsResolver: async () => PUBLIC_RECORDS
  });

  await assert.rejects(
    client.get('http://127.0.0.1:3000/private', { responseType: 'arraybuffer' }),
    (error) => error?.code === 'IMAGE_RESULT_URL_REJECTED'
  );
  await assert.rejects(
    client.get('https://evil.example/result.png', { responseType: 'arraybuffer' }),
    (error) => error?.code === 'IMAGE_RESULT_URL_REJECTED'
  );
  assert.equal(raw.calls.length, 0);
});

test('binary image download rejects allowlisted hosts that resolve to a private address', async () => {
  const raw = createStub();
  const client = createImageResultHttpClient({
    httpClient: raw,
    imageConfig: { baseUrl: 'https://api.metisai.ir' },
    env: { IMAGE_RESULT_ALLOWED_HOSTS: 'cdn.example.com' },
    dnsResolver: async () => [{ address: '10.0.0.4', family: 4 }]
  });

  await assert.rejects(
    client.get('https://cdn.example.com/result.png', { responseType: 'arraybuffer' }),
    (error) => error?.code === 'IMAGE_RESULT_URL_REJECTED'
  );
  assert.equal(raw.calls.length, 0);
});

test('binary image download rejects credentials and non-standard HTTPS ports', async () => {
  const raw = createStub();
  const client = createImageResultHttpClient({
    httpClient: raw,
    imageConfig: { baseUrl: 'https://api.metisai.ir' },
    env: { IMAGE_RESULT_ALLOWED_HOSTS: 'cdn.example.com' },
    dnsResolver: async () => PUBLIC_RECORDS
  });

  await assert.rejects(
    client.get('https://user:pass@cdn.example.com/result.png', { responseType: 'arraybuffer' }),
    (error) => error?.code === 'IMAGE_RESULT_URL_REJECTED'
  );
  await assert.rejects(
    client.get('https://cdn.example.com:8443/result.png', { responseType: 'arraybuffer' }),
    (error) => error?.code === 'IMAGE_RESULT_URL_REJECTED'
  );
});
