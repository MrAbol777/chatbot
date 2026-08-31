'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBananaAiVideoProvider, classifyBananaSubmissionError } = require('../providers/bananaai-video.provider');
const { BANANAAI_VIDEO_MODEL_REGISTRATIONS, BANANAAI_IMAGE_TO_VIDEO_MODEL_ID, BANANAAI_IMAGE_TO_VIDEO_MODEL_KEY, BANANAAI_TEXT_TO_VIDEO_MODEL_KEY, BANANAAI_GROK_T2V_MAX_PROMPT_LENGTH } = require('../video-model.registry');

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
    resolution: '480p', aspectRatio: '16:9', generateAudio: false, ...overrides
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
  assert.deepEqual(payload, { model: 'grok-imagine-video', prompt: 'A calm sea', duration: 5, resolution: '480p', aspect_ratio: '16:9' });
  assert.equal(config.headers.Authorization, 'Bearer fixture-key');
  assert.equal(config.timeout, 10000);
  assert.equal(config.maxRedirects, 0);
  assert.equal(config.httpsAgent.options.family, 4);
  assert.equal(provider.getMetadata().idempotency, 'SUPPORTED_24H');
});

test('BananaAI accepts both documented task ID response spellings', async () => {
  const provider = createProvider(mockHttp({ postResult: { status: 202, data: { taskId: 'task_alias' } } }));
  const result = await provider.submit(input());
  assert.equal(result.providerJobId, 'task_alias');
});

test('BananaAI forwards the compiled prompt without trimming or normalization', async () => {
  const httpClient=mockHttp({postResult:{status:202,data:{id:'task_verbatim'}}});
  const provider=createProvider(httpClient);
  const prompt='  SYSTEM\nUSER: سلام   دنیا  ';
  await provider.submit(input({prompt}));
  assert.equal(httpClient.calls[0][2].prompt,prompt);
});

test('BananaAI forwards a stable idempotency key without exposing it in the URL', async () => {
  const httpClient = mockHttp({ postResult: { status: 202, data: { id: 'task-idempotent' } } });
  const provider = createProvider(httpClient);
  await provider.submit(input({ idempotencyKey: 'request-uuid-1234' }));
  const [, url,, config] = httpClient.calls[0];
  assert.equal(config.headers['Idempotency-Key'], 'request-uuid-1234');
  assert.equal(url.includes('request-uuid-1234'), false);
});

test('BananaAI can use an explicit HTTPS proxy without exposing its credentials in the request URL', async () => {
  const httpClient = mockHttp({ postResult: { status: 202, data: { id: 'task_proxy' } } });
  const provider = createBananaAiVideoProvider({ httpClient, apiKey: 'fixture-key', proxyUrl: 'http://user:pass@proxy.example.test:8080', resultAllowedHosts: ['cdn.banana.test'] });
  await provider.submit(input());
  const config = httpClient.calls[0][3];
  assert.deepEqual(config.proxy, { protocol: 'http', host: 'proxy.example.test', port: 8080, auth: { username: 'user', password: 'pass' } });
});

test('BananaAI I2V sends an owned gateway URL as image_urls', async () => {
  const httpClient = mockHttp({ postResult: { status: 202, data: { id: 'task_i2v', status: 'pending' } } });
  const provider = createProvider(httpClient);
  await provider.submit(input({ capability: 'video.image_to_video', providerInputUrl: 'https://media.example.test/api/video-provider-input/opaque' }));
  assert.deepEqual(httpClient.calls[0][2].image_urls, ['https://media.example.test/api/video-provider-input/opaque']);
});

test('the product registry keeps independent private Grok registrations for T2V and I2V', () => {
  const active = BANANAAI_VIDEO_MODEL_REGISTRATIONS.filter((model) => model.isActive);
  assert.equal(active.length, 2);
  const i2v = active.find((model) => model.internalKey === BANANAAI_IMAGE_TO_VIDEO_MODEL_KEY);
  const t2v = active.find((model) => model.internalKey === BANANAAI_TEXT_TO_VIDEO_MODEL_KEY);
  assert.equal(i2v.providerModelId, BANANAAI_IMAGE_TO_VIDEO_MODEL_ID);
  assert.equal(i2v.isPublic, false);
  assert.deepEqual(i2v.allowedDurations, Array.from({ length: 15 }, (_, index) => index + 1));
  assert.deepEqual(i2v.allowedResolutions, ['480p']);
  assert.equal(t2v.providerModelId, BANANAAI_IMAGE_TO_VIDEO_MODEL_ID);
  assert.equal(t2v.supportsImageToVideo, false);
  assert.deepEqual(t2v.allowedDurations, Array.from({ length: 15 }, (_, index) => index + 1));
  assert.deepEqual(t2v.allowedAspectRatios, ['16:9', '9:16', '1:1']);
  assert.deepEqual(t2v.allowedResolutions, ['480p']);
  assert.equal(t2v.maxPromptLength, BANANAAI_GROK_T2V_MAX_PROMPT_LENGTH);
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
  assert.equal(server.code, 'VIDEO_PROVIDER_UNAVAILABLE');
  const timeout = classifyBananaSubmissionError(Object.assign(new Error('fixture'), { code: 'ETIMEDOUT' }));
  assert.equal(timeout.submissionOutcome, 'ambiguous');
  assert.equal(timeout.code, 'VIDEO_PROVIDER_TIMEOUT');
});

test('validation status 422 is a confirmed rejection even with a non-standard error body', () => {
  const rejected = classifyBananaSubmissionError({ response: { status: 422, data: { message: 'duration is not supported' } } });
  assert.equal(rejected.submissionOutcome, 'confirmed_rejected');
  assert.equal(rejected.code, 'VIDEO_PROVIDER_CONFIRMED_REJECTION');
  assert.deepEqual(rejected.details, { status: 422, providerCode: 'confirmed_rejection' });
});

test('an idempotency request still in progress remains ambiguous instead of becoming a confirmed rejection', () => {
  const pending = classifyBananaSubmissionError({
    response: {
      status: 409,
      data: { error: { code: 'idempotency_key_in_progress', message: 'still registering' } },
      headers: { 'retry-after': '3' }
    }
  });
  assert.equal(pending.submissionOutcome, 'ambiguous');
  assert.equal(pending.code, 'VIDEO_PROVIDER_STATUS_UNKNOWN');
  assert.deepEqual(pending.details, { status:409,providerCode:'idempotency_key_in_progress',retryAfter:'3' });
});

test('provider rejects an over-budget compiled prompt before making HTTP calls', async () => {
  const httpClient = mockHttp(); const provider = createProvider(httpClient);
  await assert.rejects(provider.submit(input({ prompt: 'x'.repeat(BANANAAI_GROK_T2V_MAX_PROMPT_LENGTH + 1) })), { code: 'VIDEO_GENERATION_COMPILED_PROMPT_TOO_LONG', submissionOutcome: 'not_submitted' });
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
