const IMAGE_GENERATION_KEYWORDS = [
  'عکس',
  'تصویر',
  'نقاشی',
  'طراحی',
  'بساز',
  'بکش',
  'درست کن',
  'خلق کن',
  'کاراکتر بساز',
  'تصویرش کن',
  'generate image',
  'create image',
  'draw',
  'paint',
  'imagine'
];

const IMAGE_EDIT_KEYWORDS = [
  'ادیت',
  'ویرایش',
  'تغییر بده',
  'عوض کن',
  'رنگش',
  'رنگش رو',
  'رنگ لباس',
  'قرمز کن',
  'آبی کن',
  'پس زمینه',
  'پس‌زمینه',
  'بک گراند',
  'بک‌گراند',
  'زمینه رو',
  'نورش',
  'موهاش',
  'همینو',
  'همین رو',
  'همین تصویر',
  'این عکس رو کارتونی',
  'این تصویر رو کارتونی',
  'واقعی تر',
  'واقعی‌تر',
  'کارتونی',
  'edit image'
];

const IMAGE_UNDERSTANDING_KEYWORDS = [
  'این عکس چیه',
  'این تصویر چیه',
  'توی این تصویر',
  'توی عکس',
  'چی می‌بینی',
  'چی میبینی',
  'متن این عکس',
  'متن این تصویر',
  'اینو بخون',
  'این رو بخون',
  'این عکس رو بخون',
  'این تصویر رو بخون',
  'توضیح بده',
  'تحلیل کن',
  'بررسی کن',
  'این طرح',
  'این عکس',
  'این تصویر',
  'what is in this image',
  'describe this image',
  'read this image',
  'analyze this image',
  'ocr'
];

const VISUAL_SUBJECT_KEYWORDS = [
  'آدم',
  'ادم',
  'انسان',
  'شخص',
  'شخصیت',
  'کاراکتر',
  'دختر',
  'پسر',
  'زن',
  'مرد',
  'بچه',
  'کودک',
  'چهره',
  'صورت',
  'قیافه',
  'ظاهر',
  'استایل',
  'لباس',
  'مو',
  'چشم',
  'پوستر',
  'بنر',
  'لوگو',
  'آواتار',
  'فضایی',
  'سیاره',
  'سیاره‌ها',
  'ستاره',
  'کهکشان',
  'سفینه',
  'فضا',
  'میوه',
  'منظره',
  'شهر',
  'خانه',
  'قلعه',
  'ربات',
  'ماشین'
];

const IMAGE_CONTINUATION_PATTERN =
  /(?:(?:یکی|یه|یک)\s+(?:دیگه|دیگر)\s+(?:هم\s+)?(?:بساز|بکش|درست\s*کن|خلق\s*کن)|(?:دوباره|بازم|باز\s+هم)\s+(?:بساز|بکش|درست\s*کن|خلق\s*کن)|(?:مثل|شبیه)\s+(?:قبلی|همونی|همون)\s+(?:بساز|بکش|درست\s*کن))/i;

const VISUAL_DESCRIPTOR_PATTERN =
  /(?:این\s*طور|اینطور|اینجوری|اینجور|شبیه|مثل|با\s+(?:ظاهر|قیافه|چهره|استایل|لباس|مو|چشم|رنگ|حالت|ژست)|(?:ظاهر|قیافه|چهره|استایل|لباس|مو|چشم|رنگ|حالت|ژست)\w*)/i;

const EXPLANATION_PATTERNS = [
  /(?:عکس|تصویر)\s+(?:یعنی|چیه|چیست|یعنی چی|چه معنی)/i,
  /(?:فرق|تفاوت)\s+(?:عکس|تصویر)/i,
  /(?:درباره|در مورد)\s+(?:عکس|تصویر)\s+(?:توضیح|بگو)/i,
  /what\s+is\s+(?:an?\s+)?image/i
];

const UNSAFE_PATTERNS = [
  /برهنه|پورن|جنسی|لخت/i,
  /خودکشی|خودزنی/i,
  /قتل|قاتل|کشتن|خونریزی\s+شدید|اسلحه\s+واقعی/i,
  /sexual|porn|nude|suicide|self-harm/i
];

const normalize = (value) =>
  String(value || '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\s+/g, ' ')
    .trim();

const includesAny = (text, keywords) => keywords.some((keyword) => text.includes(keyword.toLowerCase()));

const isUnsafeImagePrompt = (message) => {
  const text = normalize(message);
  return UNSAFE_PATTERNS.some((pattern) => pattern.test(text));
};

const getSafeAlternativeMessage = () =>
  'این نسخه را نمی‌سازم، اما می‌تونم یک نسخه امن و غیرآسیب‌زننده از ایده‌ات بسازم. مثلا یک کاراکتر مرموز و سینمایی بدون خشونت یا محتوای نامناسب.';

const normalizeClassifiedIntent = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'image_generation' || raw.includes('"intent":"image_generation"') || raw.includes('image_generation')) {
    return 'image_generation';
  }
  if (raw === 'image_edit' || raw.includes('"intent":"image_edit"') || raw.includes('image_edit')) {
    return 'image_edit';
  }
  if (
    raw === 'image_understanding' ||
    raw.includes('"intent":"image_understanding"') ||
    raw.includes('image_understanding')
  ) {
    return 'image_understanding';
  }
  if (raw === 'chat' || raw.includes('"intent":"chat"') || raw.includes('chat')) {
    return 'chat';
  }
  return '';
};

const classifyIntentSafely = async (text, classify) => {
  if (typeof classify !== 'function') return '';
  const classified = await classify(text);
  return normalizeClassifiedIntent(classified);
};

async function detectChatIntent({ message, hasAttachedImages = false, hasRecentImage = false, classify }) {
  const text = normalize(message);
  const lower = text.toLowerCase();
  const hasImageContext = hasAttachedImages || hasRecentImage;

  if (!text) {
    return { intent: hasAttachedImages ? 'image_understanding' : 'chat', confidence: 'high', source: hasAttachedImages ? 'empty_image_prompt' : 'empty' };
  }

  if (/^\/imagine\s+.+/i.test(text)) {
    return { intent: 'image_generation', confidence: 'high', source: 'command' };
  }

  const wantsEdit =
    includesAny(lower, IMAGE_EDIT_KEYWORDS) ||
    /(?:رنگ|پس\s*زمینه|پس‌زمینه|بک\s*گراند|بک‌گراند|زمینه|نور|لباس|مو|چشم|صورت).*(?:کن|بده|عوض|تغییر|بهتر)/i.test(text) ||
    /(?:قرمز|آبی|سبز|زرد|مشکی|سفید|واقعی(?:‌|\s)?تر|کارتونی).*(?:کن|بده)/i.test(text);
  if (wantsEdit) {
    return {
      intent: 'image_edit',
      confidence: hasImageContext ? 'high' : 'medium',
      source: hasImageContext ? 'edit_keyword' : 'edit_without_image_context'
    };
  }

  const wantsUnderstanding =
    hasImageContext &&
    (includesAny(lower, IMAGE_UNDERSTANDING_KEYWORDS) ||
      /(?:عکس|تصویر|طرح|بنر|پوستر|استوری).*(?:چیه|چیست|بخون|بخوان|توضیح|تحلیل|بررسی|می‌بینی|میبینی|متن|ایراد|خوبه)/i.test(text) ||
      /(?:این|اینو|این رو).*(?:چیه|بخون|بخوان|توضیح|تحلیل|بررسی)/i.test(text));
  if (wantsUnderstanding) {
    return { intent: 'image_understanding', confidence: 'high', source: hasAttachedImages ? 'attached_image_understanding' : 'recent_image_understanding' };
  }

  if (!hasImageContext && EXPLANATION_PATTERNS.some((pattern) => pattern.test(text))) {
    return { intent: 'chat', confidence: 'high', source: 'negative_keyword' };
  }

  const hasImageWord = /عکس|تصویر|image|photo|picture/i.test(text);
  const hasCreationWord = /بساز|بکش|طراحی کن|نقاشی کن|درست کن|خلق کن|generate|create|draw|paint|imagine/i.test(text);
  const hasVisualSubject = includesAny(lower, VISUAL_SUBJECT_KEYWORDS);
  const hasVisualDescriptor = VISUAL_DESCRIPTOR_PATTERN.test(text);
  const asksForVisualSubject =
    /(?:یه|یک|يک)\s+(?:آدم|ادم|انسان|شخص|شخصیت|کاراکتر|دختر|پسر|زن|مرد|بچه|کودک)\s+(?:می\s*خوام|میخوام|میخام|می\s*خواهم)/i.test(text) &&
    hasVisualDescriptor;
  if (hasImageWord && hasCreationWord) {
    return { intent: 'image_generation', confidence: 'high', source: 'generation_keyword' };
  }

  if (hasCreationWord && hasImageContext && IMAGE_CONTINUATION_PATTERN.test(text)) {
    return { intent: 'image_generation', confidence: 'high', source: 'image_generation_continuation' };
  }

  if (
    hasCreationWord &&
    (
      hasVisualSubject ||
      /کاراکتر|شخصیت|لوگو|پوستر|آواتار|گربه|سگ|خرگوش|پرنده|اسب|ماهی|ربات|ماشین|قلعه|خانه|شهر|فضا|فضایی|سیاره|ستاره|کهکشان|سفینه|میوه|منظره|wallpaper|poster|avatar|logo|character|cat|dog|rabbit|bird|horse|fish|robot|car|castle|house|city|space|alien|planet|star|galaxy|spaceship|fruit|landscape/i.test(text)
    )
  ) {
    return { intent: 'image_generation', confidence: 'medium', source: 'creative_keyword' };
  }

  if (asksForVisualSubject && typeof classify === 'function') {
    try {
      const classified = await classifyIntentSafely(text, classify);
      if (classified === 'image_generation' || classified === 'image_edit') {
        return { intent: classified, confidence: 'medium', source: 'visual_subject_classifier' };
      }
      if (classified === 'image_understanding' && hasImageContext) {
        return { intent: classified, confidence: 'medium', source: 'visual_subject_classifier' };
      }
    } catch (_error) {
      return { intent: 'chat', confidence: 'low', source: 'visual_subject_classifier_failed' };
    }
  }

  if (asksForVisualSubject) {
    return { intent: 'image_generation', confidence: 'medium', source: 'visual_subject_keyword' };
  }

  const ambiguous =
    hasImageWord ||
    hasCreationWord ||
    wantsEdit ||
    (hasVisualSubject && hasVisualDescriptor) ||
    includesAny(lower, IMAGE_GENERATION_KEYWORDS) ||
    includesAny(lower, IMAGE_EDIT_KEYWORDS);

  if (!ambiguous || typeof classify !== 'function') {
    return { intent: 'chat', confidence: ambiguous ? 'low' : 'high', source: ambiguous ? 'fallback' : 'none' };
  }

  try {
    const classified = await classifyIntentSafely(text, classify);
    if (classified === 'image_generation' || classified === 'image_edit' || classified === 'image_understanding' || classified === 'chat') {
      return { intent: classified, confidence: 'low', source: 'classifier' };
    }
  } catch (_error) {
    return { intent: 'chat', confidence: 'low', source: 'classifier_failed' };
  }

  return { intent: 'chat', confidence: 'low', source: 'classifier_invalid' };
}

module.exports = {
  detectChatIntent,
  getSafeAlternativeMessage,
  isUnsafeImagePrompt
};
