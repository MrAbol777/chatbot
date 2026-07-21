const test = require('node:test');
const assert = require('node:assert/strict');
const { ChatTurnRepository } = require('./ChatTurnRepository');

test('claimQuota succeeds only once for the same turn', async () => {
  let charged = false;
  const db = {
    init: async () => undefined,
    query: async (sql) => {
      assert.match(sql, /quota_charged = 1/);
      if (charged) return [{ affectedRows: 0 }];
      charged = true;
      return [{ affectedRows: 1 }];
    }
  };
  const repository = new ChatTurnRepository(db);
  assert.equal(await repository.claimQuota('turn-12345678'), true);
  assert.equal(await repository.claimQuota('turn-12345678'), false);
});
