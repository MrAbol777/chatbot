const path = require('path');
const fs = require('fs-extra');

const SUBSCRIPTIONS_FILE_PATH = path.join(__dirname, '../../subscriptions.json');

const BUILTIN_PLAN_SEED = [
  {
    id: 'free',
    name: 'رایگان',
    icon: '😊',
    tagline: 'مناسب برای شروع',
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
    monthlyPrice: 199000,
    dailyPrice: 19000,
    dailyMessageLimit: null,
    dailyImageLimit: null,
    features: ['پیام نامحدود', 'ساخت تصویر نامحدود'],
    isActive: true,
    sortOrder: 3
  }
];

const now = () => new Date();

const normalizePlan = (plan = {}, fallback = {}) => {
  const id = typeof plan.id === 'string' && plan.id.trim() ? plan.id.trim() : fallback.id;
  const monthlyPrice = Number.isFinite(Number(plan.monthlyPrice ?? plan.price))
    ? Math.max(0, Number(plan.monthlyPrice ?? plan.price))
    : Number(fallback.monthlyPrice || 0);
  const dailyPrice = Number.isFinite(Number(plan.dailyPrice))
    ? Math.max(0, Number(plan.dailyPrice))
    : Number(fallback.dailyPrice || 0);

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
      plan.dailyMessageLimit === null
        ? null
        : Number.isFinite(Number(plan.dailyMessageLimit))
          ? Math.max(0, Number(plan.dailyMessageLimit))
          : fallback.dailyMessageLimit ?? null,
    dailyImageLimit:
      plan.dailyImageLimit === null
        ? null
        : Number.isFinite(Number(plan.dailyImageLimit))
          ? Math.max(0, Number(plan.dailyImageLimit))
          : fallback.dailyImageLimit ?? null,
    features: Array.isArray(plan.features)
      ? plan.features.map((item) => String(item || '').trim()).filter(Boolean)
      : Array.isArray(fallback.features) ? fallback.features : [],
    isActive: plan.isActive === undefined ? fallback.isActive !== false : Boolean(plan.isActive),
    sortOrder: Number.isFinite(Number(plan.sortOrder)) ? Number(plan.sortOrder) : fallback.sortOrder || 999
  };
};

const fromRow = (row) => {
  const features = typeof row.features === 'string' ? JSON.parse(row.features || '[]') : row.features;
  return normalizePlan({
    id: row.id,
    name: row.name,
    icon: row.icon,
    tagline: row.tagline || '',
    monthlyPrice: row.monthly_price,
    dailyPrice: row.daily_price,
    dailyMessageLimit: row.daily_message_limit === null ? null : Number(row.daily_message_limit),
    dailyImageLimit: row.daily_image_limit === null ? null : Number(row.daily_image_limit),
    features: Array.isArray(features) ? features : [],
    isActive: Boolean(row.is_active),
    sortOrder: Number(row.sort_order || 999)
  });
};

class PlanRepository {
  constructor(db, { subscriptionsFilePath = SUBSCRIPTIONS_FILE_PATH } = {}) {
    this.db = db;
    this.subscriptionsFilePath = subscriptionsFilePath;
    this.seedPromise = null;
  }

  async getSeedPlans() {
    try {
      const raw = await fs.readFile(this.subscriptionsFilePath, 'utf8');
      const parsed = JSON.parse(raw || '{}');
      if (Array.isArray(parsed.plans) && parsed.plans.length > 0) {
        const fallbackById = new Map(BUILTIN_PLAN_SEED.map((plan) => [plan.id, plan]));
        return parsed.plans.map((plan) => normalizePlan(plan, fallbackById.get(plan.id) || {}));
      }
    } catch (_error) {
      // Built-in seed keeps first boot safe when subscriptions.json is absent.
    }
    return BUILTIN_PLAN_SEED.map((plan) => normalizePlan(plan, plan));
  }

  async ensureSeeded() {
    if (this.seedPromise) return this.seedPromise;
    this.seedPromise = (async () => {
      await this.db.init();
      const plans = await this.getSeedPlans();
      const [rows] = await this.db.query('SELECT id FROM app_plans');
      const existingIds = new Set(rows.map((row) => String(row.id)));
      for (const plan of plans) {
        if (!existingIds.has(plan.id)) {
          await this.upsertPlan(plan, { seed: true });
        }
      }
    })();
    return this.seedPromise;
  }

  async listPlans({ activeOnly = false } = {}) {
    await this.ensureSeeded();
    const [rows] = await this.db.query(
      `SELECT * FROM app_plans
       ${activeOnly ? 'WHERE is_active = 1' : ''}
       ORDER BY sort_order ASC, id ASC`
    );
    return rows.map(fromRow);
  }

  async getPlanById(id) {
    await this.ensureSeeded();
    const [rows] = await this.db.query('SELECT * FROM app_plans WHERE id = ? LIMIT 1', [id]);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async upsertPlan(input, { seed = false } = {}) {
    await this.db.init();
    const current = input.id && !seed ? await this.getPlanById(input.id) : null;
    const plan = normalizePlan(input, current || {});
    if (!plan.id) {
      throw new Error('plan id is required');
    }
    const timestamp = now();
    await this.db.query(
      `INSERT INTO app_plans
        (id, name, icon, tagline, monthly_price, daily_price, daily_message_limit, daily_image_limit, features, is_active, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         icon = VALUES(icon),
         tagline = VALUES(tagline),
         monthly_price = VALUES(monthly_price),
         daily_price = VALUES(daily_price),
         daily_message_limit = VALUES(daily_message_limit),
         daily_image_limit = VALUES(daily_image_limit),
         features = VALUES(features),
         is_active = VALUES(is_active),
         sort_order = VALUES(sort_order),
         updated_at = VALUES(updated_at)`,
      [
        plan.id,
        plan.name,
        plan.icon,
        plan.tagline || null,
        plan.monthlyPrice,
        plan.dailyPrice,
        plan.dailyMessageLimit,
        plan.dailyImageLimit,
        JSON.stringify(plan.features),
        plan.isActive ? 1 : 0,
        plan.sortOrder,
        timestamp,
        timestamp
      ]
    );
    return seed ? plan : this.getPlanById(plan.id);
  }

  async setPlanActive(id, isActive) {
    const current = await this.getPlanById(id);
    if (!current) return null;
    return this.upsertPlan({ ...current, isActive: Boolean(isActive) });
  }

  async readUserSubscriptions() {
    try {
      const raw = await fs.readFile(this.subscriptionsFilePath, 'utf8');
      const parsed = JSON.parse(raw || '{}');
      return Array.isArray(parsed.userSubscriptions) ? parsed.userSubscriptions : [];
    } catch (_error) {
      return [];
    }
  }

  async writeUserSubscriptions(userSubscriptions) {
    let parsed = {};
    try {
      parsed = JSON.parse((await fs.readFile(this.subscriptionsFilePath, 'utf8')) || '{}');
    } catch (_error) {
      parsed = {};
    }
    const next = {
      ...parsed,
      plans: parsed.plans || [],
      userSubscriptions: Array.isArray(userSubscriptions) ? userSubscriptions : [],
      updatedAt: new Date().toISOString()
    };
    await fs.writeJson(this.subscriptionsFilePath, next, { spaces: 2 });
    return next.userSubscriptions;
  }

  isSubscriptionActive(subscription) {
    if (!subscription || subscription.status !== 'active') return false;
    if (!subscription.expiresAt) return true;
    return new Date(subscription.expiresAt).getTime() > Date.now();
  }

  async getPlanForUser(userId) {
    const subscriptions = await this.readUserSubscriptions();
    const activeSubscription = subscriptions.find((item) => String(item.userId) === String(userId) && this.isSubscriptionActive(item));
    if (activeSubscription?.planId) {
      const assignedPlan = await this.getPlanById(activeSubscription.planId);
      if (assignedPlan?.isActive) return assignedPlan;
    }
    return this.getPlanById('free');
  }

  async getDailyUsage(userId, date = new Date()) {
    await this.db.init();
    const usageDate = date.toISOString().slice(0, 10);
    const [rows] = await this.db.query(
      'SELECT message_count, image_count FROM app_plan_daily_usage WHERE user_id = ? AND usage_date = ? LIMIT 1',
      [String(userId), usageDate]
    );
    return {
      date: usageDate,
      messageCount: Number(rows[0]?.message_count || 0),
      imageCount: Number(rows[0]?.image_count || 0)
    };
  }

  async incrementDailyUsage(userId, field, amount = 1, date = new Date()) {
    await this.db.init();
    const usageDate = date.toISOString().slice(0, 10);
    const column = field === 'image' ? 'image_count' : 'message_count';
    await this.db.query(
      `INSERT INTO app_plan_daily_usage (user_id, usage_date, message_count, image_count, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE ${column} = ${column} + VALUES(${column}), updated_at = VALUES(updated_at)`,
      [
        String(userId),
        usageDate,
        field === 'message' ? amount : 0,
        field === 'image' ? amount : 0,
        now()
      ]
    );
    return this.getDailyUsage(userId, date);
  }

  async checkLimit(userId, type) {
    const plan = await this.getPlanForUser(userId);
    if (!plan) {
      return { allowed: true, plan: null, usage: null, limit: null };
    }
    const limit = type === 'image' ? plan.dailyImageLimit : plan.dailyMessageLimit;
    if (limit === null || limit === undefined) {
      return { allowed: true, plan, usage: null, limit: null };
    }
    const usage = await this.getDailyUsage(userId);
    const count = type === 'image' ? usage.imageCount : usage.messageCount;
    return {
      allowed: count < limit,
      plan,
      usage,
      limit,
      remaining: Math.max(0, limit - count)
    };
  }
}

module.exports = {
  PlanRepository,
  BUILTIN_PLAN_SEED,
  normalizePlan
};
