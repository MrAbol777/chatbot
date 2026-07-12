const test = require('node:test');
const assert = require('node:assert/strict');
const { createAiService } = require('./ai.service');
const { buildChatVisionExtractionPrompt } = require('../image-understanding/image-understanding.service');

test('vision stage is instructed to extract evidence instead of writing the final chat answer', () => {
  const prompt = buildChatVisionExtractionPrompt('متن روی این تابلو چیست؟');
  assert.match(prompt, /فقط مشاهده و استخراج اطلاعات واقعی/);
  assert.match(prompt, /پاسخ نهایی گفتگو را ننویس/);
  assert.match(prompt, /متن روی این تابلو چیست؟/);
});

test('vision analysis and original prompt are grounded through the main chat model without persistence', async () => {
  let providerMessages = null;
  let contextInput = null;
  let saveCalls = 0;

  const service = createAiService({
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    openaiClient: {
      chat: {
        completions: {
          create: async (payload) => {
            providerMessages = payload.messages;
            return {
              choices: [{ message: { content: 'به نظر می‌رسد این یک نقاشی کودکانه از خورشید است.' } }],
              model: 'chat-test',
              usage: { total_tokens: 42 }
            };
          }
        }
      }
    },
    httpClient: { post: async () => { throw new Error('unexpected fallback'); } },
    promptService: {
      getRuntimeConfig: async () => ({ model: 'chat-test', timeoutMs: 5000 }),
      getSystemPrompt: async () => 'تو دستیار کودک‌پسند دانوآ هستی.'
    },
    settingsRepository: {
      getAll: async () => ({
        'ai.chat.model': 'chat-test',
        'ai.chat.timeout_ms': 5000,
        'ai.chat.temperature': 0.4
      })
    },
    usersRepository: { ensureUserExists: async () => 'user-1' },
    conversationsRepository: {
      saveConversationMessages: async () => { saveCalls += 1; }
    },
    eventsRepository: { logEvent: async () => {} },
    conversationContextBuilder: {
      buildChatMessages: async (input) => {
        contextInput = input;
        return {
          messages: [
            { role: 'system', content: input.systemPrompt },
            { role: 'user', content: input.userMessage }
          ]
        };
      }
    },
    logger: { log: () => {} }
  });

  const result = await service.composeVisionChatReply({
    profile: { id: 'user-1' },
    conversationId: 'conversation-1',
    userMessage: 'این نقاشی قشنگه؟',
    visionAnalysis: 'تصویر یک خورشید زرد و خانه‌ای با مدادشمعی را نشان می‌دهد.',
    requestId: 'request-1'
  });

  assert.equal(result.reply, 'به نظر می‌رسد این یک نقاشی کودکانه از خورشید است.');
  assert.match(contextInput.userMessage, /این نقاشی قشنگه؟/);
  assert.match(contextInput.userMessage, /خورشید زرد و خانه‌ای با مدادشمعی/);
  assert.match(contextInput.systemPrompt, /خودت مستقیماً از تصویر دیده‌ای/);
  assert.deepEqual(providerMessages, [
    { role: 'system', content: contextInput.systemPrompt },
    { role: 'user', content: contextInput.userMessage }
  ]);
  assert.equal(saveCalls, 0, 'the composition stage must not persist the raw vision analysis');
});

test('empty vision output never reaches the chat provider', async () => {
  let providerCalled = false;
  const service = createAiService({
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    openaiClient: {
      chat: { completions: { create: async () => { providerCalled = true; return {}; } } }
    },
    httpClient: {},
    promptService: {
      getRuntimeConfig: async () => ({ model: 'chat-test', timeoutMs: 5000 }),
      getSystemPrompt: async () => ''
    },
    usersRepository: { ensureUserExists: async () => 'user-1' },
    conversationsRepository: {},
    eventsRepository: {},
    logger: { log: () => {} }
  });

  await assert.rejects(
    service.composeVisionChatReply({
      profile: { id: 'user-1' },
      userMessage: 'این چیه؟',
      visionAnalysis: '   '
    }),
    (error) => error?.code === 'EMPTY_VISION_REPLY'
  );
  assert.equal(providerCalled, false);
});
