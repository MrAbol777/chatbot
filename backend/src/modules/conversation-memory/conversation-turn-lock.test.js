const test = require('node:test');
const assert = require('node:assert/strict');
const { createConversationMemoryWriterService } = require('./conversation-memory-writer.service');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createLockService = () => createConversationMemoryWriterService({
  httpClient: null,
  settingsRepository: null,
  conversationMemoryService: {},
  logger: { warn: () => undefined }
});

test('conversation turn lock serializes full turns for one conversation', async () => {
  const lockService = createLockService();
  let document = 'initial';
  const reads = [];
  const applied = [];

  const runTurn = async (conversationId, message, delayMs) => {
    const release = await lockService.acquireTurnLock(conversationId);
    try {
      const seenDocument = document;
      reads.push({ message, seenDocument });
      await wait(delayMs);
      document = `${seenDocument}|${message}`;
      applied.push(message);
    } finally {
      release();
    }
  };

  await Promise.all([
    runTurn('019ab1f4-72ac-7d91-8e10-38d95bc8f268', 'first', 30),
    runTurn('019ab1f4-72ac-7d91-8e10-38d95bc8f268', 'second', 0)
  ]);

  assert.deepEqual(applied, ['first', 'second']);
  assert.deepEqual(reads, [
    { message: 'first', seenDocument: 'initial' },
    { message: 'second', seenDocument: 'initial|first' }
  ]);
  assert.equal(document, 'initial|first|second');
});

test('conversation turn lock allows different conversations to run concurrently', async () => {
  const lockService = createLockService();
  const events = [];

  const runTurn = async (conversationId, label) => {
    const release = await lockService.acquireTurnLock(conversationId);
    try {
      events.push(`${label}:start`);
      await wait(25);
      events.push(`${label}:end`);
    } finally {
      release();
    }
  };

  await Promise.all([
    runTurn('119ab1f4-72ac-7d91-8e10-38d95bc8f268', 'a'),
    runTurn('219ab1f4-72ac-7d91-8e10-38d95bc8f268', 'b')
  ]);

  assert.equal(events[0], 'a:start');
  assert.equal(events[1], 'b:start');
  assert.deepEqual(events.slice(2).sort(), ['a:end', 'b:end']);
});
