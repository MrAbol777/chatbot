const { DEFAULT_REFINER_SYSTEM_PROMPT } = require('../image-generation/image-prompt-refiner.service');
const {
  DEFAULT_DESIGN_PROMPT,
  DEFAULT_OCR_PROMPT,
  DEFAULT_PRODUCT_PROMPT,
  DEFAULT_VISION_SYSTEM_PROMPT
} = require('../image-understanding/image-understanding-settings');
const { INTENT_ROUTER_SYSTEM_PROMPT } = require('../intent-router/intent-router.prompt');
const { MEMORY_WRITER_SYSTEM_PROMPT } = require('../conversation-memory/conversation-memory.prompt');

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
    nullable: true,
    min: 0,
    adminEditable: true
  },
  'guest.image_limit_hourly': {
    label: 'سقف ساخت تصویر مهمان در ساعت',
    type: 'number',
    category: 'guest',
    defaultValue: 0,
    nullable: true,
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
  'ai.image.model': {
    label: 'مدل ساخت تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: 'gemini-2.5-flash-image',
    nullable: true,
    adminEditable: true
  },
  'ai.image.enabled': {
    label: 'فعال بودن ساخت تصویر',
    type: 'boolean',
    category: 'ai',
    defaultValue: true,
    adminEditable: true
  },
  'ai.image.model_preset': {
    label: 'Preset مدل ساخت تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: 'nano-banana',
    allowedValues: ['nano-banana-pro', 'nano-banana', 'flux-schnell', 'custom'],
    adminEditable: true
  },
  'ai.image.model.admin_value': {
    label: 'Admin model ساخت تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: 'gemini-2.5-flash-image',
    adminEditable: true
  },
  'ai.image.model.runtime_provider_name': {
    label: 'Runtime provider name ساخت تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: 'google',
    adminEditable: true
  },
  'ai.image.model.runtime_model': {
    label: 'Runtime model ساخت تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: 'nano-banana',
    adminEditable: true
  },
  'ai.image.operation': {
    label: 'Operation ساخت تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: 'Imagine',
    adminEditable: true
  },
  'ai.image.provider': {
    label: 'Provider ساخت تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: 'metis',
    allowedValues: ['metis', 'gemini', 'xai'],
    adminEditable: true
  },
  'ai.image.base_url': {
    label: 'Base URL ساخت تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: 'https://api.metisai.ir',
    adminEditable: true
  },
  'ai.image.resolution': {
    label: 'رزولوشن تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: '1K',
    allowedValues: ['1K', '2K'],
    adminEditable: true
  },
  'ai.image.aspect_ratio': {
    label: 'نسبت تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: '1:1',
    allowedValues: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
    adminEditable: true
  },
  'ai.image.output_format': {
    label: 'فرمت خروجی تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: 'jpg',
    allowedValues: ['jpg', 'png'],
    adminEditable: true
  },
  'ai.image.safety_filter_level': {
    label: 'سطح safety filter تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: 'block_only_high',
    allowedValues: ['block_only_high', 'block_medium_and_above', 'block_low_and_above', 'block_none'],
    adminEditable: true
  },
  'ai.image.prompt_enhancer_enabled': {
    label: 'فعال بودن prompt enhancer تصویر',
    type: 'boolean',
    category: 'ai',
    defaultValue: true,
    adminEditable: true
  },
  'ai.image.default_negative_prompt': {
    label: 'Negative prompt پیش‌فرض تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: 'no humans, no unrelated objects, no text distortion, no watermark',
    adminEditable: true
  },
  'ai.image.poll_interval_ms': {
    label: 'Image poll interval (ms)',
    type: 'number',
    category: 'ai',
    defaultValue: 2000,
    min: 500,
    max: 10000,
    adminEditable: true
  },
  'ai.image.poll_timeout_ms': {
    label: 'Image poll timeout (ms)',
    type: 'number',
    category: 'ai',
    defaultValue: 120000,
    min: 10000,
    max: 300000,
    adminEditable: true
  },
  'ai.image.max_download_mb': {
    label: 'حداکثر حجم دانلود تصویر (MB)',
    type: 'number',
    category: 'ai',
    defaultValue: 10,
    min: 1,
    max: 25,
    adminEditable: true
  },
  'ai.image.edit_enabled': {
    label: 'فعال بودن image edit',
    type: 'boolean',
    category: 'ai',
    defaultValue: true,
    adminEditable: true
  },
  'ai.image.custom_args_json': {
    label: 'Custom args JSON تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: '{}',
    adminEditable: true
  },
  'ai.image.prompt_refiner.enabled': {
    label: 'فعال بودن بهینه‌ساز پرامپت تصویر',
    type: 'boolean',
    category: 'ai',
    defaultValue: true,
    adminEditable: true
  },
  'ai.image.prompt_refiner.provider': {
    label: 'Provider بهینه‌ساز پرامپت تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: 'metis',
    allowedValues: ['metis'],
    adminEditable: true
  },
  'ai.image.prompt_refiner.model': {
    label: 'مدل بهینه‌ساز پرامپت تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: 'gemini-2.5-flash',
    adminEditable: true
  },
  'ai.image.prompt_refiner.temperature': {
    label: 'Temperature بهینه‌ساز پرامپت تصویر',
    type: 'number',
    category: 'ai',
    defaultValue: 0.2,
    min: 0,
    max: 2,
    adminEditable: true
  },
  'ai.image.prompt_refiner.max_tokens': {
    label: 'Max tokens بهینه‌ساز پرامپت تصویر',
    type: 'number',
    category: 'ai',
    defaultValue: 700,
    min: 100,
    max: 2000,
    adminEditable: true
  },
  'ai.image.prompt_refiner.timeout_ms': {
    label: 'Timeout بهینه‌ساز پرامپت تصویر (ms)',
    type: 'number',
    category: 'ai',
    defaultValue: 6000,
    min: 1000,
    max: 30000,
    adminEditable: true
  },
  'ai.image.prompt_refiner.fallback_enabled': {
    label: 'Fallback داخلی بهینه‌ساز پرامپت تصویر',
    type: 'boolean',
    category: 'ai',
    defaultValue: true,
    adminEditable: true
  },
  'ai.image.prompt_refiner.cache_enabled': {
    label: 'Cache بهینه‌ساز پرامپت تصویر',
    type: 'boolean',
    category: 'ai',
    defaultValue: true,
    adminEditable: true
  },
  'ai.image.prompt_refiner.cache_ttl_minutes': {
    label: 'TTL cache بهینه‌ساز پرامپت تصویر (minutes)',
    type: 'number',
    category: 'ai',
    defaultValue: 1440,
    min: 1,
    max: 10080,
    adminEditable: true
  },
  'ai.image.prompt_refiner.preserve_persian_text': {
    label: 'حفظ متن فارسی داخل تصویر',
    type: 'boolean',
    category: 'ai',
    defaultValue: true,
    adminEditable: true
  },
  'ai.image.prompt_refiner.human_subject_guard': {
    label: 'Guard سوژه انسانی',
    type: 'boolean',
    category: 'ai',
    defaultValue: true,
    adminEditable: true
  },
  'ai.image.prompt_refiner.child_safety_guard': {
    label: 'Guard ایمنی کودک',
    type: 'boolean',
    category: 'ai',
    defaultValue: true,
    adminEditable: true
  },
  'ai.image.prompt_refiner.default_style': {
    label: 'Style پیش‌فرض بهینه‌ساز پرامپت تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: 'clean, colorful, child-friendly digital illustration, soft lighting, high quality',
    adminEditable: true
  },
  'ai.image.prompt_refiner.default_negative_prompt': {
    label: 'Negative prompt پیش‌فرض بهینه‌ساز پرامپت تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: 'no watermark, no distorted text, no extra fingers, no blurry face, no unrelated objects',
    adminEditable: true
  },
  'ai.image.prompt_refiner.system_prompt': {
    label: 'System prompt بهینه‌ساز پرامپت تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: DEFAULT_REFINER_SYSTEM_PROMPT,
    adminEditable: true
  },
  'ai.image.prompt_refiner.store_metadata': {
    label: 'ذخیره metadata بهینه‌ساز پرامپت تصویر',
    type: 'boolean',
    category: 'ai',
    defaultValue: true,
    adminEditable: true
  },
  'ai.image.prompt_refiner.allow_chat_key_fallback': {
    label: 'اجازه fallback به METIS_CHAT_API_KEY',
    type: 'boolean',
    category: 'ai',
    defaultValue: false,
    adminEditable: true
  },
  'ai.vision.enabled': {
    label: 'فعال بودن خواندن و تحلیل تصویر',
    type: 'boolean',
    category: 'ai',
    defaultValue: true,
    adminEditable: true
  },
  'ai.vision.provider': {
    label: 'Provider خواندن تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: 'metis-gemini',
    allowedValues: ['metis-gemini'],
    adminEditable: true
  },
  'ai.vision.model': {
    label: 'مدل legacy خواندن تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: 'gemini-2.5-flash',
    adminEditable: true
  },
  'ai.vision.default_model': {
    label: 'مدل default خواندن تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: 'gemini-2.5-flash',
    adminEditable: true
  },
  'ai.vision.fast_model': {
    label: 'مدل fast خواندن تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: 'gemini-2.5-flash',
    adminEditable: true
  },
  'ai.vision.experimental_model': {
    label: 'مدل experimental خواندن تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: 'gemini-2.5-flash-lite-preview',
    adminEditable: true
  },
  'ai.vision.quality_model': {
    label: 'مدل quality خواندن تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: 'gemini-2.5-flash',
    adminEditable: true
  },
  'ai.vision.pro_model': {
    label: 'مدل pro خواندن تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: 'gemini-2.5-pro',
    adminEditable: true
  },
  'ai.vision.mode': {
    label: 'Mode خواندن تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: 'balanced',
    allowedValues: ['economy', 'balanced', 'accurate', 'pro'],
    adminEditable: true
  },
  'ai.vision.allow_pro_model': {
    label: 'اجازه استفاده از مدل Pro در Vision',
    type: 'boolean',
    category: 'ai',
    defaultValue: false,
    adminEditable: true
  },
  'ai.vision.timeout_ms': {
    label: 'Timeout خواندن تصویر (ms)',
    type: 'number',
    category: 'ai',
    defaultValue: 30000,
    min: 5000,
    max: 180000,
    adminEditable: true
  },
  'ai.vision.fallback_timeout_ms': {
    label: 'Fallback timeout خواندن تصویر (ms)',
    type: 'number',
    category: 'ai',
    defaultValue: 45000,
    min: 5000,
    max: 180000,
    adminEditable: true
  },
  'ai.vision.max_image_mb': {
    label: 'حداکثر حجم تصویر Vision (MB)',
    type: 'number',
    category: 'ai',
    defaultValue: 10,
    min: 1,
    max: 25,
    adminEditable: true
  },
  'ai.vision.transport': {
    label: 'Transport خواندن تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: 'auto',
    allowedValues: ['inline', 'metis_storage', 'auto'],
    adminEditable: true
  },
  'ai.vision.media_resolution': {
    label: 'Media resolution خواندن تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: 'auto',
    allowedValues: ['auto', 'normal', 'high'],
    adminEditable: true
  },
  'ai.vision.temperature': {
    label: 'Temperature خواندن تصویر',
    type: 'number',
    category: 'ai',
    defaultValue: 0.1,
    min: 0,
    max: 2,
    adminEditable: true
  },
  'ai.vision.max_output_tokens': {
    label: 'Max output tokens خواندن تصویر',
    type: 'number',
    category: 'ai',
    defaultValue: 900,
    min: 100,
    max: 8192,
    adminEditable: true
  },
  'ai.vision.system_prompt': {
    label: 'System prompt خواندن تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: DEFAULT_VISION_SYSTEM_PROMPT,
    adminEditable: true
  },
  'ai.vision.ocr_prompt': {
    label: 'OCR prompt خواندن تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: DEFAULT_OCR_PROMPT,
    adminEditable: true
  },
  'ai.vision.design_analysis_prompt': {
    label: 'Design analysis prompt خواندن تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: DEFAULT_DESIGN_PROMPT,
    adminEditable: true
  },
  'ai.vision.product_prompt': {
    label: 'Product prompt خواندن تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: DEFAULT_PRODUCT_PROMPT,
    adminEditable: true
  },
  'ai.vision.allow_chat_key_fallback': {
    label: 'اجازه fallback خواندن تصویر به METIS_CHAT_API_KEY',
    type: 'boolean',
    category: 'ai',
    defaultValue: false,
    adminEditable: true
  },
  'ai.vision.store_metadata': {
    label: 'ذخیره metadata خواندن تصویر',
    type: 'boolean',
    category: 'ai',
    defaultValue: true,
    adminEditable: true
  },
  'ai.vision.base_url': {
    label: 'Base URL خواندن تصویر',
    type: 'string',
    category: 'ai',
    defaultValue: 'https://api.metisai.ir',
    adminEditable: true
  },
  'ai.vision.model_health.enabled': {
    label: 'فعال بودن health check مدل‌های Vision',
    type: 'boolean',
    category: 'ai',
    defaultValue: true,
    adminEditable: true
  },
  'ai.vision.model_health.failure_threshold': {
    label: 'آستانه fail سلامت مدل Vision',
    type: 'number',
    category: 'ai',
    defaultValue: 3,
    min: 1,
    max: 20,
    adminEditable: true
  },
  'ai.vision.model_health.cooldown_minutes': {
    label: 'Cooldown مدل failشده Vision (دقیقه)',
    type: 'number',
    category: 'ai',
    defaultValue: 60,
    min: 1,
    max: 1440,
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
  'ai.intent_router.enabled': {
    label: 'فعال بودن مسیریاب هوشمند',
    type: 'boolean',
    category: 'ai',
    defaultValue: true,
    adminEditable: true
  },
  'input_optimizer.enabled': { label: 'فعال بودن Input Optimizer', type: 'boolean', category: 'ai', defaultValue: true, adminEditable: true },
  'input_optimizer.model': { label: 'مدل Input Optimizer', type: 'string', category: 'ai', defaultValue: 'gemini-2.5-flash-lite-preview', adminEditable: true },
  'input_optimizer.temperature': { label: 'Temperature Input Optimizer', type: 'number', category: 'ai', defaultValue: 0, min: 0, max: 0.2, adminEditable: true },
  'input_optimizer.timeout_ms': { label: 'Timeout Input Optimizer (ms)', type: 'number', category: 'ai', defaultValue: 3500, min: 500, max: 30000, adminEditable: true },
  'input_optimizer.max_retries': { label: 'تعداد retry Input Optimizer', type: 'number', category: 'ai', defaultValue: 1, min: 0, max: 1, adminEditable: true },
  'input_optimizer.max_output_tokens': { label: 'Max tokens Input Optimizer', type: 'number', category: 'ai', defaultValue: 450, min: 100, max: 1000, adminEditable: true },
  'input_optimizer.version': { label: 'نسخه Input Optimizer', type: 'string', category: 'ai', defaultValue: '1', adminEditable: true },
  'input_optimizer.allow_chat_key_fallback': { label: 'Fallback کلید چت برای Input Optimizer', type: 'boolean', category: 'ai', defaultValue: true, adminEditable: true },
  'ai.intent_router.provider': {
    label: 'Provider مسیریاب هوشمند',
    type: 'string',
    category: 'ai',
    defaultValue: 'metis',
    allowedValues: ['metis'],
    adminEditable: true
  },
  'ai.intent_router.model': {
    label: 'مدل اصلی مسیریاب هوشمند',
    type: 'string',
    category: 'ai',
    defaultValue: 'gemini-2.5-flash-lite-preview',
    allowedValues: ['gemini-2.5-flash-lite-preview', 'gemini-2.5-flash'],
    adminEditable: true
  },
  'ai.intent_router.fallback_model': {
    label: 'مدل fallback مسیریاب هوشمند',
    type: 'string',
    category: 'ai',
    defaultValue: 'gemini-2.5-flash',
    allowedValues: ['gemini-2.5-flash-lite-preview', 'gemini-2.5-flash'],
    adminEditable: true
  },
  'ai.intent_router.experimental_model': {
    label: 'مدل experimental مسیریاب هوشمند',
    type: 'string',
    category: 'ai',
    defaultValue: 'gemini-2.5-flash-lite-preview',
    allowedValues: ['gemini-2.5-flash-lite-preview', 'gemini-2.5-flash'],
    adminEditable: true
  },
  'ai.intent_router.temperature': {
    label: 'Temperature مسیریاب هوشمند',
    type: 'number',
    category: 'ai',
    defaultValue: 0,
    min: 0,
    max: 1,
    adminEditable: true
  },
  'ai.intent_router.max_output_tokens': {
    label: 'Max output tokens مسیریاب هوشمند',
    type: 'number',
    category: 'ai',
    defaultValue: 120,
    min: 50,
    max: 500,
    adminEditable: true
  },
  'ai.intent_router.timeout_ms': {
    label: 'Timeout مسیریاب هوشمند (ms)',
    type: 'number',
    category: 'ai',
    defaultValue: 2500,
    min: 500,
    max: 30000,
    adminEditable: true
  },
  'ai.intent_router.confidence_threshold': {
    label: 'Confidence threshold مسیریاب هوشمند',
    type: 'number',
    category: 'ai',
    defaultValue: 0.65,
    min: 0,
    max: 1,
    adminEditable: true
  },
  'ai.intent_router.fallback_to_heuristic': {
    label: 'Fallback به heuristic قدیمی',
    type: 'boolean',
    category: 'ai',
    defaultValue: true,
    adminEditable: true
  },
  'ai.intent_router.allow_model_fallback': {
    label: 'اجازه fallback مدل مسیریاب',
    type: 'boolean',
    category: 'ai',
    defaultValue: true,
    adminEditable: true
  },
  'ai.intent_router.allow_chat_key_fallback': {
    label: 'اجازه fallback به کلید چت',
    type: 'boolean',
    category: 'ai',
    defaultValue: false,
    adminEditable: true
  },
  'ai.intent_router.store_metadata': {
    label: 'ذخیره metadata مسیریاب',
    type: 'boolean',
    category: 'ai',
    defaultValue: true,
    adminEditable: true
  },
  'ai.intent_router.system_prompt': {
    label: 'System prompt مسیریاب هوشمند',
    type: 'string',
    category: 'ai',
    defaultValue: INTENT_ROUTER_SYSTEM_PROMPT,
    adminEditable: true
  },
  'ai.intent_router.model_health.enabled': {
    label: 'فعال بودن health مدل مسیریاب',
    type: 'boolean',
    category: 'ai',
    defaultValue: true,
    adminEditable: true
  },
  'ai.intent_router.model_health.failure_threshold': {
    label: 'آستانه fail مدل مسیریاب',
    type: 'number',
    category: 'ai',
    defaultValue: 3,
    min: 1,
    max: 20,
    adminEditable: true
  },
  'ai.intent_router.model_health.cooldown_minutes': {
    label: 'Cooldown مدل مسیریاب (دقیقه)',
    type: 'number',
    category: 'ai',
    defaultValue: 60,
    min: 1,
    max: 1440,
    adminEditable: true
  },
  'ai.conversation_memory.enabled': {
    label: 'فعال بودن حافظه مکالمه',
    type: 'boolean',
    category: 'ai',
    defaultValue: true,
    adminEditable: true
  },
  'ai.conversation_memory.provider': {
    label: 'Provider حافظه مکالمه',
    type: 'string',
    category: 'ai',
    defaultValue: 'metis',
    allowedValues: ['metis'],
    adminEditable: true
  },
  'ai.conversation_memory.model': {
    label: 'مدل اصلی حافظه مکالمه',
    type: 'string',
    category: 'ai',
    defaultValue: 'gemini-2.5-flash-lite-preview',
    allowedValues: ['gemini-2.5-flash-lite-preview', 'gemini-2.5-flash'],
    adminEditable: true
  },
  'ai.conversation_memory.fallback_model': {
    label: 'مدل fallback حافظه مکالمه',
    type: 'string',
    category: 'ai',
    defaultValue: 'gemini-2.5-flash',
    allowedValues: ['gemini-2.5-flash-lite-preview', 'gemini-2.5-flash'],
    adminEditable: true
  },
  'ai.conversation_memory.temperature': {
    label: 'Temperature حافظه مکالمه',
    type: 'number',
    category: 'ai',
    defaultValue: 0,
    min: 0,
    max: 1,
    adminEditable: true
  },
  'ai.conversation_memory.max_output_tokens': {
    label: 'Max output tokens حافظه مکالمه',
    type: 'number',
    category: 'ai',
    defaultValue: 3000,
    min: 500,
    max: 8192,
    adminEditable: true
  },
  'ai.conversation_memory.timeout_ms': {
    label: 'Timeout حافظه مکالمه (ms)',
    type: 'number',
    category: 'ai',
    defaultValue: 8000,
    min: 1000,
    max: 60000,
    adminEditable: true
  },
  'ai.conversation_memory.allow_model_fallback': {
    label: 'اجازه fallback مدل حافظه',
    type: 'boolean',
    category: 'ai',
    defaultValue: true,
    adminEditable: true
  },
  'ai.conversation_memory.allow_chat_key_fallback': {
    label: 'اجازه fallback حافظه به کلید چت',
    type: 'boolean',
    category: 'ai',
    defaultValue: false,
    adminEditable: true
  },
  'ai.conversation_memory.max_document_chars': {
    label: 'حداکثر کاراکتر Document حافظه',
    type: 'number',
    category: 'ai',
    defaultValue: 20000,
    min: 2000,
    max: 100000,
    adminEditable: true
  },
  'ai.conversation_memory.store_metadata': {
    label: 'ذخیره metadata حافظه مکالمه',
    type: 'boolean',
    category: 'ai',
    defaultValue: true,
    adminEditable: true
  },
  'ai.conversation_memory.system_prompt': {
    label: 'System prompt حافظه مکالمه',
    type: 'string',
    category: 'ai',
    defaultValue: MEMORY_WRITER_SYSTEM_PROMPT,
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
    if (definition.nullable && (value === null || value === undefined || value === '')) {
      return null;
    }
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

  if (definition.type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
      if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    }
    return Boolean(value);
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

  if (definition.nullable && (value === null || value === undefined || value === '')) {
    return null;
  }

  const text = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  if (!text) {
    throw new Error(`${key} cannot be empty`);
  }
  if (Array.isArray(definition.allowedValues) && !definition.allowedValues.includes(text)) {
    throw new Error(`${key} contains an unsupported value: ${text}`);
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
