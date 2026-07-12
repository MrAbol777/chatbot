#!/usr/bin/env bash
set -Eeuo pipefail

cd /root/danoa/chatbot-main

echo "HEALTH"
curl -fsS http://127.0.0.1:3000/healthz
echo

echo "AUTH_SERVICE_NO_PARENT_CONSENT"
docker compose exec -T app node - <<'NODE'
const { createAuthService } = require('./backend/src/modules/auth/auth.service');

const service = createAuthService({
  authRepository: {
    findUserByPhone: async () => null,
    createUser: async (profile) => {
      if (profile.guardianConsent !== undefined) {
        throw new Error('guardianConsent should not be required or sent');
      }
      return 'user-1';
    }
  },
  jwt: {
    verify: () => ({ type: 'signup_profile', phone: '09123456789' }),
    sign: () => 'token'
  },
  jwtSecret: 'test',
  settingsRepository: { getAll: async () => ({ 'auth.validation.age_min': 8 }) },
  logger: { log() {}, warn() {} }
});

service.registerProfile({
  name: 'کودک',
  age: '11',
  phone: '09123456789',
  mode: 'signup',
  signupToken: 'ok'
}).then((result) => {
  console.log(result.statusCode);
  console.log(result.body?.success === true ? 'signup_without_parent_consent_ok' : 'unexpected');
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE

echo "COMPOSE_PS"
docker compose ps
