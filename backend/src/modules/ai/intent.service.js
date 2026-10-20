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

// Explicit edit verbs. Attribute words (colour, background, hair...) are NOT listed
// here: on their own they are ordinary vocabulary ("رنگ قرمز یعنی چی؟"), so they
// only count through IMAGE_EDIT_PATTERNS below, which also require an edit verb.
const IMAGE_EDIT_KEYWORDS = [
  'ادیت',
  'ویرایش',
  'تغییر بده',
  'عوض کن',
  'قرمز کن',
  'آبی کن',
  'همین تصویر',
  'این عکس رو کارتونی',
  'این تصویر رو کارتونی',
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

// Generic verbs that only mean "look at the picture" when a picture is attached
// to this very message ("این سؤال رو توضیح بده" must stay a normal chat question).
const GENERIC_ANALYSIS_KEYWORDS = ['توضیح بده', 'تحلیل کن', 'بررسی کن'];

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

// JS \b does not understand Persian, so word edges are the Arabic-script block.
// ZWNJ (U+200C) is outside it on purpose: "خانه‌ی" still matches "خانه".
const PERSIAN_LETTER = String.raw`؀-ۿ`;
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordPattern = (source) => `(?<![${PERSIAN_LETTER}A-Za-z])(?:${source})(?![${PERSIAN_LETTER}A-Za-z])`;
const wordRegExp = (source) => new RegExp(wordPattern(source), 'i');
const keywordRegExp = (keywords) =>
  wordRegExp([...keywords].sort((a, b) => b.length - a.length).map((keyword) => escapeRegExp(keyword.toLowerCase())).join('|'));

const includesAny = (text, keywords) => keywordRegExp(keywords).test(text);

const IMAGE_NOUN_REGEXP = wordRegExp('(?:عکس|تصویر|نقاشی|طرح|لوگو|پوستر|بنر|والپیپر|آواتار)(?:ی|ش|شو|ها|های)?|image|photo|picture|poster');
// Work on text, not pictures: "متن رو ویرایش کن", "یه داستان درباره فضا بساز".
const TEXT_WORK_REGEXP = wordRegExp('(?:متن|نوشته|مقاله|انشا|جمله|داستان|قصه|شعر|معما|جوک|نامه|ایمیل|خلاصه|سناریو|فیلمنامه|کپشن|کد|برنامه|تکلیف|مسئله|سوال|سؤال)(?:ی|ش|شو|ها|های|م)?');
// Knowledge questions ("چرا آسمان آبیه؟") are chat unless a picture is mentioned.
const QUESTION_START_REGEXP = new RegExp(`^(?:چرا|چطور|چطوری|چگونه|چی|چه|کی|کجا|آیا|چند|کدوم|کدام|یعنی)(?![${PERSIAN_LETTER}])`);

const EDIT_ATTRIBUTE = String.raw`رنگ|پس\s*زمینه|پس‌زمینه|بک\s*گراند|بک‌گراند|زمینه|نور|لباس|مو|موها|چشم|چشم‌ها|صورت|چهره`;
const EDIT_COLOR = 'قرمز|آبی|سبز|زرد|مشکی|سفید|نارنجی|بنفش|صورتی|طلایی|نقره‌ای';
const EDIT_VERB = String.raw`(?:کن|بکن|کنی|کنید|عوض\s*کن|عوض|تغییر\s*بده|تغییر|بهتر\s*کن)`;
const GAP = String.raw`(?:\s+[^\s؟?.!،]+)`;
const AFTER_VERB = `(?![${PERSIAN_LETTER}])`;
// Each pattern needs an edit verb close to the thing being edited. A bare "بده"
// is deliberately not an edit verb ("توضیح بده", "نشون بده").
const IMAGE_EDIT_PATTERNS = [
  new RegExp(`${wordPattern(`(?:${EDIT_ATTRIBUTE})(?:ش|شو|اش|هاش|هایش)?`)}(?:\\s+(?:رو|را))?${GAP}{0,3}?\\s+${EDIT_VERB}${AFTER_VERB}`, 'i'),
  new RegExp(`${wordPattern(`(?:${EDIT_COLOR})(?:ش|شو)?`)}(?:\\s+(?:رو|را))?${GAP}{0,1}\\s+(?:کن|بکن|کنی|کنید)${AFTER_VERB}`, 'i'),
  new RegExp(`${wordPattern(String.raw`(?:واقعی(?:‌|\s)?تر|کارتونی|انیمیشنی)`)}(?:\\s+(?:رو|را))?\\s*(?:کن|بکن|بده|بساز)${AFTER_VERB}`, 'i')
];
const SAME_IMAGE_EDIT_PATTERN = new RegExp(`${wordPattern(String.raw`همین(?:و|\s*رو|\s*را)`)}${GAP}{0,3}\\s+(?:کن|عوض\\s*کن|تغییر\\s*بده)${AFTER_VERB}`, 'i');

// Generic verbs ("اضافه کن", "حذف کن", "بذار") are only edits when the picture is
// unmistakable: attached to this message or named in it. "یه مثال اضافه کن" after an
// earlier image is still plain chat.
const STRONG_CONTEXT_EDIT_VERBS = [
  'بذار', 'بزار', 'قرار بده', 'اضافه کن', 'حذف کن', 'پاک کن', 'جایگزین کن',
  'ترمیم کن', 'بهبود بده', 'واضح کن', 'بلندتر کن', 'کوتاه‌تر کن', 'کوتاهتر کن'
];
const IMAGE_CREATE_REGEXP = wordRegExp(String.raw`(?:بساز|بکش|بزن|طراحی\s*کن|تولید\s*کن|درست\s*کن|خلق\s*کن)(?:ی|ید)?|make|generate|create|draw|render|paint`);

const hasImageNoun = (text) => IMAGE_NOUN_REGEXP.test(text);
const looksLikeImageCreateRequest = (message) => {
  const text = normalize(message);
  return Boolean(text) && hasImageNoun(text) && IMAGE_CREATE_REGEXP.test(text);
};
const isTextWorkRequest = (text) => {
  const normalized = normalize(text);
  return TEXT_WORK_REGEXP.test(normalized) && !hasImageNoun(normalized);
};

/**
 * Is this message asking to modify a picture? A picture must be in play (attached,
 * recently generated/uploaded, or named in the message); without one, words like
 * "آبی" or "مو" are just vocabulary.
 */
const looksLikeImageEditRequest = (message, { hasImageContext = false, hasAttachedImage = false } = {}) => {
  const text = normalize(message);
  const lower = text.toLowerCase();
  if (!text) return false;
  const namesImage = hasImageNoun(text);
  if (!hasImageContext && !namesImage) return false;
  if (!namesImage && (isTextWorkRequest(text) || QUESTION_START_REGEXP.test(text))) return false;
  if ((namesImage || hasAttachedImage) && includesAny(lower, STRONG_CONTEXT_EDIT_VERBS)) return true;
  return (
    includesAny(lower, IMAGE_EDIT_KEYWORDS) ||
    IMAGE_EDIT_PATTERNS.some((pattern) => pattern.test(text)) ||
    (hasImageContext && SAME_IMAGE_EDIT_PATTERN.test(text))
  );
};

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

  // Editing needs a picture in play (attached, recent, or named in the message);
  // see looksLikeImageEditRequest for why bare colour/attribute words don't count.
  const wantsEdit = looksLikeImageEditRequest(text, { hasImageContext, hasAttachedImage: hasAttachedImages });
  if (wantsEdit) {
    return {
      intent: 'image_edit',
      confidence: hasImageContext ? 'high' : 'medium',
      source: hasImageContext ? 'edit_keyword' : 'edit_without_image_context'
    };
  }

  // A picture attached to this message makes "توضیح بده" an image question. A
  // picture merely seen earlier in the conversation does not: the user must point
  // at it ("این عکس ...") or the sentence stays an ordinary chat question.
  const wantsUnderstanding =
    hasImageContext &&
    ((hasAttachedImages && includesAny(lower, GENERIC_ANALYSIS_KEYWORDS)) ||
      includesAny(lower, IMAGE_UNDERSTANDING_KEYWORDS) ||
      new RegExp(`${wordPattern('عکس|تصویر|طرح|بنر|پوستر|استوری')}(?:\s+[^\s؟?.!،]+){0,4}?\s+(?:چیه|چیست|بخون|بخوان|توضیح|تحلیل|بررسی|می‌بینی|میبینی|متن|ایراد|خوبه)`, 'i').test(text) ||
      (hasAttachedImages &&
        new RegExp(`${wordPattern('این|اینو|این\s*رو')}(?:\s+[^\s؟?.!،]+){0,1}\s+(?:چیه|بخون|بخوان|توضیح|تحلیل|بررسی)`, 'i').test(text)));
  if (wantsUnderstanding) {
    return { intent: 'image_understanding', confidence: 'high', source: hasAttachedImages ? 'attached_image_understanding' : 'recent_image_understanding' };
  }

  if (!hasImageContext && EXPLANATION_PATTERNS.some((pattern) => pattern.test(text))) {
    return { intent: 'chat', confidence: 'high', source: 'negative_keyword' };
  }

  const hasImageWord = hasImageNoun(text);
  const hasCreationWord = wordRegExp(String.raw`بساز|بکش|طراحی\s*کن|نقاشی\s*کن|درست\s*کن|خلق\s*کن|generate|create|draw|paint|imagine`).test(text);
  // "یه داستان درباره فضا بساز" asks for writing, not a picture of space.
  const isTextWork = isTextWorkRequest(text);
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
    !isTextWork &&
    (
      hasVisualSubject ||
      wordRegExp('کاراکتر|شخصیت|لوگو|پوستر|آواتار|گربه|سگ|خرگوش|پرنده|اسب|ماهی|ربات|ماشین|قلعه|خانه|شهر|فضا|فضایی|سیاره|ستاره|کهکشان|سفینه|میوه|منظره|wallpaper|poster|avatar|logo|character|cat|dog|rabbit|bird|horse|fish|robot|car|castle|house|city|space|alien|planet|star|galaxy|spaceship|fruit|landscape').test(text)
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
  isUnsafeImagePrompt,
  looksLikeImageCreateRequest,
  looksLikeImageEditRequest
};
