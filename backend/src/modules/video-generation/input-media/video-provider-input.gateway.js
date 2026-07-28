'use strict';

const { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } = require('crypto');

const EXTENSION_BY_MIME = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
});

function createVideoProviderInputGateway({ secret, publicBaseUrl, ttlSeconds = 300, clock = () => Date.now() }) {
  const configuredSecret = String(secret || '');
  if (configuredSecret && configuredSecret.length < 32) throw new Error('VIDEO_PROVIDER_INPUT_SIGNING_SECRET must contain at least 32 characters.');
  const ttl = Number(ttlSeconds);
  if (!Number.isSafeInteger(ttl) || ttl < 30 || ttl > 900) throw new Error('VIDEO_PROVIDER_INPUT_TTL_SECONDS must be between 30 and 900.');
  const encryptionKey = configuredSecret ? createHash('sha256').update(`encrypt:${configuredSecret}`).digest() : null;
  const signingKey = configuredSecret ? createHash('sha256').update(`sign:${configuredSecret}`).digest() : null;

  function requireConfigured() {
    if (!encryptionKey || !signingKey || !String(publicBaseUrl || '').trim()) throw Object.assign(new Error('Video provider input gateway is not configured.'), { code: 'VIDEO_INPUT_GATEWAY_NOT_CONFIGURED' });
  }

  function encode(claims) {
    requireConfigured();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(claims), 'utf8'), cipher.final()]);
    const encrypted = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
    const signature = createHmac('sha256', signingKey).update(encrypted).digest('base64url');
    return `${encrypted}.${signature}`;
  }

  function decode(token) {
    requireConfigured();
    const [encrypted, providedSignature, extra] = String(token || '').split('.');
    if (!encrypted || !providedSignature || extra) throw Object.assign(new Error('Invalid provider input token.'), { code: 'VIDEO_INPUT_TOKEN_INVALID', status: 404 });
    const expected = createHmac('sha256', signingKey).update(encrypted).digest();
    let provided;
    try { provided = Buffer.from(providedSignature, 'base64url'); } catch (_) { provided = Buffer.alloc(0); }
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) throw Object.assign(new Error('Invalid provider input token.'), { code: 'VIDEO_INPUT_TOKEN_INVALID', status: 404 });
    try {
      const packed = Buffer.from(encrypted, 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', encryptionKey, packed.subarray(0, 12));
      decipher.setAuthTag(packed.subarray(12, 28));
      const claims = JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8'));
      if (claims.v !== 1 || !claims.mediaId || !claims.jobId || !claims.attemptId || !Number.isSafeInteger(claims.exp) || claims.exp <= Math.floor(clock() / 1000)) throw new Error('expired');
      return claims;
    } catch (_) { throw Object.assign(new Error('Expired or invalid provider input token.'), { code: 'VIDEO_INPUT_TOKEN_INVALID', status: 404 }); }
  }

  return {
    createUrl({ mediaId, jobId, attemptId, mimeType = 'image/jpeg' }) {
      const extension = EXTENSION_BY_MIME[String(mimeType || '').toLowerCase()];
      if (!extension) throw Object.assign(new Error('Video provider input MIME type is invalid.'), { code: 'VIDEO_INPUT_MEDIA_INVALID', submissionOutcome: 'not_submitted' });
      const filename = `input.${extension}`;
      const token = encode({ v: 1, mediaId: String(mediaId), jobId: String(jobId), attemptId: String(attemptId), filename, exp: Math.floor(clock() / 1000) + ttl, nonce: randomBytes(12).toString('base64url') });
      const base = new URL(String(publicBaseUrl));
      if (base.username || base.password || base.search || base.hash || (base.protocol !== 'https:' && !(process.env.NODE_ENV === 'test' && base.protocol === 'http:'))) throw new Error('VIDEO_PROVIDER_INPUT_PUBLIC_BASE_URL_INVALID');
      return new URL(`/api/video-provider-input/${token}/${filename}`, base).toString();
    },
    verify: decode,
    redactPath: (value) => String(value || '').replace(/\/api\/video-provider-input\/[^/?\s]+/g, '/api/video-provider-input/[REDACTED]')
  };
}

module.exports = { createVideoProviderInputGateway };
