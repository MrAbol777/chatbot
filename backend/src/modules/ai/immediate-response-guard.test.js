const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildImmediateCompletionMessages,
  isDeferredWorkReply
} = require('./immediate-response-guard');

test('detects promises to finish ordinary chat work later', () => {
  assert.equal(isDeferredWorkReply('فقط چند لحظه زمان بدید تا برنامه رو با جزئیات آماده کنم.'), true);
  assert.equal(isDeferredWorkReply('چند لحظه دیگه برنامه کامل رو آماده می‌کنم.'), true);
  assert.equal(isDeferredWorkReply('منتظر باش تا برنامه را آماده کنم.'), true);
  assert.equal(isDeferredWorkReply('به‌زودی نتیجه را می‌فرستم.'), true);
});

test('allows a completed answer and builds a bounded repair turn', () => {
  assert.equal(isDeferredWorkReply('روز اول: حرکت از یزد و اقامت شبانه در سمنان.'), false);

  const messages = buildImmediateCompletionMessages(
    [{ role: 'system', content: 'system' }, { role: 'user', content: 'برنامه را بساز' }],
    'چند لحظه صبر کن.'
  );

  assert.equal(messages.length, 4);
  assert.match(messages[0].content, /Complete the user's requested work/);
  assert.match(messages[3].content, /همین حالا کامل کن/);
});
