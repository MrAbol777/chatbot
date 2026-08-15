'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { fetchValidatedResultWithWget } = require('../providers/provider-result-downloader');

function fixtureChild({ exitCode = 0, body = Buffer.from('video-bytes') } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stdin = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  queueMicrotask(() => {
    if (body) child.stdout.end(body);
    child.emit('close', exitCode);
  });
  return child;
}

const validator = { validate: async (source) => ({ url: new URL(source) }) };

test('Banana result downloader uses an IPv4-only wget stream without exposing the result URL in arguments', async () => {
  let command; let args;
  const remote = await fetchValidatedResultWithWget('https://cdn.example.test/results/video.mp4?signature=secret', {
    validator,
    timeoutMs: 60_000,
    maxRedirects: 0,
    spawnImpl: (value, values) => { command = value; args = values; return fixtureChild(); }
  });
  const chunks = [];
  for await (const chunk of remote.stream) chunks.push(chunk);
  assert.equal(command, 'wget');
  assert.ok(args.includes('-4'));
  assert.ok(args.includes('--max-redirect=0'));
  assert.ok(args.includes('--input-file=-'));
  assert.equal(args.some((value) => String(value).includes('signature=secret')), false);
  assert.equal(Buffer.concat(chunks).toString(), 'video-bytes');
});

test('Banana result downloader turns a wget failure into a retryable storage error', async () => {
  const remote = await fetchValidatedResultWithWget('https://cdn.example.test/results/video.mp4', {
    validator,
    timeoutMs: 60_000,
    maxRedirects: 0,
    spawnImpl: () => fixtureChild({ exitCode: 8, body: null })
  });
  await assert.rejects(async () => { for await (const _chunk of remote.stream) {} }, { code: 'VIDEO_RESULT_STREAM_INTERRUPTED', retryable: true });
});
