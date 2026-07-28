'use strict';

const crypto = require('crypto');
const { noaError } = require('./noa.errors');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest();

function requireText(value, field, maxLength = 191) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > maxLength) {
    throw noaError(
      'NOA_INVALID_FIELD',
      `${field} الزامی است و باید حداکثر ${maxLength} نویسه باشد.`,
      400,
      { field }
    );
  }
  return normalized;
}

function digestValue(value, field = 'payloadHash') {
  if (Buffer.isBuffer(value)) {
    if (value.length !== 32) {
      throw noaError('NOA_INVALID_HASH', `${field} باید SHA-256 باشد.`, 400, { field });
    }
    return Buffer.from(value);
  }

  let serialized;
  try {
    serialized = value !== null && typeof value === 'object'
      ? canonicalJson(value)
      : String(value ?? '');
  } catch (_error) {
    throw noaError('NOA_INVALID_HASH_INPUT', `${field} قابل هش‌کردن نیست.`, 400, { field });
  }
  const normalized = requireText(serialized, field, 8192);
  if (/^[a-f0-9]{64}$/i.test(normalized)) {
    return Buffer.from(normalized, 'hex');
  }
  return sha256(Buffer.from(normalized, 'utf8'));
}

function hashIdempotencyKey(value) {
  const normalized = requireText(value, 'idempotencyKey', 500);
  return sha256(Buffer.from(normalized, 'utf8'));
}

function safeEqual(left, right) {
  const a = Buffer.isBuffer(left) ? left : Buffer.from(left || []);
  const b = Buffer.isBuffer(right) ? right : Buffer.from(right || []);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function normalizeMetadata(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw noaError('NOA_INVALID_METADATA', 'metadata باید یک شیء JSON باشد.', 400);
  }
  const serialized = canonicalJson(value);
  if (Buffer.byteLength(serialized, 'utf8') > 16 * 1024) {
    throw noaError('NOA_METADATA_TOO_LARGE', 'metadata بیش از حد مجاز است.', 413);
  }
  return serialized;
}

module.exports = {
  canonicalJson,
  digestValue,
  hashIdempotencyKey,
  normalizeMetadata,
  requireText,
  safeEqual,
  sha256
};
