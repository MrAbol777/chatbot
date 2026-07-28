const test = require('node:test');
const assert = require('node:assert/strict');

const { reconcileExpiredNoaOperations } = require('../noa-reconciliation');

test('expiry reconciliation finalizes chat, image, and video records after financial release', async () => {
  const statements = [];
  const db = {
    query: async (sql) => {
      statements.push(sql);
      return [{ affectedRows: statements.length }];
    }
  };

  const result = await reconcileExpiredNoaOperations(db);

  assert.deepEqual(result, {
    chatAttempts: 1,
    chatTurns: 2,
    images: 3,
    videos: 4
  });
  assert.equal(statements.length, 4);
  for (const sql of statements) {
    assert.match(sql, /release_reason = 'reservation_expired'/);
    assert.match(sql, /reservation\.status = 'released'/);
  }
  assert.match(statements[0], /app_chat_attempts/);
  assert.match(statements[1], /app_chat_turns/);
  assert.match(statements[2], /image_generations/);
  assert.match(statements[3], /app_video_generations/);
});
