'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareRecovery, recoveryDatabaseOptions } = require('../../../../scripts/recover-bananaai-video-result');

test('BananaAI recovery honors a local database host override', () => {
  const options = recoveryDatabaseOptions({ DATABASE_URL:'mysql://user:pass@mysql:3306/chatbot', LOCAL_DATABASE_HOST:'127.0.0.1' });
  assert.equal(options.host, '127.0.0.1');
  assert.equal(options.database, 'chatbot');
});

test('BananaAI recovery atomically replaces a released reservation before storage', async () => {
  const original = {
    id:'81818585-a1f1-4b9c-bed4-301036fba2d8', user_id:'user-1', status:'failed', provider:'bananaai',
    provider_job_id:'provider-job-1', noa_reservation_id:'reservation-old', duration:'5', recovery_started_at:null
  };
  const calls = [];
  const connection = {
    beginTransaction: async () => calls.push('begin'),
    commit: async () => calls.push('commit'),
    rollback: async () => calls.push('rollback'),
    release: () => calls.push('release'),
    query: async (sql) => {
      if (sql.includes('FROM app_video_generations') && sql.includes('FOR UPDATE')) return [[original]];
      if (sql.includes('FROM app_noa_reservations')) return [[{ reservation_id:'reservation-old', status:'released' }]];
      if (sql.startsWith('UPDATE app_video_generations')) { calls.push('job-update'); return [{ affectedRows:1 }]; }
      if (sql.startsWith('SELECT * FROM app_video_generations')) return [[{ ...original, status:'storing', noa_reservation_id:'reservation-new' }]];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const billingService = {
    reserve: async (input, options) => {
      calls.push('reserve');
      assert.equal(input.referenceType, 'video_recovery');
      assert.equal(input.referenceId, original.id);
      assert.equal(options.connection, connection);
      return { reservationId:'reservation-new' };
    }
  };
  const result = await prepareRecovery({ getConnection:async()=>connection }, {
    jobId:original.id, providerJobId:original.provider_job_id, workerId:'recovery-worker'
  }, billingService);
  assert.equal(result.job.status, 'storing');
  assert.equal(result.job.noa_reservation_id, 'reservation-new');
  assert.deepEqual(calls, ['begin','reserve','job-update','commit','release']);
});
