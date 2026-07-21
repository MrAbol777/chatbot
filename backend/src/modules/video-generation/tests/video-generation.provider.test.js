const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeVideoProvider } = require('../providers/fake-video.provider');
const { createMetisVideoProvider } = require('../providers/metis-video.provider');
const { assertVideoProvider } = require('../providers/video-provider.interface');

const verifiedInput = Object.freeze({ mode: 'text-to-video', upstreamVendor: 'kwaivgi', providerModelId: 'kling-v2.5-turbo-pro', providerOperation: 'Video Generation', prompt: 'safe prompt', negativePrompt: 'no text', aspectRatio: '16:9', duration: '5', quality: '', inputMediaReference: null });

test('fake provider supports both modes without network access', async () => {
  const provider = assertVideoProvider(createFakeVideoProvider({ scenario: 'processing' }));
  const text = await provider.submitTextToVideo({ prompt: 'test' });
  const image = await provider.submitImageToVideo({ prompt: 'test', inputMediaReference: 'media-1' });
  assert.match(text.providerJobId, /^fake-/);
  assert.equal((await provider.getJobStatus(image.providerJobId)).status, 'processing');
});

test('fake provider normalizes failure and does not fabricate a result', async () => {
  const provider = createFakeVideoProvider({ scenario: 'failed' });
  const task = await provider.submitTextToVideo({});
  assert.equal(provider.normalizeStatus((await provider.getJobStatus(task.providerJobId)).status), 'failed');
  assert.equal(provider.normalizeResult({}), null);
});

test('fake provider has deterministic programmable polls and no HTTP client', async () => {
  const provider = createFakeVideoProvider();
  provider.plan('job-1', ['queued', 'processing', 'succeeded']);
  assert.equal((await provider.getJobStatus('job-1')).status, 'queued');
  assert.equal((await provider.getJobStatus('job-1')).status, 'processing');
  assert.equal((await provider.getJobStatus('job-1')).status, 'succeeded');
  assert.equal(provider.pollCount('job-1'), 3);
});

test('metis adapter maps statuses with a mocked client only', async () => {
  const calls = []; const client = { get: async (...args) => { calls.push(args); return { data: { status: 'COMPLETED' } }; }, post: async () => ({ data: { id: 'provider-1' } }) };
  const provider = createMetisVideoProvider({ httpClient: client, baseUrl: 'https://mock.invalid', apiKey: 'test-key' });
  const response = await provider.getJobStatus('job/1');
  assert.equal(provider.normalizeStatus(response), 'storing');
  assert.equal(provider.normalizeStatus({ status: 'WAITING' }), 'submitted');
  assert.equal(provider.normalizeStatus({ status: 'unexpected' }), null);
  assert.match(calls[0][0], /job%2F1$/);
});

for (const [name, error, code] of [['429', { response: { status: 429 } }, 'VIDEO_PROVIDER_RATE_LIMITED'], ['5xx', { response: { status: 503 } }, 'VIDEO_PROVIDER_UNAVAILABLE'], ['timeout', Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }), 'VIDEO_PROVIDER_TIMEOUT']]) {
  test(`metis adapter propagates mocked ${name} errors for worker classification`, async () => {
    const provider = createMetisVideoProvider({ httpClient: { get: async () => { throw error; } }, baseUrl: 'https://mock.invalid', apiKey: 'test-key' });
    await assert.rejects(() => provider.getJobStatus('job-1'), { code });
    assert.equal(provider.sanitizeError(error).includes('test-key'), false);
  });
}

test('metis adapter rejects malformed submit response and sanitizes it', async () => {
  const provider = createMetisVideoProvider({ httpClient: { post: async () => ({ data: {} }) }, baseUrl: 'https://mock.invalid', apiKey: 'test-key' });
  await assert.rejects(() => provider.submitTextToVideo(verifiedInput), { code: 'VIDEO_PROVIDER_INVALID_RESPONSE' });
  assert.equal(provider.sanitizeError({ message: 'raw secret' }).includes('secret'), false);
});

test('metis adapter disables redirects for submit and status requests', async () => {
  const calls = []; const provider = createMetisVideoProvider({ httpClient: { post: async (...args) => { calls.push(args); return { data: { id: 'provider-1' } }; }, get: async (...args) => { calls.push(args); return { data: { status: 'SUBMITTED' } }; } }, baseUrl: 'https://mock.invalid', apiKey: 'test-key' });
  await provider.submitTextToVideo(verifiedInput); await provider.getJobStatus('provider-1');
  assert.equal(calls[0][2].maxRedirects, 0); assert.equal(calls[1][1].maxRedirects, 0);
});

test('metis adapter builds the verified Text-to-Video contract without unsupported fields', async () => {
  let body; const provider = createMetisVideoProvider({ httpClient: { post: async (_url, payload) => { body = payload; return { data: { id: 'provider-1' } }; } }, baseUrl: 'https://mock.invalid', apiKey: 'test-key' });
  await provider.submitTextToVideo(verifiedInput);
  assert.deepEqual(body, { model: { name: 'kwaivgi', model: 'kling-v2.5-turbo-pro' }, operation: 'Video Generation', args: { prompt: 'safe prompt', duration: 5, aspect_ratio: '16:9', negative_prompt: 'no text' } });
  assert.equal(JSON.stringify(body).includes('quality'), false);
  assert.equal(JSON.stringify(body).includes('resolution'), false);
  assert.equal(JSON.stringify(body).includes('start_image'), false);
});

test('metis adapter rejects invalid duration and aspect ratio before HTTP', async () => {
  let requests = 0; const provider = createMetisVideoProvider({ httpClient: { post: async () => { requests += 1; return { data: { id: 'provider-1' } }; } }, baseUrl: 'https://mock.invalid', apiKey: 'test-key' });
  await assert.rejects(() => provider.submitTextToVideo({ ...verifiedInput, duration: '6' }), { code: 'VIDEO_PROVIDER_INVALID_DURATION' });
  await assert.rejects(() => provider.submitTextToVideo({ ...verifiedInput, aspectRatio: '4:3' }), { code: 'VIDEO_PROVIDER_INVALID_ASPECT_RATIO' });
  assert.equal(requests, 0);
});
