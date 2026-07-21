process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateMetisResultUrl, findFirstValidMp4Result, classifyMatchingJobs, databaseFingerprint, findMatchingJobs, RESULT_HOST, RESULT_PATH_PREFIX } = require('../../../../scripts/finish-metis-video-job');
const { databaseFingerprint: liveDatabaseFingerprint } = require('../../../../scripts/test-metis-video-live');

const valid = `https://${RESULT_HOST}${RESULT_PATH_PREFIX}fixture.mp4?signature=redacted`;

test('one-shot Metis finisher accepts only the exact HTTPS storage MP4 path', () => {
  const url = validateMetisResultUrl(valid);
  assert.equal(url.hostname, RESULT_HOST);
  assert.equal(url.pathname.startsWith(RESULT_PATH_PREFIX), true);
  for (const candidate of [
    `http://${RESULT_HOST}${RESULT_PATH_PREFIX}fixture.mp4`,
    `https://sub.${RESULT_HOST}${RESULT_PATH_PREFIX}fixture.mp4`,
    `https://${RESULT_HOST}:444${RESULT_PATH_PREFIX}fixture.mp4`,
    `https://${RESULT_HOST}/api/v2/generate/fixture.mp4`,
    `https://${RESULT_HOST}${RESULT_PATH_PREFIX}fixture.webm`,
    `https://user:pass@${RESULT_HOST}${RESULT_PATH_PREFIX}fixture.mp4`,
    `${valid}#fragment`
  ]) assert.throws(() => validateMetisResultUrl(candidate), { code: 'VIDEO_RESULT_URL_INVALID' });
});

test('one-shot Metis finisher skips invalid artifacts without exposing signed URLs', () => {
  const result = findFirstValidMp4Result({
    generations: [
      { url: `https://${RESULT_HOST}${RESULT_PATH_PREFIX}preview.jpg?secret=never-log` },
      { url: valid }
    ]
  });
  assert.ok(result);
  assert.equal(result.filename, 'metis-result.mp4');
  assert.equal(result.signedQueryPresent, true);
  assert.equal(result.source.includes('secret=never-log'), false);
});

test('one-shot Metis finisher distinguishes an exact terminal job from not-found', () => {
  assert.equal(classifyMatchingJobs([]), 'not-found');
  assert.equal(classifyMatchingJobs([{ status: 'submitted' }]), 'finishable');
  assert.equal(classifyMatchingJobs([{ status: 'failed' }]), 'terminal');
  assert.equal(classifyMatchingJobs([{ status: 'submitted' }, { status: 'failed' }]), 'ambiguous');
});

test('database fingerprints expose configuration mismatches without exposing URLs', () => {
  assert.equal(databaseFingerprint('mysql://user:secret@localhost/one'), databaseFingerprint('mysql://user:secret@localhost/one'));
  assert.notEqual(databaseFingerprint('mysql://user:secret@localhost/one'), databaseFingerprint('mysql://user:secret@localhost/two'));
  assert.equal(liveDatabaseFingerprint('mysql://user:secret@localhost/one'), databaseFingerprint('mysql://user:secret@localhost/one'));
});

test('finish selector keeps the fixture scope and masked provider-id prefix/suffix conditions', async () => {
  let captured;
  const rows = await findMatchingJobs({ query: async (sql, params) => { captured = { sql, params }; return [[{ status: 'submitted' }]]; } });
  assert.equal(rows.length, 1);
  assert.match(captured.sql, /g\.user_id=\? AND g\.provider='metis' AND g\.model_key=\?/);
  assert.deepEqual(captured.params, ['metis-live-user-20260720', 'metis_kling_v25_turbo_pro', '141d%', '%946e']);
});
