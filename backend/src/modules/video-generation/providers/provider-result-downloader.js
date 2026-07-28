'use strict';

const { fetchValidatedResult } = require('./metis-video.provider');
const { fail } = require('../video-generation.errors');

function validateProviderBaseUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch (_) { throw fail('VIDEO_PROVIDER_NOT_CONFIGURED', 'تنظیمات سرویس ساخت ویدیو کامل نیست.', 503); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
    throw fail('VIDEO_PROVIDER_NOT_CONFIGURED', 'تنظیمات سرویس ساخت ویدیو کامل نیست.', 503);
  }
  return url.origin;
}

module.exports = { fetchValidatedResult, validateProviderBaseUrl };
