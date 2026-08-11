'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBananaAiVideoProvider, classifyBananaSubmissionError } = require('../providers/bananaai-video.provider');
const { BANANAAI_VIDEO_MODEL_REGISTRATIONS, BANANAAI_IMAGE_TO_VIDEO_MODEL_ID, BANANAAI_IMAGE_TO_VIDEO_MODEL_KEY } = require('../video-model.registry');

function mockHttp({ postResult, getResult } = {}) {
  const calls = [];
  return {
    calls,
    post: async (...args) => { calls.push(['post', ...args]); if (postResult instanceof Error) throw postResult; return postResult; },
    get: async (...args) => { calls.push(['get', ...args]); if (getResult instanceof Error) throw getResult; return getResult; }
  };
}

function input(overrides = {}) {
  return {
    capability: 'video.text_to_video', providerModelId: 'grok-imagine-video', prompt: 'A calm sea', duration: 5,
    resolution: '720p', aspectRatio: '16:9', generateAudio: false, ...overrides
  };
}

const createProvider = (httpClient) => createBananaAiVideoProvider({ httpClient, apiKey: 'fixture-key', resultAllowedHosts: ['cdn.banana.test'] });

test('BananaAI T2V uses only the documented endpoint and JSON fields', async () => {
  const httpClient = mockHttp({ postResult: { status: 200, data: { id: 'task_fixture', status: 'pending', credits_reserved: 12 } } });
  const provider = createProvider(httpClient);
  const result = await provider.submit(input());
  assert.deepEqual(result, { providerJobId: 'task_fixture', status: 'submitted', creditsReserved: 12 });
  const [, url, payload, config] = httpClient.calls[0];
  assert.equal(url, 'https://bananaai.ir/api/v1/videos/generations');
  assert.deepEqual(payload, { model: 'grok-imagine-video', prompt: 'A calm sea', duration: 5, resolution: '720p', aspect_ratio: '16:9' });
  assert.equal(config.headers.Authorization, 'Bearer fixture-key');
  assert.equal(config.maxRedirects, 0);
});

test('BananaAI I2V sends an owned gateway URL as image_urls', async () => {
  const httpClient = mockHttp({ postResult: { status: 202, data: { id: 'task_i2v', status: 'pending' } } });
  const provider = createProvider(httpClient);
  await provider.submit(input({ capability: 'video.image_to_video', providerInputUrl: 'https://media.example.test/api/video-provider-input/opaque' }));
  assert.deepEqual(httpClient.calls[0][2].image_urls, ['https://media.example.test/api/video-provider-input/opaque']);
});

test('the product registry exposes exactly one active private I2V model and it is Grok', () => {
  const active = BANANAAI_VIDEO_MODEL_REGISTRATIONS.filter((model) => model.isActive);
  assert.equal(active.length, 1);
  assert.equal(active[0].internalKey, BANANAAI_IMAGE_TO_VIDEO_MODEL_KEY);
  assert.equal(active[0].providerModelId, BANANAAI_IMAGE_TO_VIDEO_MODEL_ID);
  assert.equal(active[0].isPublic, false);
  assert.deepEqual(active[0].allowedDurations, Array.from({ length: 15 }, (_, index) => index + 1));
  assert.deepEqual(active[0].allowedAspectRatios, ['16:9', '9:16', '1:1']);
  assert.deepEqual(active[0].allowedResolutions, ['480p']);
});

test('BananaAI refuses undocumented negative prompt and arbitrary missing I2V media', async () => {
  const provider = createProvider(mockHttp());
  await assert.rejects(provider.submit(input({ negativePrompt: 'blur' })), { code: 'VIDEO_PROVIDER_CAPABILITY_UNSUPPORTED' });
  await assert.rejects(provider.submit(input({ capability: 'video.image_to_video' })), { code: 'VIDEO_INPUT_MEDIA_REQUIRED' });
  await assert.rejects(provider.submit(input({ capability: 'video.image_to_video', providerModelId: 'seedance-2', providerInputUrl: 'https://media.example.test/input.jpg' })), { code: 'VIDEO_PROVIDER_MODEL_INVALID' });
});

test('documented 4xx statuses are confirmed rejections even with malformed envelopes', () => {
  const confirmed = classifyBananaSubmissionError({ response: { status: 429, data: { error: { code: 'rate_limit_exceeded', message: 'fixture' } } } });
  assert.equal(confirmed.submissionOutcome, 'confirmed_rejected');
  assert.equal(confirmed.code, 'VIDEO_PROVIDER_RATE_LIMITED');
  assert.deepEqual(confirmed.details, { status: 429, providerCode: 'rate_limit_exceeded' });
  const credits = classifyBananaSubmissionError({ response: { status: 403, data: { error: { code: 'insufficient_credits', message: 'fixture' } } } });
  assert.equal(credits.code, 'VIDEO_PROVIDER_INSUFFICIENT_CREDITS');
  const malformed = classifyBananaSubmissionError({ response: { status: 429, data: { message: 'fixture' } } });
  assert.equal(malformed.submissionOutcome, 'confirmed_rejected');
  const server = classifyBananaSubmissionError({ response: { status: 503, data: { error: { code: 'internal_error', message: 'fixture' } } } });
  assert.equal(server.submissionOutcome, 'ambiguous');
  const timeout = classifyBananaSubmissionError(Object.assign(new Error('fixture'), { code: 'ETIMEDOUT' }));
  assert.equal(timeout.submissionOutcome, 'ambiguous');
});

test('validation status 422 is a confirmed rejection even with a non-standard error body', () => {
  const rejected = classifyBananaSubmissionError({ response: { status: 422, data: { message: 'duration is not supported' } } });
  assert.equal(rejected.submissionOutcome, 'confirmed_rejected');
  assert.equal(rejected.code, 'VIDEO_PROVIDER_CONFIRMED_REJECTION');
  assert.deepEqual(rejected.details, { status: 422, providerCode: 'confirmed_rejection' });
});

test('provider rejects an over-budget compiled prompt before making HTTP calls', async () => {
  const httpClient = mockHttp(); const provider = createProvider(httpClient);
  await assert.rejects(provider.submit(input({ prompt: 'x'.repeat(2001) })), { code: 'VIDEO_GENERATION_COMPILED_PROMPT_TOO_LONG', submissionOutcome: 'not_submitted' });
  assert.equal(httpClient.calls.length, 0);
});

test('2xx without a task ID is ambiguous and cost is null unless completed and deducted', async () => {
  const provider = createProvider(mockHttp({ postResult: { status: 200, data: { status: 'pending' } } }));
  await assert.rejects(provider.submit(input()), { code: 'VIDEO_PROVIDER_STATUS_UNKNOWN', submissionOutcome: 'ambiguous' });
  assert.equal(provider.normalizeCost({ status: 'completed', credits_reserved: 8, credits_deducted: false }), null);
  assert.deepEqual(provider.normalizeCost({ status: 'completed', credits_reserved: 8, credits_deducted: true }), { credits: 8, currency: 'credits' });
});

test('task status mapping follows the official four-state contract', () => {
  const provider = createProvider(mockHttp());
  assert.deepEqual(['pending', 'processing', 'completed', 'failed'].map(provider.normalizeStatus), ['submitted', 'processing', 'storing', 'failed']);
  assert.equal(provider.normalizeStatus('unknown'), null);
});

test('submit is blocked before HTTP while the BananaAI result allowlist is unknown', async () => {
  const httpClient = mockHttp();
  const provider = createBananaAiVideoProvider({ httpClient, apiKey: 'fixture-key', resultAllowedHosts: [] });
  await assert.rejects(provider.submit(input()), { code: 'VIDEO_PROVIDER_RESULT_ALLOWLIST_MISSING', submissionOutcome: 'not_submitted' });
  assert.equal(httpClient.calls.length, 0);
});

test('submit is blocked before HTTP when only a result host is configured without an exact path contract', async () => {
  const httpClient = mockHttp();
  const provider = createBananaAiVideoProvider({ httpClient, apiKey: 'fixture-key', resultAllowedHosts: ['cdn.banana.test'], resultAllowedPathPrefixes: [] });
  await assert.rejects(provider.submit(input()), { code: 'VIDEO_PROVIDER_RESULT_ALLOWLIST_MISSING', submissionOutcome: 'not_submitted' });
  assert.equal(httpClient.calls.length, 0);
});
