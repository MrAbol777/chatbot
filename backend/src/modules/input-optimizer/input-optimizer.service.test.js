const test = require('node:test');
const assert = require('node:assert/strict');
const { createInputOptimizerService } = require('./input-optimizer.service');

const makeService = ({ reply, rows = [] } = {}) => {
  const writes = [];
  return {
    writes,
    service: createInputOptimizerService({
      httpClient: { post: async () => ({ data: { candidates: [{ content: { parts: [{ text: reply }] } }] } }) },
      settingsRepository: { getAll: async () => ({ 'input_optimizer.enabled': true }) },
      optimizationRepository: {
        findByOperation: async () => rows.shift() || null,
        upsert: async (record) => writes.push(record)
      },
      optimizerConfig: { apiKey: 'test-key', timeoutMs: 500, maxRetries: 1 }
    })
  };
};

test('optimizes Persian input into validated English JSON', async () => {
  const { service, writes } = makeService({ reply: JSON.stringify({
    optimizedTextEn: 'Put me next to the man in the provided image.', sourceLanguage: 'fa', ambiguityLevel: 'none',
    needsClarification: false, clarificationQuestionFa: null, preservedEntities: [], protectedSegments: [], confidence: 0.96, optimizerVersion: '1'
  }) });
  const result = await service.optimizeInput({ text: 'منو کنار اون آقا بزار', operationId: 'turn-0001', operationType: 'chat' });
  assert.equal(result.status, 'completed');
  assert.equal(result.optimizedTextEn, 'Put me next to the man in the provided image.');
  assert.equal(writes[0].sourceLanguage, 'fa');
});

test('keeps protected URL unchanged and falls back after invalid provider output', async () => {
  const { service, writes } = makeService({ reply: '{"optimizedTextEn":"Visit the site","sourceLanguage":"fa"}' });
  const result = await service.optimizeInput({ text: 'این لینک رو ببین https://example.com/a', operationId: 'turn-0002', operationType: 'chat' });
  assert.equal(result.status, 'fallback');
  assert.equal(result.optimizedTextEn, 'این لینک رو ببین https://example.com/a');
  assert.equal(writes[0].retryCount, 1);
});

test('reuses a completed optimization for the same operation', async () => {
  const { service } = makeService({ rows: [{ original_input: 'سلام', optimized_input: 'Hello', needs_clarification: 0, ambiguity_level: 'none', status: 'completed', fallback_used: 0, metadata: '{}' }] });
  const result = await service.optimizeInput({ text: 'سلام', operationId: 'turn-0003', operationType: 'chat' });
  assert.equal(result.optimizedTextEn, 'Hello');
  assert.equal(result.status, 'completed');
});
