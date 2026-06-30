const path = require('path');
const fs = require('fs-extra');
const bcrypt = require('bcryptjs');

const ADMIN_FILE_PATH = path.join(__dirname, '../../../../admin.json');
const CONFIG_FILE_PATH = path.join(__dirname, '../../../../config.json');
const AUDIT_LOG_PATH = path.join(__dirname, '../../../../audit.log');
const SYSTEM_PROMPT_PATH = path.join(__dirname, '../../../../system-prompt.txt');

const DEFAULT_CONFIG = {
  model: 'gemini-2.5-flash',
  timeoutMs: 30000,
  features: {
    voiceInput: true,
    quickChips: true,
    practiceMode: true
  }
};

const now = () => new Date().toISOString();
const getDefaultSystemPrompt = async () => (await fs.readFile(SYSTEM_PROMPT_PATH, 'utf8')).trim();

const ensureAdminData = async () => {
  await fs.ensureFile(ADMIN_FILE_PATH);
  const raw = await fs.readFile(ADMIN_FILE_PATH, 'utf8');
  if (!raw.trim()) {
    const password_hash = await bcrypt.hash('admin123', 10);
    const seed = [
      {
        id: '1',
        username: 'admin',
        password_hash,
        role: 'superadmin',
        createdAt: now()
      }
    ];
    await fs.writeJson(ADMIN_FILE_PATH, seed, { spaces: 2 });
    return seed;
  }

  const admins = JSON.parse(raw);
  if (!Array.isArray(admins) || admins.length === 0) {
    const password_hash = await bcrypt.hash('admin123', 10);
    const seed = [
      {
        id: '1',
        username: 'admin',
        password_hash,
        role: 'superadmin',
        createdAt: now()
      }
    ];
    await fs.writeJson(ADMIN_FILE_PATH, seed, { spaces: 2 });
    return seed;
  }
  return admins;
};

const ensureConfigData = async () => {
  const defaultSystemPrompt = await getDefaultSystemPrompt();
  await fs.ensureFile(CONFIG_FILE_PATH);
  const raw = await fs.readFile(CONFIG_FILE_PATH, 'utf8');
  if (!raw.trim()) {
    const seedConfig = { ...DEFAULT_CONFIG };
    await fs.writeJson(CONFIG_FILE_PATH, seedConfig, { spaces: 2 });
    return { ...seedConfig, systemPrompt: defaultSystemPrompt };
  }

  const parsed = JSON.parse(raw);
  return {
    model: typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model.trim() : DEFAULT_CONFIG.model,
    timeoutMs: Number.isFinite(Number(parsed.timeoutMs)) ? Number(parsed.timeoutMs) : DEFAULT_CONFIG.timeoutMs,
    features: {
      voiceInput: Boolean(parsed.features?.voiceInput),
      quickChips: Boolean(parsed.features?.quickChips),
      practiceMode: Boolean(parsed.features?.practiceMode)
    },
    systemPrompt: defaultSystemPrompt
  };
};

const readAuditLogs = async () => {
  await fs.ensureFile(AUDIT_LOG_PATH);
  const raw = await fs.readFile(AUDIT_LOG_PATH, 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_error) {
        return null;
      }
    })
    .filter(Boolean)
    .reverse();
};

const appendAudit = async ({ adminUsername, action, target, details }) => {
  await fs.ensureFile(AUDIT_LOG_PATH);
  const entry = {
    timestamp: now(),
    adminUsername: adminUsername || 'unknown',
    action,
    target: target || null,
    details: details || {}
  };
  await fs.appendFile(AUDIT_LOG_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
};

module.exports = {
  ADMIN_FILE_PATH,
  CONFIG_FILE_PATH,
  SYSTEM_PROMPT_PATH,
  DEFAULT_CONFIG,
  ensureAdminData,
  ensureConfigData,
  readAuditLogs,
  appendAudit
};
