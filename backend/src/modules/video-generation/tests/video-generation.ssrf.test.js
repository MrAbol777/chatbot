process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createMetisVideoProvider } = require('../providers/metis-video.provider');
const { createVideoResultUrlValidator, createPinnedLookup, isBlockedAddress } = require('../storage/video-result-url-validator');

const mp4 = Buffer.from('000000186674797069736f6d0000020069736f6d69736f6d', 'hex');
let server; let port; let requests = 0;
test.before(async () => {
  server = http.createServer((request, response) => {
    requests += 1;
    if (request.url === '/redirect') { response.writeHead(302, { location: '/video' }); response.end(); return; }
    if (/^\/r(301|302|303|307|308)$/.test(request.url)) { response.writeHead(Number(request.url.slice(2)), { location: '/video' }); response.end(); return; }
    if (request.url === '/loop') { response.writeHead(302, { location: '/loop' }); response.end(); return; }
    if (request.url === '/missing-location') { response.writeHead(302); response.end(); return; }
    if (request.url === '/private') { response.writeHead(302, { location: 'http://127.0.0.1:1/video' }); response.end(); return; }
    if (request.url === '/credentials') { response.writeHead(302, { location: 'http://user:pass@localhost/video' }); response.end(); return; }
    if (request.url === '/large') { response.writeHead(200, { 'content-type': 'video/mp4', 'content-length': '999999' }); response.end(); return; }
    if (request.url === '/generic') { response.writeHead(200, { 'content-type': 'application/octet-stream' }); response.end(mp4); return; }
    if (request.url === '/video') { response.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(mp4.length) }); response.end(mp4); return; }
    response.writeHead(404); response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});
test.after(async () => new Promise((resolve) => server.close(resolve)));

function provider(overrides = {}) {
  return createMetisVideoProvider({ httpClient: { get: async () => ({ data: {} }), post: async () => ({ data: { id: 'x' } }) }, baseUrl: 'https://api.invalid', apiKey: 'test', resultAllowedHosts: ['localhost', '127.0.0.1'], resultAllowedPorts: [port], allowTestLocalResult: true, dnsResolver: async () => [{ address: '127.0.0.1', family: 4 }], resultMaxBytes: 1024, resultTimeoutMs: 1000, resultMaxRedirects: 2, ...overrides });
}

test('test network guard rejects an accidental external HTTP connection', () => {
  assert.throws(() => http.request('http://example.com/video'), /External HTTP network is blocked/);
});

test('SSRF matrix blocks private and special address representations before a connection', async () => {
  const validator = createVideoResultUrlValidator({ allowedHosts: ['example.test', 'localhost'], resolver: async (host) => host === 'example.test' ? [{ address: '10.0.0.4', family: 4 }] : [{ address: '127.0.0.1', family: 4 }] });
  for (const value of ['http://example.test/video', 'file:///tmp/x', 'https://user:pass@example.test/a', 'https://example.test:444/a', 'https://localhost/a', 'https://[::1]/a', 'https://[::ffff:127.0.0.1]/a', 'https://example.test\n.evil/a']) {
    await assert.rejects(() => validator.validate(value));
  }
  assert.equal(isBlockedAddress('169.254.169.254'), true);
  assert.equal(isBlockedAddress('fd00:ec2::254'), true);
  assert.equal(isBlockedAddress('::ffff:127.0.0.1'), true);
  assert.equal(isBlockedAddress('93.184.216.34'), false);
});

test('hostname matching is exact, normalized, and empty production allowlists deny downloads', async () => {
  const resolver = async () => [{ address: '93.184.216.34', family: 4 }];
  const validator = createVideoResultUrlValidator({ allowedHosts: ['ExAmPlE.Test.'], resolver });
  await validator.validate('https://EXAMPLE.test./movie');
  await assert.rejects(() => validator.validate('https://example.test.evil/movie'), { code: 'VIDEO_RESULT_HOST_NOT_ALLOWED' });
  await assert.rejects(() => createVideoResultUrlValidator({ allowedHosts: [], resolver }).validate('https://example.test/movie'), { code: 'VIDEO_RESULT_HOST_NOT_ALLOWED' });
});

test('production result URLs require the exact Metis storage prefix and reject traversal encodings', async () => {
  const resolver = async () => [{ address: '93.184.216.34', family: 4 }];
  const validator = createVideoResultUrlValidator({
    allowedHosts: ['api.metisai.ir'],
    allowedPathPrefixes: ['/api/tpsgsbxstoragecontainer/router/tpsgsbxstoragecontainer/router/'],
    resolver
  });
  await validator.validate('https://api.metisai.ir/api/tpsgsbxstoragecontainer/router/tpsgsbxstoragecontainer/router/output.mp4');
  await assert.rejects(() => validator.validate('https://api.metisai.ir/api/v2/generate/output.mp4'), { code: 'VIDEO_RESULT_PATH_NOT_ALLOWED' });
  await assert.rejects(() => validator.validate('https://api.metisai.ir/api/tpsgsbxstoragecontainer/router/tpsgsbxstoragecontainer/router/%2e%2e/output.mp4'), { code: 'VIDEO_RESULT_URL_INVALID' });
});

test('Unicode allowlist entries normalize to the URL parser punycode form', async () => {
  const validator = createVideoResultUrlValidator({ allowedHosts: ['bücher.test.'], resolver: async () => [{ address: '93.184.216.34', family: 4 }] });
  const plan = await validator.validate('https://xn--bcher-kva.test/movie');
  assert.equal(plan.hostname, 'xn--bcher-kva.test');
});

test('validated local result is pinned and a relative redirect is revalidated', async () => {
  const start = requests;
  const result = await provider().fetchResultStream({ source: `http://localhost:${port}/redirect` });
  const chunks = []; for await (const chunk of result.stream) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), mp4);
  assert.equal(requests - start, 2);
  let resolverCalls = 0;
  const lookup = createPinnedLookup([{ address: '127.0.0.1', family: 4 }]);
  lookup('rebound.invalid', {}, (error, address) => { assert.equal(error, null); assert.equal(address, '127.0.0.1'); });
  assert.equal(resolverCalls, 0);
});

test('redirect destinations and unsafe response headers are rejected without following them', async () => {
  const start = requests;
  await assert.rejects(() => provider().fetchResultStream({ source: `http://localhost:${port}/private` }), { code: 'VIDEO_RESULT_REDIRECT_BLOCKED' });
  await assert.rejects(() => provider().fetchResultStream({ source: `http://localhost:${port}/credentials` }), { code: 'VIDEO_RESULT_REDIRECT_BLOCKED' });
  await assert.rejects(() => provider().fetchResultStream({ source: `http://localhost:${port}/large` }), { code: 'VIDEO_RESULT_TOO_LARGE' });
  await assert.rejects(() => provider().fetchResultStream({ source: `http://localhost:${port}/generic` }), { code: 'VIDEO_RESULT_INVALID_MIME' });
  assert.equal(requests - start, 4);
});

test('all supported redirect status codes, loops, and missing Location follow the safe redirect contract', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const result = await provider().fetchResultStream({ source: `http://localhost:${port}/r${status}` });
    result.stream.resume();
  }
  await assert.rejects(() => provider({ resultMaxRedirects: 1 }).fetchResultStream({ source: `http://localhost:${port}/loop` }), { code: 'VIDEO_RESULT_TOO_MANY_REDIRECTS' });
  await assert.rejects(() => provider().fetchResultStream({ source: `http://localhost:${port}/missing-location` }), { code: 'VIDEO_RESULT_REDIRECT_BLOCKED' });
});
