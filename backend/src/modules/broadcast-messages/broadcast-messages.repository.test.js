const test = require('node:test');
const assert = require('node:assert/strict');
const { createBroadcastMessagesRepository } = require('./broadcast-messages.repository');

const repository = createBroadcastMessagesRepository({
  init: async () => {},
  query: async () => [[], {}]
});

test('broadcast validation requires message text and a valid audience selection', () => {
  assert.throws(() => repository.validateInput({ audienceType: 'all' }), /MESSAGE_REQUIRED/);
  assert.throws(() => repository.validateInput({ message: 'x', audienceType: 'one', audienceUserIds: [] }), /ONE_USER_REQUIRED/);
  assert.throws(() => repository.validateInput({ message: 'x', audienceType: 'some', audienceUserIds: [] }), /USERS_REQUIRED/);
  assert.throws(() => repository.validateInput({ message: 'x', audienceType: 'all', audienceUserIds: ['u-1'] }), /ALL_USERS_CANNOT_HAVE_IDS/);
});

test('broadcast validation normalizes safe URLs and removes duplicates from user ids', () => {
  const result = repository.validateInput({
    message: 'پیام آزمایشی',
    audienceType: 'some',
    audienceUserIds: ['u-1', 'u-1', 2],
    imageUrl: 'javascript:alert(1)',
    actionUrl: 'https://example.com/info',
    displayMode: 'modal_and_notification'
  });

  assert.deepEqual(result.audienceUserIds, ['u-1', '2']);
  assert.equal(result.imageUrl, null);
  assert.equal(result.actionUrl, 'https://example.com/info');
  assert.equal(result.displayMode, 'modal_and_notification');
});

test('scheduled broadcasts must have a future send time and expiry after schedule', () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const later = new Date(Date.now() + 120_000).toISOString();
  const result = repository.validateInput({
    message: 'زمان‌بندی',
    audienceType: 'all',
    status: 'scheduled',
    scheduledAt: future,
    expiresAt: later
  });
  assert.equal(result.status, 'scheduled');
  assert.throws(() => repository.validateInput({ message: 'زمان‌بندی', audienceType: 'all', status: 'scheduled', scheduledAt: new Date(Date.now() - 1_000).toISOString() }), /SCHEDULE_MUST_BE_FUTURE/);
  assert.throws(() => repository.validateInput({ message: 'زمان‌بندی', audienceType: 'all', status: 'scheduled', scheduledAt: future, expiresAt: future }), /EXPIRY_MUST_BE_AFTER_SCHEDULE/);
});

test('create awaits the database connection before opening a transaction', async () => {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push('begin'); },
    async query(sql) {
      if (sql.includes('INSERT INTO app_broadcast_messages')) return [{ insertId: 42 }];
      if (sql.includes('INSERT IGNORE INTO app_broadcast_recipients')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected query: ${sql}`);
    },
    async commit() { calls.push('commit'); },
    async rollback() { calls.push('rollback'); },
    release() { calls.push('release'); }
  };
  const testRepository = createBroadcastMessagesRepository({
    init: async () => {},
    query: async () => [[], {}],
    getConnection: async () => connection
  });

  const result = await testRepository.create({
    message: 'پیام تستی',
    audienceType: 'some',
    audienceUserIds: ['user-1'],
    sendMode: 'now'
  }, 'admin');

  assert.deepEqual(result, { id: '42', status: 'published', recipientCount: 1 });
  assert.deepEqual(calls, ['begin', 'commit', 'release']);
});
