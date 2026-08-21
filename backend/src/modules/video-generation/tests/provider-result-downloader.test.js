'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { fetchValidatedResultWithNode, classifyDownloadError, proxyConfig } = require('../providers/provider-result-downloader');

function response({ statusCode = 200, headers = {}, chunks = [], failure = null } = {}) {
  const stream = new PassThrough();
  stream.statusCode = statusCode;
  stream.headers = headers;
  setImmediate(() => {
    for (const chunk of chunks) stream.write(chunk);
    if (failure) stream.destroy(failure);
    else stream.end();
  });
  return stream;
}

const plan = (url) => ({ url: new URL(url), hostname: new URL(url).hostname, port: 443, records: [{ address: '93.184.216.34', family: 4 }] });
const validator = { validate: async (source, { base } = {}) => plan(base ? new URL(source, base).toString() : source) };
async function read(stream) { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return Buffer.concat(chunks); }

test('Banana result downloader streams a successful response and reports validated metadata', async () => {
  const logs = [];
  const remote = await fetchValidatedResultWithNode('https://cdn.example.test/results/video.mp4', {
    validator, maxBytes: 1024, logger: { info: (entry) => logs.push(entry) },
    requestImpl: async () => response({ headers: { 'content-type': 'video/mp4; charset=binary', 'content-length': '11' }, chunks: [Buffer.from('video-bytes')] })
  });
  assert.equal((await read(remote.stream)).toString(), 'video-bytes');
  assert.equal(remote.mimeType, 'video/mp4');
  assert.equal(remote.contentLength, 11);
  assert.equal(remote.metrics.receivedBytes, 11);
  assert.ok(logs.some((entry) => entry.event === 'video_result_download_completed'));
});

test('continuous slow bytes are accepted beyond the old 60-second whole-download model', async () => {
  const stream = new PassThrough();
  stream.statusCode = 200; stream.headers = { 'content-type': 'video/mp4', 'content-length': '3' };
  const remote = await fetchValidatedResultWithNode('https://cdn.example.test/results/video.mp4', { validator, maxBytes: 1024, idleTimeoutMs: 40, totalTimeoutMs: 0, requestImpl: async () => stream });
  stream.write('a'); await new Promise((resolve) => setTimeout(resolve, 25)); stream.write('b'); await new Promise((resolve) => setTimeout(resolve, 25)); stream.end('c');
  assert.equal((await read(remote.stream)).toString(), 'abc');
});

test('an idle response is aborted while a direct downloader receives no proxy configuration', async () => {
  const stream = new PassThrough();
  stream.statusCode = 200; stream.headers = { 'content-type': 'video/mp4' };
  let options;
  const remote = await fetchValidatedResultWithNode('https://cdn.example.test/results/video.mp4', {
    validator, maxBytes: 1024, idleTimeoutMs: 20,
    requestImpl: async (_plan, requestOptions) => { options = requestOptions; return stream; }
  });
  await assert.rejects(() => read(remote.stream), { code: 'VIDEO_RESULT_IDLE_TIMEOUT', retryable: true });
  assert.equal(options.proxyUrl, null);
});

test('rejects incomplete, empty, and reset result streams', async () => {
  const incomplete = await fetchValidatedResultWithNode('https://cdn.example.test/results/video.mp4', { validator, maxBytes: 1024, requestImpl: async () => response({ headers: { 'content-type': 'video/mp4', 'content-length': '5' }, chunks: ['abc'] }) });
  await assert.rejects(() => read(incomplete.stream), { code: 'VIDEO_RESULT_INCOMPLETE_BODY', retryable: true });
  const empty = await fetchValidatedResultWithNode('https://cdn.example.test/results/video.mp4', { validator, maxBytes: 1024, requestImpl: async () => response({ headers: { 'content-type': 'video/mp4', 'content-length': '0' } }) });
  await assert.rejects(() => read(empty.stream), { code: 'VIDEO_RESULT_EMPTY_RESPONSE' });
  const reset = await fetchValidatedResultWithNode('https://cdn.example.test/results/video.mp4', { validator, maxBytes: 1024, requestImpl: async () => response({ headers: { 'content-type': 'video/mp4' }, chunks: ['a'], failure: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) }) });
  await assert.rejects(() => read(reset.stream), { code: 'VIDEO_RESULT_CONNECTION_RESET', retryable: true });
});

for (const [status, code, retryable] of [[403, 'VIDEO_RESULT_PROVIDER_FORBIDDEN', true], [404, 'VIDEO_RESULT_PROVIDER_NOT_FOUND', false], [429, 'VIDEO_RESULT_PROVIDER_RATE_LIMITED', true], [500, 'VIDEO_RESULT_PROVIDER_TEMPORARY', true]]) {
  test(`classifies HTTP ${status} safely`, async () => {
    await assert.rejects(() => fetchValidatedResultWithNode('https://cdn.example.test/results/video.mp4', { validator, maxBytes: 1024, requestImpl: async () => response({ statusCode: status }) }), { code, retryable });
  });
}

test('classifies connect, idle, DNS, TLS, and reset errors without one generic code', () => {
  assert.equal(classifyDownloadError(Object.assign(new Error('x'), { code: 'VIDEO_RESULT_CONNECT_TIMEOUT' })).code, 'VIDEO_RESULT_CONNECT_TIMEOUT');
  assert.equal(classifyDownloadError(Object.assign(new Error('x'), { code: 'VIDEO_RESULT_IDLE_TIMEOUT' })).code, 'VIDEO_RESULT_IDLE_TIMEOUT');
  assert.equal(classifyDownloadError(Object.assign(new Error('x'), { code: 'EAI_AGAIN' })).code, 'VIDEO_RESULT_DNS_TEMPORARY_FAILURE');
  assert.equal(classifyDownloadError(Object.assign(new Error('x'), { code: 'ENOTFOUND' })).code, 'VIDEO_RESULT_DNS_NOT_FOUND');
  assert.equal(classifyDownloadError(Object.assign(new Error('x'), { code: 'CERT_HAS_EXPIRED' })).code, 'VIDEO_RESULT_TLS_FAILURE');
  assert.equal(classifyDownloadError(Object.assign(new Error('x'), { code: 'ECONNRESET' })).code, 'VIDEO_RESULT_CONNECTION_RESET');
});

test('redirects are revalidated and proxy settings are passed without entering logs', async () => {
  const calls = []; const logs = [];
  const remote = await fetchValidatedResultWithNode('https://cdn.example.test/results/old.mp4', {
    validator, maxBytes: 1024, maxRedirects: 1, proxyUrl: 'http://user:secret@proxy.example.test:8080', logger: { info: (entry) => logs.push(entry) },
    requestImpl: async (current, options) => {
      calls.push({ hostname: current.hostname, proxyUrl: options.proxyUrl });
      return calls.length === 1 ? response({ statusCode: 302, headers: { location: '/results/new.mp4' } }) : response({ headers: { 'content-type': 'video/mp4', 'content-length': '1' }, chunks: ['x'] });
    }
  });
  assert.equal((await read(remote.stream)).toString(), 'x');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].proxyUrl, 'http://user:secret@proxy.example.test:8080');
  assert.equal(logs.some((entry) => JSON.stringify(entry).includes('secret')), false);
  assert.equal(proxyConfig('http://user:secret@proxy.example.test:8080').hostname, 'proxy.example.test');
});
