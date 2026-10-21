#!/usr/bin/env node
/*
 * Replaces assistant replies that contain the internal "conversation document"
 * (memory notes pasted in as an answer) with a short notice.
 *
 *   node scripts/clean-leaked-conversation-documents.js           # dry run, changes nothing
 *   node scripts/clean-leaked-conversation-documents.js --apply   # back up, then update
 *
 * Safety: refuses to run unless the database host is local; the original messages
 * are written to backend/data/leak-cleanup-backup-<timestamp>.json before any
 * UPDATE; only `content` of matching assistant messages is changed, so the
 * conversation structure stays intact. Analytics tables (app_chat_messages,
 * app_chat_turns) are not touched.
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { createRepositories } = require('../src/repositories');

const NOTICE = 'این پاسخ درست ذخیره نشده بود. دوباره بپرس تا جواب تازه بگیری.';
// Same rule the UI uses: three or more distinct memory-document field names.
const FIELDS = [
  'conversation id', 'conversation objective', 'current topic', 'user requirements', 'confirmed facts',
  'open tasks', 'active references', 'important entities', 'last exchange', 'uncertainties'
];
const isLeak = (content) => {
  const text = String(content || '').toLowerCase();
  return FIELDS.filter((field) => text.includes(field)).length >= 3;
};

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const resolveHost = () => {
  const override = String(process.env.LOCAL_DATABASE_HOST || process.env.DATABASE_HOST || '').trim();
  if (override) return override;
  try {
    return new URL(String(process.env.DATABASE_URL || '')).hostname;
  } catch (_error) {
    return '';
  }
};

async function main() {
  const apply = process.argv.includes('--apply');
  const host = resolveHost();
  if (!LOCAL_HOSTS.has(host)) {
    console.error(`Refusing to run: database host "${host || 'unknown'}" is not local. Set LOCAL_DATABASE_HOST=127.0.0.1 for a local database.`);
    process.exit(2);
  }

  const repos = createRepositories();
  await repos.db.init();
  const [rows] = await repos.db.query('SELECT id, user_id, conversation_id, messages FROM app_conversations');

  const affected = [];
  for (const row of rows) {
    let messages = row.messages;
    if (typeof messages === 'string') {
      try { messages = JSON.parse(messages); } catch (_error) { continue; }
    }
    if (!Array.isArray(messages)) continue;
    const leakedIndexes = messages
      .map((message, index) => (message?.role === 'assistant' && isLeak(message.content) ? index : -1))
      .filter((index) => index >= 0);
    if (leakedIndexes.length > 0) affected.push({ row, messages, leakedIndexes });
  }

  console.log(`database host: ${host}`);
  console.log(`conversations scanned: ${rows.length}`);
  console.log(`conversations with leaked replies: ${affected.length}`);
  console.log(`leaked replies: ${affected.reduce((sum, item) => sum + item.leakedIndexes.length, 0)}`);

  if (!apply) {
    console.log('dry run: nothing was changed (use --apply to clean).');
    process.exit(0);
  }
  if (affected.length === 0) process.exit(0);

  const backupDir = path.join(__dirname, '../data');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `leak-cleanup-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(
    backupPath,
    JSON.stringify(affected.map(({ row, messages, leakedIndexes }) => ({
      id: row.id,
      user_id: row.user_id,
      conversation_id: row.conversation_id,
      messages_before: messages,
      leaked_indexes: leakedIndexes
    })), null, 2)
  );
  console.log(`backup written: ${backupPath}`);

  for (const { row, messages, leakedIndexes } of affected) {
    const cleaned = messages.map((message, index) => (leakedIndexes.includes(index) ? { ...message, content: NOTICE } : message));
    await repos.db.query('UPDATE app_conversations SET messages = ? WHERE id = ?', [JSON.stringify(cleaned), row.id]);
  }
  console.log(`updated conversations: ${affected.length}`);
  process.exit(0);
}

main().catch((error) => {
  console.error('failed:', error.message);
  process.exit(1);
});
