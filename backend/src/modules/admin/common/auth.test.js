'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const jwt = require('jsonwebtoken');
const {
  buildAdminStateFingerprint,
  createRequireAdminAuth,
  hashAdminSessionId
} = require('./auth');

const SECRET = 'test-admin-secret-that-is-long-enough-for-tests';
const ADMIN = {
  id: 'admin-1',
  username: 'root',
  role: 'superadmin',
  password_hash: 'hash-v1',
  updated_at: new Date('2026-09-05T10:00:00Z')
};

function createToken(admin = ADMIN, sid = 'session-1') {
  return jwt.sign({
    id: admin.id,
    username: admin.username,
    role: admin.role,
    sid,
    adminState: buildAdminStateFingerprint(admin)
  }, SECRET, { expiresIn: '1h' });
}

async function invoke({ token, currentAdmin = ADMIN, revoked = false }) {
  const middleware = createRequireAdminAuth({
    jwtSecret: SECRET,
    adminRepository: {
      findById: async () => currentAdmin,
      isSessionRevoked: async (sessionHash) => {
        assert.equal(sessionHash, hashAdminSessionId('session-1'));
        return revoked;
      }
    }
  });
  const output = { statusCode: 200, body: null, next: false, admin: null };
  const req = { cookies: { admin_token: token } };
  const res = {
    status(code) {
      output.statusCode = code;
      return this;
    },
    json(body) {
      output.body = body;
      return this;
    }
  };
  await middleware(req, res, () => {
    output.next = true;
    output.admin = req.admin;
  });
  return output;
}

test('current non-revoked admin session is accepted', async () => {
  const result = await invoke({ token: createToken() });
  assert.equal(result.next, true);
  assert.equal(result.admin.id, ADMIN.id);
  assert.equal(result.admin.role, ADMIN.role);
});

test('persistently revoked admin session is rejected', async () => {
  const result = await invoke({ token: createToken(), revoked: true });
  assert.equal(result.statusCode, 401);
  assert.equal(result.body.error, 'SESSION_REVOKED');
});

test('role or password change invalidates an older admin token', async () => {
  const changed = { ...ADMIN, role: 'admin', password_hash: 'hash-v2', updated_at: new Date('2026-09-05T11:00:00Z') };
  const result = await invoke({ token: createToken(), currentAdmin: changed });
  assert.equal(result.statusCode, 401);
  assert.equal(result.body.error, 'SESSION_REVOKED');
});
