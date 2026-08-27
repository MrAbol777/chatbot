const test = require('node:test');
const assert = require('node:assert/strict');

const { createConversationContextBuilder } = require('./conversation-context-builder.service');
const {
  isConversationDocumentLeak,
  releaseSafeStreamText
} = require('./conversation-document-leak-guard');

const memoryDocument = '# Conversation Document\n\n## Conversation ID\nabc\n\n## Current Topic\nآموزش';

test('keeps conversation memory in system-only private context', async () => {
  const builder = createConversationContextBuilder({
    conversationMemoryService: {
      readForConversation: async () => ({ content: memoryDocument, metadata: {} })
    }
  });

  const { messages } = await builder.buildChatMessages({
    conversationId: 'abc',
    userMessage: 'سلام، کمکم می‌کنی؟',
    systemPrompt: 'تو یک دستیار فارسی هستی.',
    owner: { userId: 'user-1' }
  });

  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /PRIVATE INTERNAL CONTEXT/);
  assert.match(messages[0].content, /# Conversation Document/);
  assert.equal(messages[1].role, 'user');
  assert.equal(messages[1].content, 'سلام، کمکم می‌کنی؟');
  assert.doesNotMatch(messages[1].content, /Conversation Document/i);
});

test('detects internal conversation documents and holds only a short streaming tail', () => {
  assert.equal(isConversationDocumentLeak('**CONVERSATION DOCUMENT:**\n\n# Conversation Document'), true);
  assert.equal(isConversationDocumentLeak('# Conversation Document\n\n## Conversation ID\na\n\n## Current Topic\nb'), true);
  assert.equal(isConversationDocumentLeak('این یک توضیح معمولی برای کاربر است.'), false);
  const first = releaseSafeStreamText('این پاسخ عادی است و همزمان نمایش داده می‌شود.');
  assert.equal(first.blocked, false);
  assert.ok(first.emit.length > 0);
  assert.ok(first.hold.length > 0);
  assert.equal(releaseSafeStreamText(`${first.hold}\n# Conversation Document`).blocked, true);
});
