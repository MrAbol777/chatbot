const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ensureAuthSessionSchema } = require('./auth.schema');
const { createSessionRepository, sha256 } = require('./session.repository');
const { createVianaRepository } = require('./viana.repository');

test('schema scopes Viana uniqueness to provider + client + subject', async () => {
  const statements = [];
  await ensureAuthSessionSchema({
    query: async (sql) => {
      statements.push(sql.replace(/\s+/g, ' '));
      return [[], []];
    }
  });
  const identityDdl = statements.find((sql) => sql.includes('app_viana_identities'));
  assert.match(identityDdl, /environment_key VARCHAR\(32\) NOT NULL/);
  assert.match(identityDdl, /UNIQUE KEY uq_viana_identity_provider_client_subject \(provider, client_id, subject\)/);
  const sessionDdl = statements.find((sql) => sql.includes('app_auth_sessions'));
  assert.match(sessionDdl, /session_hash CHAR\(64\) PRIMARY KEY/);
  assert.match(sessionDdl, /csrf_token_hash CHAR\(64\) NOT NULL/);
});

test('OAuth flow storage supports concurrent tabs, one-time consumption, hashes bindings, and expires flows', async () => {
  let current = new Date('2026-07-29T10:00:00.000Z');
  const records = new Map();
  const db = {
    async query(sql, params) {
      if (sql.includes('INSERT INTO app_viana_oauth_flows')) {
        records.set(params[0], {
          state_hash: params[0],
          browser_binding_hash: params[1],
          code_verifier: params[2],
          environment_key: params[3],
          created_at: params[4],
          expires_at: params[5]
        });
      } else if (sql.includes('DELETE FROM app_viana_oauth_flows WHERE expires_at')) {
        for (const [key, row] of records) {
          if (new Date(row.expires_at) < params[0]) records.delete(key);
        }
      }
      return [{ affectedRows: 1 }];
    },
    async getConnection() {
      return {
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release() {},
        async query(sql, params) {
          if (sql.includes('SELECT * FROM app_viana_oauth_flows')) {
            const row = records.get(params[0]);
            return [[row && row.browser_binding_hash === params[1] ? row : undefined].filter(Boolean)];
          }
          if (sql.includes('DELETE FROM app_viana_oauth_flows WHERE state_hash')) {
            const removed = records.delete(params[0]);
            return [{ affectedRows: removed ? 1 : 0 }];
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        }
      };
    }
  };
  const repository = createVianaRepository({ db, now: () => new Date(current) });
  await repository.saveFlow({
    state: 'tab-one-state',
    browserBinding: 'same-browser',
    codeVerifier: 'verifier-one',
    environmentKey: 'development'
  });
  await repository.saveFlow({
    state: 'tab-two-state',
    browserBinding: 'same-browser',
    codeVerifier: 'verifier-two',
    environmentKey: 'development'
  });
  assert.equal(records.has('tab-one-state'), false);
  assert.equal([...records.values()].some((row) => row.browser_binding_hash === 'same-browser'), false);

  assert.deepEqual(
    await repository.consumeFlow({
      state: 'tab-one-state',
      browserBinding: 'same-browser',
      environmentKey: 'development'
    }),
    { valid: true, codeVerifier: 'verifier-one' }
  );
  assert.equal(
    (await repository.consumeFlow({
      state: 'tab-one-state',
      browserBinding: 'same-browser',
      environmentKey: 'development'
    })).valid,
    false
  );
  assert.deepEqual(
    await repository.consumeFlow({
      state: 'tab-two-state',
      browserBinding: 'same-browser',
      environmentKey: 'development'
    }),
    { valid: true, codeVerifier: 'verifier-two' }
  );

  await repository.saveFlow({
    state: 'expired-state',
    browserBinding: 'same-browser',
    codeVerifier: 'expired-verifier',
    environmentKey: 'development',
    ttlMs: 1000
  });
  current = new Date(current.getTime() + 1001);
  const expired = await repository.consumeFlow({
    state: 'expired-state',
    browserBinding: 'same-browser',
    environmentKey: 'development'
  });
  assert.deepEqual(expired, { valid: false, reason: 'expired' });
});

test('Danoa sessions store only hashes, rotate previous session, keep CSRF stable, and enforce idle timeout', async () => {
  let current = new Date('2026-07-29T10:00:00.000Z');
  let stored = null;
  const deletedHashes = [];
  const connection = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release() {},
    async query(sql, params) {
      if (sql.includes('DELETE FROM app_auth_sessions')) {
        deletedHashes.push(params[0]);
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('INSERT INTO app_auth_sessions')) {
        stored = {
          session_hash: params[0],
          csrf_token_hash: params[1],
          user_id: params[2],
          provider: params[3],
          created_at: params[4],
          last_activity_at: params[5],
          absolute_expires_at: params[6],
          name: 'Viana User',
          age: 16,
          phone: null,
          is_banned: 0,
          grade: null,
          gender: null
        };
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected transaction SQL: ${sql}`);
    }
  };
  const db = {
    getConnection: async () => connection,
    async query(sql, params) {
      if (sql.includes('SELECT s.*')) {
        return [[stored && stored.session_hash === params[0] ? stored : undefined].filter(Boolean)];
      }
      if (sql.includes('DELETE FROM app_auth_sessions')) {
        deletedHashes.push(params[0]);
        if (stored?.session_hash === params[0]) stored = null;
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('UPDATE app_auth_sessions SET last_activity_at')) {
        stored.last_activity_at = params[0];
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  const repository = createSessionRepository({
    db,
    csrfSecret: 'csrf-secret',
    idleTimeoutSeconds: 86400,
    absoluteTimeoutSeconds: 2592000,
    now: () => new Date(current),
    touchIntervalMs: Number.MAX_SAFE_INTEGER
  });
  const created = await repository.create({
    userId: 'local-user',
    provider: 'viana',
    previousRawToken: 'previous-opaque-session'
  });
  assert.notEqual(created.rawToken, stored.session_hash);
  assert.equal(stored.session_hash, sha256(created.rawToken));
  assert.equal(stored.csrf_token_hash, sha256(created.csrfToken));
  assert.equal(deletedHashes[0], sha256('previous-opaque-session'));

  const first = await repository.resolve(created.rawToken, { touch: false });
  const second = await repository.resolve(created.rawToken, { touch: false });
  assert.equal(first.csrfToken, created.csrfToken);
  assert.equal(second.csrfToken, created.csrfToken);
  assert.equal(repository.validateCsrf(first, created.csrfToken), true);

  current = new Date(current.getTime() + 86400 * 1000 + 1);
  assert.equal(await repository.resolve(created.rawToken, { touch: false }), null);
  assert.ok(deletedHashes.includes(sha256(created.rawToken)));

  const absolute = await repository.create({ userId: 'local-user', provider: 'viana' });
  stored.absolute_expires_at = new Date(current.getTime() - 1);
  stored.last_activity_at = new Date(current);
  assert.equal(await repository.resolve(absolute.rawToken, { touch: false }), null);
});
