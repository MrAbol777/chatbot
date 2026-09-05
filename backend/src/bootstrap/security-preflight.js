'use strict';

const MIN_SECRET_LENGTH = 32;
const KNOWN_WEAK_SECRETS = new Set([
  'danoa-admin-secret',
  'change-this-secret',
  'CHANGE_ME_MINIMUM_32_RANDOM_CHARACTERS',
  'CHANGE_ME_DIFFERENT_MINIMUM_32_RANDOM_CHARACTERS'
]);

function normalizeSecret(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function assertStrongSecret(name, value) {
  const secret = normalizeSecret(value);
  if (!secret || secret.length < MIN_SECRET_LENGTH || KNOWN_WEAK_SECRETS.has(secret)) {
    const error = new Error(`${name} must be set to a unique random secret of at least ${MIN_SECRET_LENGTH} characters in production.`);
    error.code = 'INSECURE_PRODUCTION_SECRET';
    error.secretName = name;
    throw error;
  }
  return secret;
}

function assertSecureProductionConfig(env = process.env) {
  if (String(env.NODE_ENV || '').trim().toLowerCase() !== 'production') {
    return { enforced: false };
  }

  const adminJwtSecret = assertStrongSecret('ADMIN_JWT_SECRET', env.ADMIN_JWT_SECRET);
  const authJwtSecret = assertStrongSecret('AUTH_JWT_SECRET', env.AUTH_JWT_SECRET);

  if (adminJwtSecret === authJwtSecret) {
    const error = new Error('ADMIN_JWT_SECRET and AUTH_JWT_SECRET must be different in production.');
    error.code = 'PRODUCTION_SECRETS_MUST_DIFFER';
    throw error;
  }

  return { enforced: true };
}

module.exports = {
  MIN_SECRET_LENGTH,
  assertStrongSecret,
  assertSecureProductionConfig
};
