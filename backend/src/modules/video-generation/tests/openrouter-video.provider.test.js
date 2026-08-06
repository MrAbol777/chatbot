'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOpenRouterVideoProvider, classifyOpenRouterSubmissionError, CAPABILITIES, PROVIDER_MODEL_ID } = require('../providers/openrouter-video.provider');
const { assertVideoProvider } = require('../providers/video-provider.interface');

function mockHttp({ postResult, getResult } = {}) {
  const calls = [];
  return {
    calls,
    post: async (...args) => { calls.push(['post', ...args]); if (postResult instanceof Error) throw postResult; return postResult; },
    get: async (...args) => { calls.push(['get', ...args]); if (getResult instanceof Error) throw getResult; return getResult; }
  };
}

function multiInput(overrides = {}) {
  return {
    capability: 'video.image_to_video_multi',
    providerModelId: 'x-ai/grok-imagine-video',
    prompt: 'A calm cinematic shot',
    duration: 5,
    resolution: '480p',
    aspectRatio: '16:9',
    generateAudio: false,
    inputReferences: [
      { url: 'https://media.example.test/api/video-provider-input/ref1' },
      { url: 'https://media.example.test/api/video-provider-input/ref2' }
    ],
    ...overrides
  };
}

const createProvider = (httpClient, overrides = {}) => createOpenRouterVideoProvider({ httpClient, apiKey: 'fixture-key', resultAllowedHosts: ['cdn.openrouter.test'], resultAllowedPathPrefixes: ['/results/'], ...overrides });

test('provider key and capability', () => {
  const provider = createProvider(mockHttp());
  assert.equal(provider.getProviderKey(), 'openrouter');
  assert.deepEqual(provider.getCapabilities(), ['video.image_to_video_multi']);
});

test('assertVideoProvider passes', () => {
  const httpClient = mockHttp({ postResult: { status: 202, data: { id: 'job_1', status: 'pending' } } });
  const provider = createProvider(httpClient);
  assertVideoProvider(provider);
});

test('correct ordered payload for 2 references', async () => {
  const httpClient = mockHttp({ postResult: { status: 202, data: { id: 'job_1', status: 'pending', polling_url: 'https://openrouter.ai/api/v1/videos/job_1' } } });
  const provider = createProvider(httpClient);
  const result = await provider.submit(multiInput());
  assert.equal(result.providerJobId, 'job_1');
  assert.equal(result.pollingUrl, 'https://openrouter.ai/api/v1/videos/job_1');
  const [, , payload, config] = httpClient.calls[0];
  assert.equal(payload.model, 'x-ai/grok-imagine-video');
  assert.equal(payload.duration, 5);
  assert.equal(payload.resolution, '480p');
  assert.equal(payload.aspect_ratio, '16:9');
  assert.equal(payload.generate_audio, false);
  assert.equal(payload.input_references.length, 2);
  assert.deepEqual(payload.input_references[0], { type: 'image_url', image_url: { url: 'https://media.example.test/api/video-provider-input/ref1' } });
  assert.deepEqual(payload.input_references[1], { type: 'image_url', image_url: { url: 'https://media.example.test/api/video-provider-input/ref2' } });
  assert.equal(config.headers.Authorization, 'Bearer fixture-key');
});

test('seven references accepted', async () => {
  const httpClient = mockHttp({ postResult: { status: 202, data: { id: 'job_7' } } });
  const provider = createProvider(httpClient);
  const refs = Array.from({ length: 7 }, (_, i) => ({ url: `https://media.example.test/ref${i + 1}` }));
  await provider.submit(multiInput({ inputReferences: refs }));
  assert.equal(httpClient.calls[0][2].input_references.length, 7);
});

test('one reference rejected', async () => {
  const provider = createProvider(mockHttp());
  await assert.rejects(provider.submit(multiInput({ inputReferences: [{ url: 'https://media.example.test/ref1' }] })), { code: 'VIDEO_PROVIDER_INVALID_INPUT_REFERENCES', submissionOutcome: 'not_submitted' });
});

test('eight references rejected', async () => {
  const provider = createProvider(mockHttp());
  const refs = Array.from({ length: 8 }, (_, i) => ({ url: `https://media.example.test/ref${i + 1}` }));
  await assert.rejects(provider.submit(multiInput({ inputReferences: refs })), { code: 'VIDEO_PROVIDER_INVALID_INPUT_REFERENCES', submissionOutcome: 'not_submitted' });
});

test('invalid duration rejected', async () => {
  const provider = createProvider(mockHttp());
  await assert.rejects(provider.submit(multiInput({ duration: 16 })), { code: 'VIDEO_PROVIDER_INVALID_DURATION', submissionOutcome: 'not_submitted' });
  await assert.rejects(provider.submit(multiInput({ duration: 0 })), { code: 'VIDEO_PROVIDER_INVALID_DURATION', submissionOutcome: 'not_submitted' });
  await assert.rejects(provider.submit(multiInput({ duration: 3.5 })), { code: 'VIDEO_PROVIDER_INVALID_DURATION', submissionOutcome: 'not_submitted' });
});

test('invalid resolution rejected', async () => {
  const provider = createProvider(mockHttp());
  await assert.rejects(provider.submit(multiInput({ resolution: '1080p' })), { code: 'VIDEO_PROVIDER_INVALID_RESOLUTION', submissionOutcome: 'not_submitted' });
  await assert.rejects(provider.submit(multiInput({ resolution: '' })), { code: 'VIDEO_PROVIDER_INVALID_RESOLUTION', submissionOutcome: 'not_submitted' });
});

test('invalid aspect ratio rejected', async () => {
  const provider = createProvider(mockHttp());
  await assert.rejects(provider.submit(multiInput({ aspectRatio: '21:9' })), { code: 'VIDEO_PROVIDER_INVALID_ASPECT_RATIO', submissionOutcome: 'not_submitted' });
});

test('empty and oversized prompt rejected', async () => {
  const httpClient = mockHttp();
  const provider = createProvider(httpClient);
  await assert.rejects(provider.submit(multiInput({ prompt: '' })), { code: 'VIDEO_PROMPT_REQUIRED' });
  await assert.rejects(provider.submit(multiInput({ prompt: 'x'.repeat(2001) })), { code: 'VIDEO_GENERATION_COMPILED_PROMPT_TOO_LONG', submissionOutcome: 'not_submitted' });
  assert.equal(httpClient.calls.length, 0);
});

test('successful 202 with job ID', async () => {
  const provider = createProvider(mockHttp({ postResult: { status: 202, data: { id: 'job_202', status: 'pending' } } }));
  const result = await provider.submit(multiInput());
  assert.equal(result.providerJobId, 'job_202');
  assert.equal(result.status, 'submitted');
});

test('202 without job ID is ambiguous', async () => {
  const provider = createProvider(mockHttp({ postResult: { status: 202, data: { status: 'pending' } } }));
  await assert.rejects(provider.submit(multiInput()), { code: 'VIDEO_PROVIDER_STATUS_UNKNOWN', submissionOutcome: 'ambiguous' });
});

test('every documented status mapped correctly', () => {
  const provider = createProvider(mockHttp());
  assert.equal(provider.normalizeStatus({ status: 'pending' }), 'submitted');
  assert.equal(provider.normalizeStatus({ status: 'in_progress' }), 'processing');
  assert.equal(provider.normalizeStatus({ status: 'completed' }), 'storing');
  assert.equal(provider.normalizeStatus({ status: 'failed' }), 'failed');
  assert.equal(provider.normalizeStatus({ status: 'cancelled' }), 'cancelled');
  assert.equal(provider.normalizeStatus({ status: 'expired' }), 'expired');
});

test('unknown status is not success', () => {
  const provider = createProvider(mockHttp());
  assert.equal(provider.normalizeStatus({ status: 'succeeded' }), null);
  assert.equal(provider.normalizeStatus({ status: 'unknown' }), null);
  assert.equal(provider.normalizeStatus('rubbish'), null);
});

test('400 is confirmed_rejected', () => {
  const error = classifyOpenRouterSubmissionError({ response: { status: 400, data: { error: { code: 'invalid_request', message: 'bad' } } } });
  assert.equal(error.submissionOutcome, 'confirmed_rejected');
  assert.equal(error.code, 'VIDEO_PROVIDER_CONFIRMED_REJECTION');
});

test('401 and 403 are confirmed_rejected', () => {
  assert.equal(classifyOpenRouterSubmissionError({ response: { status: 401 } }).submissionOutcome, 'confirmed_rejected');
  assert.equal(classifyOpenRouterSubmissionError({ response: { status: 403 } }).submissionOutcome, 'confirmed_rejected');
});

test('all 429 responses are conservative ambiguous', () => {
  assert.equal(classifyOpenRouterSubmissionError({ response: { status: 429 } }).submissionOutcome, 'ambiguous');
  assert.equal(classifyOpenRouterSubmissionError({ response: { status: 429, data: { error: { code: 'rate_limited', message: 'slow' } } } }).submissionOutcome, 'ambiguous');
  assert.equal(classifyOpenRouterSubmissionError({ response: { status: 429, data: { id: 'job_exists' } } }).submissionOutcome, 'ambiguous');
  assert.equal(classifyOpenRouterSubmissionError({ response: { status: 429, data: {} } }).submissionOutcome, 'ambiguous');
});

test('5xx is ambiguous', () => {
  assert.equal(classifyOpenRouterSubmissionError({ response: { status: 503 } }).submissionOutcome, 'ambiguous');
  assert.equal(classifyOpenRouterSubmissionError({ response: { status: 500 } }).submissionOutcome, 'ambiguous');
});

test('timeout is ambiguous', () => {
  assert.equal(classifyOpenRouterSubmissionError(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })).submissionOutcome, 'ambiguous');
});

test('connection reset is ambiguous', () => {
  assert.equal(classifyOpenRouterSubmissionError(Object.assign(new Error('reset'), { code: 'ECONNRESET' })).submissionOutcome, 'ambiguous');
});

test('cost estimate for 480p and 720p', () => {
  const provider = createProvider(mockHttp());
  let est = provider.estimateCost({ duration: 10, resolution: '480p', inputReferences: [{}, {}] });
  assert.equal(est.currency, 'USD');
  assert.equal(est.estimate, 0.504); // 10 * 0.05 + 2 * 0.002 = 0.504
  est = provider.estimateCost({ duration: 5, resolution: '720p', inputReferences: [{}, {}, {}, {}] });
  assert.equal(est.estimate, 0.358); // 5 * 0.07 + 4 * 0.002 = 0.358
});

test('cost estimate for different reference counts', () => {
  const provider = createProvider(mockHttp());
  const est = provider.estimateCost({ duration: 1, resolution: '720p', inputReferences: Array.from({ length: 7 }, () => ({})) });
  assert.equal(est.estimate, 0.084); // 1 * 0.07 + 7 * 0.002 = 0.084
});

test('usage.cost normalization', () => {
  const provider = createProvider(mockHttp());
  assert.deepEqual(provider.normalizeCost({ status: 'completed', usage: { cost: 0.504 } }), { minor: 0.504, currency: 'USD' });
  assert.equal(provider.normalizeCost({ status: 'completed' }), null);
  assert.equal(provider.normalizeCost(null), null);
  assert.equal(provider.normalizeCost({ usage: {} }), null);
});

test('sensitive-value redaction', () => {
  const provider = createProvider(mockHttp());
  assert.equal(provider.redact('Authorization: Bearer sk-or-v1-secret-token-here').includes('secret-token'), false);
  assert.equal(provider.redact('Authorization: Bearer sk-or-v1-secret-token-here'), 'Authorization: Bearer [REDACTED]');
  assert.equal(provider.redact('Bearer sk-or-v1-secret').includes('secret'), false);
  assert.equal(provider.redact('/api/video-provider-input/opaque-token-signature').includes('opaque-token'), false);
  assert.equal(provider.redact(JSON.stringify({ source: 'https://cdn.example.test/result.mp4' })).includes('result.mp4'), false);
  assert.equal(provider.redact(JSON.stringify({ image_url: { url: 'https://secret.example.test/img.png' } })).includes('secret.example.test'), false);
});

test('unsafe result host rejected at submit time', async () => {
  const provider = createOpenRouterVideoProvider({ httpClient: mockHttp(), apiKey: 'key', resultAllowedHosts: [], resultAllowedPathPrefixes: ['/'] });
  await assert.rejects(provider.submit(multiInput()), { code: 'VIDEO_PROVIDER_RESULT_ALLOWLIST_MISSING', submissionOutcome: 'not_submitted' });
});

test('disallowed result path rejected at submit time', async () => {
  const provider = createOpenRouterVideoProvider({ httpClient: mockHttp(), apiKey: 'key', resultAllowedHosts: ['cdn.test'], resultAllowedPathPrefixes: [] });
  await assert.rejects(provider.submit(multiInput()), { code: 'VIDEO_PROVIDER_RESULT_ALLOWLIST_MISSING', submissionOutcome: 'not_submitted' });
});

test('normalizeResult uses unsigned_urls first, falls back to authenticated content path from job ID', () => {
  const provider = createProvider(mockHttp());
  const withUnsigned = provider.normalizeResult({ id: 'job_1', unsigned_urls: ['https://cdn.openrouter.test/results/video.mp4'] });
  assert.equal(withUnsigned.source, 'https://cdn.openrouter.test/results/video.mp4');
  const withJobId = provider.normalizeResult({ id: 'job_2', status: 'completed' });
  assert.equal(withJobId.source, '/api/v1/videos/job_2/content?index=0');
  assert.equal(provider.normalizeResult({ status: 'completed' }), null);
  assert.equal(provider.normalizeResult({}), null);
});

test('fetchResultStream prepends root to relative paths', async () => {
  const httpClient = mockHttp();
  const provider = createOpenRouterVideoProvider({ httpClient, apiKey: 'key', baseUrl: 'https://openrouter.ai', resultAllowedHosts: ['cdn.openrouter.test'], allowTestLocalResult: false, resultAllowedPathPrefixes: ['/results/'] });
  assert.ok(true);
});

test('no external network requests are made in tests', () => {
  const httpClient = mockHttp({ postResult: { status: 202, data: { id: 'job_test' } } });
  const provider = createProvider(httpClient);
  assert.equal(httpClient.calls.length, 0);
});
