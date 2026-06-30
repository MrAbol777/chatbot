const SETTING_DEFINITIONS = {
  'guest.message_limit': {
    label: 'تعداد پیام مهمان',
    type: 'number',
    category: 'guest',
    defaultValue: 10,
    min: 0,
    adminEditable: true
  },
  'guest.image_limit_daily': {
    label: 'سقف ساخت تصویر مهمان در روز',
    type: 'number',
    category: 'guest',
    defaultValue: 0,
    min: 0,
    adminEditable: true
  },
  'guest.limit_modal.title': {
    label: 'عنوان مودال محدودیت مهمان',
    type: 'string',
    category: 'guest',
    defaultValue: 'برای ادامه ثبت‌نام کن',
    adminEditable: true
  },
  'guest.limit_modal.heading': {
    label: 'تیتر مودال محدودیت مهمان',
    type: 'string',
    category: 'guest',
    defaultValue: 'برای ادامه‌ی گفتگو، لطفاً ثبت‌نام کن!',
    adminEditable: true
  },
  'guest.limit_modal.body': {
    label: 'متن مودال محدودیت مهمان',
    type: 'string',
    category: 'guest',
    defaultValue: 'گفتگوی مهمان به سقف پیام‌ها رسیده و ادامه چت فقط با حساب کاربری انجام می‌شود.',
    adminEditable: true
  },
  'guest.limit_modal.badge_text': {
    label: 'نشان مودال محدودیت مهمان',
    type: 'string',
    category: 'guest',
    defaultValue: '۱۰',
    adminEditable: true
  },
  'guest.limit_modal.cta': {
    label: 'دکمه مودال محدودیت مهمان',
    type: 'string',
    category: 'guest',
    defaultValue: 'ثبت‌نام',
    adminEditable: true
  },
  'upload.image.max_size_mb': {
    label: 'حداکثر حجم عکس (MB)',
    type: 'number',
    category: 'upload',
    defaultValue: 5,
    min: 1,
    max: 50,
    adminEditable: true
  },
  'upload.image.max_files': {
    label: 'حداکثر تعداد عکس',
    type: 'number',
    category: 'upload',
    defaultValue: 5,
    min: 1,
    max: 20,
    adminEditable: true
  },
  'upload.image.allowed_types': {
    label: 'فرمت‌های مجاز عکس',
    type: 'stringArray',
    category: 'upload',
    defaultValue: ['image/jpeg', 'image/png', 'image/webp'],
    allowedValues: ['image/jpeg', 'image/png', 'image/webp'],
    adminEditable: true
  },
  'ai.chat.model': {
    label: 'مدل چت',
    type: 'string',
    category: 'ai',
    defaultValue: 'gemini-2.5-flash',
    adminEditable: true
  },
  'ai.chat.temperature': {
    label: 'Temperature چت',
    type: 'number',
    category: 'ai',
    defaultValue: 0.6,
    min: 0,
    max: 2,
    adminEditable: true
  },
  'ai.chat.timeout_ms': {
    label: 'Timeout چت (ms)',
    type: 'number',
    category: 'ai',
    defaultValue: 30000,
    min: 1000,
    max: 300000,
    adminEditable: true
  },
  'auth.otp.expire_seconds': {
    label: 'زمان اعتبار کد OTP (ثانیه)',
    type: 'number',
    category: 'auth',
    defaultValue: 120,
    min: 30,
    max: 3600,
    adminEditable: true
  },
  'auth.otp.resend_cooldown_ms': {
    label: 'فاصله ارسال مجدد OTP (ms)',
    type: 'number',
    category: 'auth',
    defaultValue: 60000,
    min: 10000,
    max: 3600000,
    adminEditable: true
  },
  'auth.validation.age_min': {
    label: 'حداقل سن ثبت‌نام',
    type: 'number',
    category: 'auth',
    defaultValue: 8,
    min: 0,
    max: 120,
    adminEditable: true
  },
  'auth.validation.age_max': {
    label: 'حداکثر سن ثبت‌نام',
    type: 'number',
    category: 'auth',
    defaultValue: 18,
    min: 0,
    max: 120,
    adminEditable: true
  }
};

const DEFAULT_SETTINGS = Object.fromEntries(
  Object.entries(SETTING_DEFINITIONS).map(([key, definition]) => [key, definition.defaultValue])
);

const normalizeStringArray = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
};

const coerceSettingValue = (key, value) => {
  const definition = SETTING_DEFINITIONS[key];
  if (!definition) {
    throw new Error(`Unknown setting: ${key}`);
  }

  if (definition.type === 'number') {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      throw new Error(`${key} must be a number`);
    }
    if (Number.isFinite(definition.min) && numeric < definition.min) {
      throw new Error(`${key} must be greater than or equal to ${definition.min}`);
    }
    if (Number.isFinite(definition.max) && numeric > definition.max) {
      throw new Error(`${key} must be less than or equal to ${definition.max}`);
    }
    return numeric;
  }

  if (definition.type === 'stringArray') {
    const items = normalizeStringArray(value);
    if (items.length === 0) {
      throw new Error(`${key} cannot be empty`);
    }
    if (Array.isArray(definition.allowedValues)) {
      const invalid = items.find((item) => !definition.allowedValues.includes(item));
      if (invalid) {
        throw new Error(`${key} contains an unsupported value: ${invalid}`);
      }
    }
    return [...new Set(items)];
  }

  const text = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  if (!text) {
    throw new Error(`${key} cannot be empty`);
  }
  return text;
};

const getDefaultSetting = (key) => {
  const definition = SETTING_DEFINITIONS[key];
  return definition ? definition.defaultValue : undefined;
};

module.exports = {
  SETTING_DEFINITIONS,
  DEFAULT_SETTINGS,
  coerceSettingValue,
  getDefaultSetting
};
