'use strict';

const { spawn } = require('child_process');
const { PassThrough } = require('stream');
const { fetchValidatedResult } = require('./metis-video.provider');
const { fail } = require('../video-generation.errors');
const { VideoStorageError } = require('../storage/video-storage.errors');

function validateProviderBaseUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch (_) { throw fail('VIDEO_PROVIDER_NOT_CONFIGURED', 'تنظیمات سرویس ساخت ویدیو کامل نیست.', 503); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
    throw fail('VIDEO_PROVIDER_NOT_CONFIGURED', 'تنظیمات سرویس ساخت ویدیو کامل نیست.', 503);
  }
  return url.origin;
}

function wgetError() {
  return new VideoStorageError('VIDEO_RESULT_STREAM_INTERRUPTED', undefined, { retryable: true });
}

function createWgetResultStream(plan, { timeoutMs, maxRedirects = 0, spawnImpl = spawn }) {
  const timeoutSeconds = Math.max(1, Math.ceil(Number(timeoutMs) / 1000));
  const redirects = Number(maxRedirects);
  if (!Number.isSafeInteger(redirects) || redirects !== 0) throw new VideoStorageError('VIDEO_RESULT_TOO_MANY_REDIRECTS');
  const child = spawnImpl('wget', [
    '-4', '--https-only', '--no-verbose', `--timeout=${timeoutSeconds}`, `--read-timeout=${timeoutSeconds}`,
    '--tries=1', '--max-redirect=0', '--output-document=-', '--input-file=-'
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  const output = new PassThrough();
  let complete = false;
  const failStream = () => {
    if (complete) return;
    complete = true;
    output.destroy(wgetError());
  };
  child.once('error', failStream);
  child.stdout.once('error', failStream);
  child.stdout.pipe(output, { end: false });
  child.once('close', (code) => {
    if (complete) return;
    complete = true;
    if (code === 0) output.end();
    else output.destroy(wgetError());
  });
  child.stdin.once('error', failStream);
  child.stdin.end(`${plan.url.toString()}\n`);
  return output;
}

async function fetchValidatedResultWithWget(source, { validator, timeoutMs, maxRedirects = 0, spawnImpl = spawn }) {
  const plan = await validator.validate(source);
  return {
    stream: createWgetResultStream(plan, { timeoutMs, maxRedirects, spawnImpl }),
    mimeType: null,
    finalUrl: plan.url,
    contentLength: null
  };
}

module.exports = { fetchValidatedResult, fetchValidatedResultWithWget, createWgetResultStream, validateProviderBaseUrl };
