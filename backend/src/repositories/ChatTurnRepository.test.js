const test = require('node:test');
const assert = require('node:assert/strict');
const { ChatTurnRepository } = require('./ChatTurnRepository');

test('setNoaReservation links a turn to its immutable Noa reservation', async () => {
  let queryArgs = null;
  const db = {
    init: async () => undefined,
    query: async (sql, args) => {
      assert.match(sql, /noa_reservation_id = \?/);
      queryArgs = args;
      return [{ affectedRows: 1 }];
    }
  };
  const repository = new ChatTurnRepository(db);
  assert.equal(await repository.setNoaReservation('turn-12345678', 'reservation-1'), true);
  assert.equal(queryArgs[0], 'reservation-1');
  assert.equal(queryArgs[2], 'turn-12345678');
});

test('claimTurnForExecution only claims terminal retryable turns', async () => {
  const db = {
    init: async () => undefined,
    query: async (sql) => {
      assert.match(sql, /status IN \('failed', 'cancelled'\)/);
      return [{ affectedRows: 1 }];
    }
  };
  const repository = new ChatTurnRepository(db);
  assert.equal(await repository.claimTurnForExecution('turn-12345678'), true);
});

test('setIntent persists the final post-routing intent on the claimed turn', async () => {
  let queryArgs = null;
  const db = {
    query: async (sql, args) => {
      assert.match(sql, /SET intent = \?/);
      queryArgs = args;
      return [{ affectedRows: 1 }];
    }
  };
  const repository = new ChatTurnRepository(db);
  assert.equal(await repository.setIntent('turn-12345678', 'image_understanding'), true);
  assert.equal(queryArgs[0], 'image_understanding');
  assert.equal(queryArgs[2], 'turn-12345678');
});
