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
  'پس زمینه',
  'پس‌زمینه',
  'موهاش',
  'همینو',
  'همین رو',
  'واقعی تر',
  'واقعی‌تر',
  'کارتونی',
  'edit image'
];

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

async function detectChatIntent({ message, hasAttachedImages = false, hasRecentImage = false, classify }) {
  const text = normalize(message);
  const lower = text.toLowerCase();

  if (!text) {
    return { intent: hasAttachedImages ? 'chat' : 'chat', confidence: 'high', source: 'empty' };
  }

  if (/^\/imagine\s+.+/i.test(text)) {
    return { intent: 'image_generation', confidence: 'high', source: 'command' };
  }

  if (EXPLANATION_PATTERNS.some((pattern) => pattern.test(text))) {
    return { intent: 'chat', confidence: 'high', source: 'negative_keyword' };
  }

  const wantsEdit = includesAny(lower, IMAGE_EDIT_KEYWORDS);
  if (wantsEdit && (hasAttachedImages || hasRecentImage)) {
    return { intent: 'image_edit', confidence: 'high', source: 'edit_keyword' };
  }

  const hasImageWord = /عکس|تصویر|image|photo|picture/i.test(text);
  const hasCreationWord = /بساز|بکش|طراحی کن|نقاشی کن|درست کن|خلق کن|generate|create|draw|paint|imagine/i.test(text);
  if (hasImageWord && hasCreationWord) {
    return { intent: 'image_generation', confidence: 'high', source: 'generation_keyword' };
  }

  if (hasCreationWord && /کاراکتر|شخصیت|لوگو|پوستر|آواتار|wallpaper|poster|avatar|logo|character/i.test(text)) {
    return { intent: 'image_generation', confidence: 'medium', source: 'creative_keyword' };
  }

  const ambiguous =
    hasImageWord ||
    hasCreationWord ||
    wantsEdit ||
    includesAny(lower, IMAGE_GENERATION_KEYWORDS) ||
    includesAny(lower, IMAGE_EDIT_KEYWORDS);

  if (!ambiguous || typeof classify !== 'function') {
    return { intent: 'chat', confidence: ambiguous ? 'low' : 'high', source: ambiguous ? 'fallback' : 'none' };
  }

  try {
    const classified = await classify(text);
    if (classified === 'image_generation' || classified === 'image_edit' || classified === 'chat') {
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
