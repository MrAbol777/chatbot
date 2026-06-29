const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const { generateUserId } = require('../src/repositories/helpers');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const databaseUrl = (process.env.DATABASE_URL || '').trim();
const shouldCommit = process.argv.includes('--confirm');
const dryRun = !shouldCommit;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GUEST_USER_ID_PATTERN = /^guest:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (!databaseUrl.startsWith('mysql://')) {
  throw new Error('DATABASE_URL must be a mysql:// URL');
}

const parsed = new URL(databaseUrl);
const databaseName = parsed.pathname.replace(/^\//, '');
const pool = mysql.createPool({
  host: parsed.hostname,
  port: parsed.port ? Number(parsed.port) : 3306,
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
  database: databaseName,
  waitForConnections: true,
  connectionLimit: 5,
  charset: 'utf8mb4'
});

const quoteIdentifier = (value) => {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
  return `\`${value}\``;
};

const hasPhone = (value) => typeof value === 'string' && value.trim().length > 0;
const isValidGuestUserId = (value) => typeof value === 'string' && GUEST_USER_ID_PATTERN.test(value.trim());
const getGuestIdFromUserId = (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.startsWith('guest:') ? text.slice('guest:'.length) : text;
};

const buildUniqueUserId = (isGuest, usedIds) => {
  let nextId = '';
  do {
    nextId = generateUserId({ isGuest });
  } while (usedIds.has(nextId));
  usedIds.add(nextId);
  return nextId;
};

const getColumns = async (conn, columnName, excludeTables = []) => {
  const [rows] = await conn.query(
    `SELECT TABLE_NAME AS tableName
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND COLUMN_NAME = ?
     ORDER BY TABLE_NAME`,
    [databaseName, columnName]
  );
  const excluded = new Set(excludeTables);
  return rows.map((row) => row.tableName).filter((tableName) => !excluded.has(tableName));
};

const countColumnMatches = async (conn, tableName, columnName, values) => {
  if (values.length === 0) return 0;
  const placeholders = values.map(() => '?').join(', ');
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS count
     FROM ${quoteIdentifier(tableName)}
     WHERE ${quoteIdentifier(columnName)} IN (${placeholders})`,
    values
  );
  return Number(rows[0]?.count || 0);
};

const updateColumnByMap = async (conn, tableName, columnName, mappings) => {
  const entries = mappings.filter((item) => item.oldValue && item.newValue && item.oldValue !== item.newValue);
  if (entries.length === 0) return 0;

  const caseParts = entries.map(() => 'WHEN ? THEN ?').join(' ');
  const wherePlaceholders = entries.map(() => '?').join(', ');
  const params = [];
  for (const item of entries) {
    params.push(item.oldValue, item.newValue);
  }
  for (const item of entries) {
    params.push(item.oldValue);
  }

  const [result] = await conn.query(
    `UPDATE ${quoteIdentifier(tableName)}
     SET ${quoteIdentifier(columnName)} = CASE ${quoteIdentifier(columnName)} ${caseParts} ELSE ${quoteIdentifier(columnName)} END
     WHERE ${quoteIdentifier(columnName)} IN (${wherePlaceholders})`,
    params
  );
  return Number(result.affectedRows || 0);
};

const planMigration = async (conn) => {
  const [users] = await conn.query('SELECT * FROM app_users ORDER BY user_id');
  const usedIds = new Set(users.map((user) => String(user.user_id || '').trim()).filter(Boolean));
  const userMappings = [];
  const guestMappings = [];
  let registeredToUpdate = 0;
  let guestsToUpdate = 0;

  for (const user of users) {
    const oldUserId = String(user.user_id || '').trim();
    if (!oldUserId) continue;

    if (hasPhone(user.phone)) {
      const newUserId = buildUniqueUserId(false, usedIds);
      userMappings.push({ user, oldValue: oldUserId, newValue: newUserId, type: 'registered' });
      registeredToUpdate += 1;
      continue;
    }

    if (isValidGuestUserId(oldUserId)) {
      continue;
    }

    const newUserId = buildUniqueUserId(true, usedIds);
    const newGuestId = newUserId.slice('guest:'.length);
    const oldGuestId = getGuestIdFromUserId(oldUserId);
    userMappings.push({ user, oldValue: oldUserId, newValue: newUserId, type: 'guest' });
    if (oldGuestId) {
      guestMappings.push({ oldValue: oldGuestId, newValue: newGuestId });
    }
    guestsToUpdate += 1;
  }

  return { users, userMappings, guestMappings, registeredToUpdate, guestsToUpdate };
};

const insertNewUsers = async (conn, userMappings) => {
  for (const item of userMappings) {
    const user = item.user;
    await conn.query(
      `INSERT INTO app_users (user_id, name, age, phone, is_banned, registered_at, last_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        item.newValue,
        user.name || 'کاربر',
        Number.isFinite(Number(user.age)) ? Number(user.age) : 0,
        user.phone || null,
        Boolean(user.is_banned) ? 1 : 0,
        user.registered_at || new Date(),
        user.last_active || null
      ]
    );
  }
};

const deleteOldUsers = async (conn, userMappings) => {
  const oldIds = userMappings.map((item) => item.oldValue);
  if (oldIds.length === 0) return 0;
  const placeholders = oldIds.map(() => '?').join(', ');
  const [result] = await conn.query(`DELETE FROM app_users WHERE user_id IN (${placeholders})`, oldIds);
  return Number(result.affectedRows || 0);
};

async function main() {
  const conn = await pool.getConnection();
  try {
    const plan = await planMigration(conn);
    const userIdTables = await getColumns(conn, 'user_id', ['app_users']);
    const guestIdTables = await getColumns(conn, 'guest_id');
    const oldUserIds = plan.userMappings.map((item) => item.oldValue);
    const oldGuestIds = plan.guestMappings.map((item) => item.oldValue);

    console.log(`Mode: ${dryRun ? 'dry-run' : 'confirm'}`);
    console.log(`${plan.registeredToUpdate} registered users and ${plan.guestsToUpdate} guests will be updated.`);
    console.log(`Discovered user_id tables: ${userIdTables.length ? userIdTables.join(', ') : '(none)'}`);
    console.log(`Discovered guest_id tables: ${guestIdTables.length ? guestIdTables.join(', ') : '(none)'}`);

    for (const tableName of userIdTables) {
      const count = await countColumnMatches(conn, tableName, 'user_id', oldUserIds);
      console.log(`  ${tableName}.user_id rows to update: ${count}`);
    }
    for (const tableName of guestIdTables) {
      const count = await countColumnMatches(conn, tableName, 'guest_id', oldGuestIds);
      console.log(`  ${tableName}.guest_id rows to update: ${count}`);
    }

    if (dryRun) {
      console.log('Dry-run only. Re-run with --confirm to apply and commit changes.');
      return;
    }

    await conn.beginTransaction();
    await insertNewUsers(conn, plan.userMappings);

    for (const tableName of userIdTables) {
      const affected = await updateColumnByMap(conn, tableName, 'user_id', plan.userMappings);
      console.log(`Updated ${affected} rows in ${tableName}.user_id`);
    }
    for (const tableName of guestIdTables) {
      const affected = await updateColumnByMap(conn, tableName, 'guest_id', plan.guestMappings);
      console.log(`Updated ${affected} rows in ${tableName}.guest_id`);
    }

    const deleted = await deleteOldUsers(conn, plan.userMappings);
    console.log(`Deleted ${deleted} old app_users rows.`);
    await conn.commit();
    console.log('Migration committed successfully.');
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_rollbackError) {
      // No active transaction in dry-run mode.
    }
    console.error('Migration failed. Changes were rolled back.');
    throw error;
  } finally {
    conn.release();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
