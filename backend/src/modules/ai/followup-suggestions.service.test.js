const test = require('node:test');
const assert = require('node:assert/strict');

const { createFollowupSuggestionsService, parseSuggestions } = require('./followup-suggestions.service');

const LONG_REPLY = 'آسمان آبی است چون نور خورشید در جو زمین پخش می‌شود و رنگ آبی بیشتر پراکنده می‌شود.';

const buildService = ({ turn, aiReply, calls = [] }) => createFollowupSuggestionsService({
  aiService: {
    callOpenAI: async (messages, options) => {
      calls.push({ messages, options });
      if (aiReply instanceof Error) throw aiReply;
      return { reply: aiReply };
    }
  },
  chatTurnsRepository: { getTurn: async () => turn },
  usersRepository: { findUserById: async () => ({ age: 9 }) },
  logger: { warn() {} }
});

const completedTurn = (overrides = {}) => ({
  user_id: 'u1', status: 'completed', intent: 'chat', user_message: 'چرا آسمان آبیه؟', reply: LONG_REPLY, ...overrides
});

test('parseSuggestions dedupes, trims, drops non-strings and over-long items, caps at three', () => {
  const raw = JSON.stringify({ suggestions: ['الف', 'الف', 7, '', 'ب', 'پ', 'ت', 'x'.repeat(80)] });
  assert.deepEqual(parseSuggestions(raw), ['الف', 'ب', 'پ']);
  assert.deepEqual(parseSuggestions('```json\n{"suggestions":["الف"]}\n```'), ['الف']);
  assert.deepEqual(parseSuggestions('not json'), []);
});

test('returns suggestions for the owner of a completed chat turn and passes the age', async () => {
  const calls = [];
  const service = buildService({ turn: completedTurn(), aiReply: '{"suggestions":["چرا غروب قرمزه؟"]}', calls });
  const result = await service.suggestForTurn({ userId: 'u1', turnId: 't1' });
  assert.deepEqual(result, ['چرا غروب قرمزه؟']);
  assert.match(calls[0].messages[1].content, /سن کاربر: 9/);
});

test('rejects turns owned by another user', async () => {
  const service = buildService({ turn: completedTurn({ user_id: 'other' }), aiReply: '{}' });
  await assert.rejects(() => service.suggestForTurn({ userId: 'u1', turnId: 't1' }), { code: 'TURN_NOT_FOUND' });
});

test('skips non-chat, unfinished and very short turns without calling the model', async () => {
  for (const turn of [completedTurn({ intent: 'image_generation' }), completedTurn({ status: 'streaming' }), completedTurn({ reply: 'سلام!' })]) {
    const calls = [];
    const service = buildService({ turn, aiReply: '{"suggestions":["الف"]}', calls });
    assert.deepEqual(await service.suggestForTurn({ userId: 'u1', turnId: 't1' }), []);
    assert.equal(calls.length, 0);
  }
});

test('model failure degrades to no suggestions, and a regenerated reply bypasses the cache', async () => {
  const failing = buildService({ turn: completedTurn(), aiReply: new Error('upstream down') });
  assert.deepEqual(await failing.suggestForTurn({ userId: 'u1', turnId: 't1' }), []);

  const calls = [];
  let turn = completedTurn();
  const service = createFollowupSuggestionsService({
    aiService: { callOpenAI: async () => { calls.push(1); return { reply: '{"suggestions":["الف"]}' }; } },
    chatTurnsRepository: { getTurn: async () => turn },
    usersRepository: { findUserById: async () => ({ age: 9 }) },
    logger: { warn() {} }
  });
  await service.suggestForTurn({ userId: 'u1', turnId: 't1' });
  await service.suggestForTurn({ userId: 'u1', turnId: 't1' });
  assert.equal(calls.length, 1);
  turn = completedTurn({ reply: `${LONG_REPLY} این یک پاسخ بازتولیدشده با متن متفاوت است.` });
  await service.suggestForTurn({ userId: 'u1', turnId: 't1' });
  assert.equal(calls.length, 2);
});
