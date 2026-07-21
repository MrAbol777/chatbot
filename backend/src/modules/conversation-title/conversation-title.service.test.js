const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createConversationTitleService,
  extractConversationTitleReply,
  sanitizeConversationTitle,
  fallbackConversationTitle,
  validateConversationTitleOutput
} = require('./conversation-title.service');

const makeRepository = () => {
  const state = { claimed: false, generated: null, fallback: null };
  return {
    state,
    claimTitleGeneration: async () => {
      if (state.claimed) return false;
      state.claimed = true;
      return true;
    },
    completeGeneratedTitle: async (_userId, _conversationId, payload) => { state.generated = payload; return true; },
    completeFallbackTitle: async (_userId, _conversationId, payload) => { state.fallback = payload; return true; }
  };
};

test('sanitizes generated titles and keeps the 40-character boundary at words', () => {
  assert.equal(sanitizeConversationTitle(' عنوان: «🚀 بهبود FPS بازی گوست.» '), 'بهبود FPS بازی گوست');
  assert.equal(sanitizeConversationTitle('https://example.test/secret 123e4567-e89b-12d3-a456-426614174000'), '');
  assert.ok(sanitizeConversationTitle('تنظیمات گرافیکی بازی برای عملکرد بهتر', 24).length <= 24);
});

test('uses meaningful Persian fallbacks only after a real provider failure', () => {
  assert.equal(fallbackConversationTitle({ originalText: 'سلام', requestType: 'chat', maxCharacters: 40 }), 'سلام و احوال‌پرسی');
  assert.equal(fallbackConversationTitle({ originalText: 'اوکی', requestType: 'chat', maxCharacters: 40 }), 'تأیید و ادامه گفتگو');
  assert.equal(fallbackConversationTitle({ originalText: 'چطور FPS بازی گوست رو بهتر کنم؟', requestType: 'chat', maxCharacters: 40 }), 'بهبود FPS بازی گوست');
  assert.equal(fallbackConversationTitle({ originalText: 'سایت من به دیتابیس وصل نمی‌شه', requestType: 'chat', maxCharacters: 40 }), 'مشکل اتصال دیتابیس');
  assert.equal(fallbackConversationTitle({ originalText: 'تفاوت React و JavaScript چیه؟', requestType: 'chat', maxCharacters: 40 }), 'تفاوت React و JavaScript');
  assert.equal(fallbackConversationTitle({ originalText: '', requestType: 'image_understanding', maxCharacters: 40 }), 'تحلیل تصویر ارسالی');
  assert.equal(fallbackConversationTitle({ originalText: '', requestType: 'image_edit', maxCharacters: 40 }), 'ویرایش تصویر');
});

test('validates the versioned structured provider output', () => {
  const result = validateConversationTitleOutput({ title: 'شناسایی مدل خودرو', language: 'fa', confidence: 0.96, generatorVersion: '1' }, { maxCharacters: 40, version: '1' });
  assert.deepEqual(result, { title: 'شناسایی مدل خودرو', language: 'fa', confidence: 0.96, generatorVersion: '1' });
  assert.throws(() => validateConversationTitleOutput({ title: 'Car model', language: 'en' }, { maxCharacters: 40, version: '1' }));
  assert.deepEqual(
    validateConversationTitleOutput({ title: 'بهبود FPS بازی گوست', confidence: '0.95', generatorVersion: 1, extra: true }, { maxCharacters: 40, version: '1' }),
    { title: 'بهبود FPS بازی گوست', language: 'fa', confidence: 0.95, generatorVersion: '1' }
  );
});

test('extracts the JSON payload from supported Metis and OpenAI response shapes', () => {
  const json = '{"title":"بهبود FPS بازی گوست"}';
  assert.equal(extractConversationTitleReply({ candidates: [{ content: { parts: [{ text: json }] } }] }), json);
  assert.equal(extractConversationTitleReply({ choices: [{ message: { content: `\`\`\`json\n${json}\n\`\`\`` } }] }), `\`\`\`json\n${json}\n\`\`\``);
  assert.equal(extractConversationTitleReply({ output_text: json }), json);
  assert.equal(extractConversationTitleReply({ content: [{ text: json }] }), json);
});

test('calls the provider once, persists a generated title, and is idempotent', async () => {
  const repository = makeRepository();
  let calls = 0;
  const service = createConversationTitleService({
    conversationsRepository: repository,
    httpClient: { post: async () => { calls += 1; return { data: { candidates: [{ content: { parts: [{ text: '{"title":"بهبود FPS بازی گوست","language":"fa","confidence":0.96,"generatorVersion":"1"}' }] } }] } }; } },
    settingsRepository: { getAll: async () => ({}) },
    titleConfig: { apiKey: 'test-key' }
  });
  const first = await service.queue({ userId: 'u1', conversationId: 'c1', originalText: 'چطوری می‌تونم FPS بازی گوست رو بهتر کنم؟' });
  const second = await service.queue({ userId: 'u1', conversationId: 'c1', originalText: 'نباید دوباره اجرا شود' });
  assert.equal(first.title, 'بهبود FPS بازی گوست');
  assert.equal(second.status, 'skipped');
  assert.equal(calls, 1);
  assert.equal(repository.state.generated.title, 'بهبود FPS بازی گوست');
});

test('normalizes greetings without marking a successful provider call as fallback', async () => {
  const repository = makeRepository();
  const service = createConversationTitleService({
    conversationsRepository: repository,
    httpClient: { post: async () => ({ data: { candidates: [{ content: { parts: [{ text: '{"title":"سلام","language":"fa"}' }] } }] } }) },
    settingsRepository: { getAll: async () => ({}) },
    titleConfig: { apiKey: 'test-key' }
  });
  const result = await service.queue({ userId: 'u1', conversationId: 'c-greeting', originalText: 'سلام' });
  assert.deepEqual(result, { status: 'completed', title: 'سلام و احوال‌پرسی' });
  assert.equal(repository.state.generated.title, 'سلام و احوال‌پرسی');
});

test('retries once then stores a local fallback without surfacing the provider failure', async () => {
  const repository = makeRepository();
  let calls = 0;
  const service = createConversationTitleService({
    conversationsRepository: repository,
    httpClient: { post: async () => { calls += 1; throw Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }); } },
    settingsRepository: { getAll: async () => ({}) },
    titleConfig: { apiKey: 'test-key' }
  });
  const result = await service.queue({ userId: 'u1', conversationId: 'c2', originalText: 'سلام' });
  assert.equal(result.status, 'fallback');
  assert.equal(result.title, 'سلام و احوال‌پرسی');
  assert.equal(calls, 2);
  assert.equal(repository.state.fallback.title, 'سلام و احوال‌پرسی');
});
