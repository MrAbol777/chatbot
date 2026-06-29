const path = require('path');
const fs = require('fs-extra');
const bcrypt = require('bcryptjs');

const ADMIN_FILE_PATH = path.join(__dirname, '../../../../admin.json');
const CONFIG_FILE_PATH = path.join(__dirname, '../../../../config.json');
const AUDIT_LOG_PATH = path.join(__dirname, '../../../../audit.log');
const SYSTEM_PROMPT_PATH = path.join(__dirname, '../../../../system-prompt.txt');
const SUBSCRIPTIONS_FILE_PATH = path.join(__dirname, '../../../../subscriptions.json');

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

const DEFAULT_SUBSCRIPTION_PLANS = [
  {
    id: 'free',
    name: 'رایگان',
    icon: '😊',
    tagline: 'مناسب برای شروع',
    price: 0,
    priceLabel: 'رایگان',
    monthlyPrice: 0,
    dailyPrice: 0,
    dailyMessageLimit: 20,
    dailyImageLimit: 0,
    features: ['۲۰ پیام در روز'],
    isActive: true,
    sortOrder: 1
  },
  {
    id: 'gold',
    name: 'طلایی',
    icon: '⭐',
    tagline: 'محبوب‌ترین انتخاب',
    price: 99000,
    priceLabel: '۹۹,۰۰۰',
    monthlyPrice: 99000,
    dailyPrice: 9000,
    dailyMessageLimit: 100,
    dailyImageLimit: 10,
    features: ['۱۰۰ پیام در روز', 'ساخت ۱۰ تصویر در روز'],
    isActive: true,
    sortOrder: 2
  },
  {
    id: 'diamond',
    name: 'الماسی',
    icon: '💎',
    tagline: 'بدون محدودیت',
    price: 199000,
    priceLabel: '۱۹۹,۰۰۰',
    monthlyPrice: 199000,
    dailyPrice: 19000,
    dailyMessageLimit: null,
    dailyImageLimit: null,
    features: ['پیام نامحدود', 'ساخت تصویر نامحدود'],
    isActive: true,
    sortOrder: 3
  }
];

const normalizeSubscriptionPlan = (plan = {}, fallback = {}) => {
  const id = typeof plan.id === 'string' && plan.id.trim() ? plan.id.trim() : fallback.id;
  const monthlyPrice = Number.isFinite(Number(plan.monthlyPrice ?? plan.price))
    ? Math.max(0, Number(plan.monthlyPrice ?? plan.price))
    : fallback.monthlyPrice;
  const dailyPrice = Number.isFinite(Number(plan.dailyPrice)) ? Math.max(0, Number(plan.dailyPrice)) : fallback.dailyPrice;
  return {
    ...fallback,
    ...plan,
    id,
    name: typeof plan.name === 'string' && plan.name.trim() ? plan.name.trim() : fallback.name || id,
    icon: typeof plan.icon === 'string' && plan.icon.trim() ? plan.icon.trim() : fallback.icon || '✨',
    tagline: typeof plan.tagline === 'string' ? plan.tagline.trim() : fallback.tagline || '',
    price: monthlyPrice,
    priceLabel: monthlyPrice === 0 ? 'رایگان' : new Intl.NumberFormat('fa-IR').format(monthlyPrice),
    monthlyPrice,
    dailyPrice,
    dailyMessageLimit:
      plan.dailyMessageLimit === null ? null : Number.isFinite(Number(plan.dailyMessageLimit)) ? Math.max(0, Number(plan.dailyMessageLimit)) : fallback.dailyMessageLimit,
    dailyImageLimit:
      plan.dailyImageLimit === null ? null : Number.isFinite(Number(plan.dailyImageLimit)) ? Math.max(0, Number(plan.dailyImageLimit)) : fallback.dailyImageLimit,
    features: Array.isArray(plan.features)
      ? plan.features.map((item) => String(item || '').trim()).filter(Boolean)
      : fallback.features || [],
    isActive: plan.isActive === undefined ? fallback.isActive !== false : Boolean(plan.isActive),
    sortOrder: Number.isFinite(Number(plan.sortOrder)) ? Number(plan.sortOrder) : fallback.sortOrder || 999
  };
};

const ensureSubscriptionsData = async () => {
  await fs.ensureFile(SUBSCRIPTIONS_FILE_PATH);
  const raw = await fs.readFile(SUBSCRIPTIONS_FILE_PATH, 'utf8');
  if (!raw.trim()) {
    const seed = {
      plans: DEFAULT_SUBSCRIPTION_PLANS,
      userSubscriptions: [],
      updatedAt: now()
    };
    await fs.writeJson(SUBSCRIPTIONS_FILE_PATH, seed, { spaces: 2 });
    return seed;
  }

  const parsed = JSON.parse(raw);
  const fallbackById = new Map(DEFAULT_SUBSCRIPTION_PLANS.map((plan) => [plan.id, plan]));
  const incomingPlans = Array.isArray(parsed.plans) && parsed.plans.length > 0 ? parsed.plans : DEFAULT_SUBSCRIPTION_PLANS;
  const plans = incomingPlans.map((plan) => normalizeSubscriptionPlan(plan, fallbackById.get(plan.id) || {}));
  return {
    plans,
    userSubscriptions: Array.isArray(parsed.userSubscriptions) ? parsed.userSubscriptions : [],
    updatedAt: parsed.updatedAt || now()
  };
};

const writeSubscriptionsData = async (data) => {
  const next = {
    plans: Array.isArray(data.plans) ? data.plans.map((plan) => normalizeSubscriptionPlan(plan, plan)) : DEFAULT_SUBSCRIPTION_PLANS,
    userSubscriptions: Array.isArray(data.userSubscriptions) ? data.userSubscriptions : [],
    updatedAt: now()
  };
  await fs.writeJson(SUBSCRIPTIONS_FILE_PATH, next, { spaces: 2 });
  return next;
};

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
    const seedConfig = { ...DEFAULT_CONFIG, systemPrompt: defaultSystemPrompt };
    await fs.writeJson(CONFIG_FILE_PATH, seedConfig, { spaces: 2 });
    return seedConfig;
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
    systemPrompt:
      typeof parsed.systemPrompt === 'string' && parsed.systemPrompt.trim()
        ? parsed.systemPrompt.trim()
        : defaultSystemPrompt
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
  SUBSCRIPTIONS_FILE_PATH,
  DEFAULT_CONFIG,
  DEFAULT_SUBSCRIPTION_PLANS,
  ensureAdminData,
  ensureConfigData,
  ensureSubscriptionsData,
  writeSubscriptionsData,
  readAuditLogs,
  appendAudit
};
