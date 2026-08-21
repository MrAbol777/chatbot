const test = require('node:test');
const assert = require('node:assert/strict');
const AdminRepository = require('./AdminRepository');

test('AdminRepository unit test: creates or updates admin and handles audit logs safely', async () => {
  const fakeRows = [];
  const fakeAuditRows = [];

  const mockDb = {
    query: async (sql, params = []) => {
      if (sql.includes('INSERT INTO app_admins')) {
        const [id, username, password_hash, role, created_at, updated_at] = params;
        const existingIdx = fakeRows.findIndex((r) => r.username === username);
        const item = { id, username, password_hash, role, created_at, updated_at };
        if (existingIdx >= 0) fakeRows[existingIdx] = item;
        else fakeRows.push(item);
        return [{ insertId: 1 }];
      }
      if (sql.includes('FROM app_admins') && sql.includes('WHERE username = ?')) {
        const item = fakeRows.find((r) => r.username === params[0]);
        return [item ? [item] : []];
      }
      if (sql.includes('FROM app_admins')) {
        return [fakeRows];
      }
      if (sql.includes('INSERT INTO app_admin_audit_logs')) {
        const [admin_username, action, target, details, created_at] = params;
        const id = fakeAuditRows.length + 1;
        fakeAuditRows.push({ id, admin_username, action, target, details, created_at });
        return [{ insertId: id }];
      }
      if (sql.includes('SELECT COUNT(*) AS total FROM app_admin_audit_logs')) {
        return [[{ total: fakeAuditRows.length }]];
      }
      if (sql.includes('FROM app_admin_audit_logs')) {
        return [
          fakeAuditRows.map((r) => ({
            id: r.id,
            adminUsername: r.admin_username,
            action: r.action,
            target: r.target,
            details: r.details,
            timestamp: r.created_at
          }))
        ];
      }
      return [[]];
    }
  };

  const repo = new AdminRepository(mockDb);

  // 1. Create admin
  const admin = await repo.createOrUpdate({
    id: '1',
    username: 'admin',
    password_hash: 'hashed_pw',
    role: 'superadmin'
  });
  assert.equal(admin.username, 'admin');
  assert.equal(admin.role, 'superadmin');

  // 2. Find admin
  const found = await repo.findByUsername('admin');
  assert.equal(found.username, 'admin');

  // 3. Append audit log
  const audit = await repo.appendAuditLog({
    adminUsername: 'admin',
    action: 'test_action',
    target: 'test_target',
    details: { foo: 'bar' }
  });
  assert.equal(audit.action, 'test_action');

  // 4. List audit logs
  const logs = await repo.listAuditLogs({ page: 1, pageSize: 10 });
  assert.equal(logs.total, 1);
  assert.equal(logs.items.length, 1);
  assert.equal(logs.items[0].adminUsername, 'admin');
  assert.equal(logs.items[0].details.foo, 'bar');
});
