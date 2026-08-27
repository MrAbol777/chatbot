const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRouterInput,
  createIntentRouterService,
  detectDeterministicRoute
} = require('./intent-router.service');

const warriorPrompt = 'یه عکس بزن یک جنگجوی جوان دختر با موهای بلند مشکی و لباس سیاه';

test('does not deterministically route creation or editing requests to image tasks', () => {
  for (const userMessage of [
    warriorPrompt,
    'عکس تولید کن',
    'یه تصویر از یک قلعه بساز',
    'این تصویر را کارتونی کن',
    '/imagine cinematic city at night'
  ]) {
    assert.equal(detectDeterministicRoute(buildRouterInput({
      userMessage,
      hasCurrentImageAttachment: true
    })), null);
  }
});

test('routes an image creation request to normal chat, not image generation', async () => {
  let requestPayload = null;
  const service = createIntentRouterService({
    httpClient: {
      post: async (_url, payload) => {
        requestPayload = payload;
        return {
          data: {
            choices: [{
              message: {
                content: JSON.stringify({
                  intent: 'chat',
                  confidence: 0.99,
                  targetModule: 'chat',
                  needsImage: false,
                  usesCurrentAttachment: false,
                  usesPreviousImage: false,
                  reasonCode: 'image_studio_required',
                  source: 'intent_router',
                  shouldRespondToUser: false
                })
              }
            }]
          }
        };
      }
    },
    settingsRepository: { getAll: async () => ({}) },
    routerConfig: { apiKey: 'test-key' }
  });

  const result = await service.route({
    userMessage: warriorPrompt,
    hasCurrentImageAttachment: true
  });

  assert.equal(result.ok, true);
  assert.equal(result.route.intent, 'chat');
  assert.equal(result.route.targetModule, 'chat');
  assert.match(requestPayload.systemInstruction.parts[0].text, /Image Studio/);
});

test('routes ordinary chat without image context deterministically and skips the provider', async () => {
  let providerCalls = 0;
  const service = createIntentRouterService({
    httpClient: {
      post: async () => {
        providerCalls += 1;
        throw new Error('provider must not be called');
      }
    },
    settingsRepository: { getAll: async () => ({}) },
    routerConfig: { apiKey: 'test-key' }
  });

  const result = await service.route({ userMessage: 'بله، برنامه سفر را شروع کن' });

  assert.equal(result.ok, true);
  assert.equal(result.route.intent, 'chat');
  assert.equal(result.route.reasonCode, 'no_image_context');
  assert.equal(result.metadata.provider, 'deterministic');
  assert.equal(providerCalls, 0);
});

test('preserves bounded conversational context in router input', () => {
  const input = buildRouterInput({
    userMessage: 'بساز',
    previousUserMessage: warriorPrompt,
    currentTopic: 'درخواست ساخت تصویر جنگجو',
    activeReferences: ['generated image request']
  });

  assert.equal(input.previousUserMessage, warriorPrompt);
  assert.equal(input.currentTopic, 'درخواست ساخت تصویر جنگجو');
  assert.deepEqual(input.activeReferences, ['generated image request']);
});
