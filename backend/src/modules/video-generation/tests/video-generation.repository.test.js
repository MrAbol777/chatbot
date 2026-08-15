'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createVideoGenerationRepository } = require('../video-generation.repository');

test('gallery query includes only the user-facing prompt, never the compiled provider prompt', async () => {
  let statement = '';
  const repository = createVideoGenerationRepository({
    query: async (sql) => { statement = sql; return [[]]; }
  }, { noaBillingService: { reserve: async () => ({ reservationId: 'unused' }) } });
  await repository.listForUser('user-fixture');
  assert.match(statement, /user_prompt/);
  assert.doesNotMatch(statement, /compiled_prompt/);
});
