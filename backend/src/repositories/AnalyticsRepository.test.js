const test = require('node:test');
const assert = require('node:assert/strict');
const { AnalyticsRepository } = require('./AnalyticsRepository');

test('dashboard chat metrics use persisted user messages rather than legacy events', async () => {
  const queries = [];
  const db = {
    init: async () => undefined,
    query: async (sql) => {
      queries.push(sql);
      return [[{ c: 3 }]];
    }
  };
  const repository = new AnalyticsRepository(db);

  assert.equal(await repository.getActiveUsersToday(), 3);
  assert.equal(await repository.getApiCallsToday(), 3);
  await repository.getApiUsage(1);

  assert.match(queries[0], /app_chat_messages/);
  assert.match(queries[0], /CONCAT\('guest:', guest_id\)/);
  assert.match(queries[1], /app_chat_messages/);
  assert.match(queries[2], /app_chat_messages/);
  assert.doesNotMatch(queries.join('\n'), /message_sent/);
});
