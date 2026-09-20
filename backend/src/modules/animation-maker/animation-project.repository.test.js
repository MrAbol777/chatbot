'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AnimationProjectRepository } = require('./animation-project.repository');

test('video job creation is idempotent while a project is queued', async () => {
  const calls = [];
  const db = {
    init: async () => {},
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT animation_job_id')) return [[{ animation_job_id: 'animation-video-existing', generation_id: null, status: 'queued', payload: JSON.stringify({ storyboardId: 'storyboard-1' }), created_at: new Date(), updated_at: new Date() }]];
      throw new Error('unexpected query');
    }
  };
  const job = await new AnimationProjectRepository(db).createVideoJob('u1', 'animation-1', { storyboardId: 'storyboard-1' });
  assert.equal(job.id, 'animation-video-existing');
  assert.equal(calls.length, 1);
});
