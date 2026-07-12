const test = require('node:test');
const assert = require('node:assert/strict');
const { createImageUnderstandingService } = require('./image-understanding.service');

test('vision chat streams provider deltas from an in-memory synthetic image', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(
    new TextEncoder().encode(
      'data: {"candidates":[{"content":{"parts":[{"text":"یک ستاره "}]}}]}\n\n' +
      'data: {"candidates":[{"content":{"parts":[{"text":"رنگی است."}]}}],"usageMetadata":{"totalTokenCount":7}}\n\n'
    ),
    { status: 200, headers: { 'content-type': 'text/event-stream' } }
  );

  const settings = {
    enabled: true,
    provider: 'metis',
    baseUrl: 'https://synthetic.invalid',
    mode: 'balanced',
    defaultModel: 'gemini-test',
    qualityModel: 'gemini-test',
    experimentalModel: '',
    proModel: '',
    allowProModel: false,
    systemPrompt: 'پاسخ کوتاه فارسی بده.',
    temperature: 0.2,
    maxOutputTokens: 100,
    maxImageMb: 5,
    modelHealthEnabled: false,
    transport: 'inline'
  };
  const service = createImageUnderstandingService({
    httpClient: {},
    visionConfig: { apiKey: 'synthetic-key' },
    uploadedImagesRepository: {
      getByIds: async () => [{
        imageId: '11111111-1111-4111-8111-111111111111',
        mimeType: 'image/png',
        base64: Buffer.from('synthetic-image').toString('base64')
      }]
    },
    visionSettingsResolver: {
      getRuntimeSettings: async () => settings,
      validateVisionSettings: () => undefined,
      invalidate: () => undefined,
      normalizeVisionSettings: () => settings
    }
  });
  const deltas = [];
  try {
    const result = await service.streamAnalyzeChatImages({
      req: {},
      res: {},
      message: 'این تصویر چیست؟',
      imageIds: ['11111111-1111-4111-8111-111111111111'],
      history: [],
      requestId: 'vision-stream-test',
      signal: new AbortController().signal,
      onDelta: (delta) => deltas.push(delta)
    });
    assert.deepEqual(deltas, ['یک ستاره ', 'رنگی است.']);
    assert.equal(result.answer, 'یک ستاره رنگی است.');
    assert.equal(result.tokenUsage.totalTokenCount, 7);
  } finally {
    global.fetch = originalFetch;
  }
});
