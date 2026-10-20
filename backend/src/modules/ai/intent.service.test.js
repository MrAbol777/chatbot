const test = require('node:test');
const assert = require('node:assert/strict');

const { detectChatIntent, looksLikeImageEditRequest } = require('./intent.service');
const { isImageStudioRequest } = require('./ai.controller');

const intentOf = async (message, context = {}) => (await detectChatIntent({ message, classify: null, ...context })).intent;

// Ordinary questions and writing requests that used to be mistaken for image
// work because a colour/attribute word and "بده" or "بساز" appeared somewhere.
const CHAT_MESSAGES = [
  'چرا آسمان آبیه؟ توضیح بده',
  'درباره موضوع فضا توضیح بده',
  'موز چه خاصیتی داره؟ توضیح بده',
  'فرق صورتحساب و فاکتور رو توضیح بده',
  'رنگ قرمز یعنی چی؟ بهم نشون بده',
  'نور خورشید چطوری به زمین میرسه؟ بگو',
  'پس‌زمینه تاریخی جنگ جهانی اول رو توضیح بده',
  'مو چه کار می‌کنه؟ توضیح بده',
  'یه داستان درباره فضا بساز',
  'یه شعر درباره شهر بساز',
  'یه داستان کوتاه و هیجان‌انگیز برام بساز',
  'این متن رو ویرایش کن',
  'برای پروژه‌ی مدرسه‌م چند تا ایده‌ی باحال بده'
];

for (const message of CHAT_MESSAGES) {
  test(`stays chat without any picture: ${message}`, async () => {
    assert.equal(await intentOf(message), 'chat');
  });

  test(`stays chat even when an earlier picture exists: ${message}`, async () => {
    assert.equal(await intentOf(message, { hasRecentImage: true }), 'chat');
    assert.equal(isImageStudioRequest(message, { hasPreviousGeneratedImage: true }), false);
  });
}

test('real image edits are still recognised when a picture is in play', async () => {
  const edits = [
    'پس زمینه رو آبی کن',
    'موهاش رو بلندتر کن',
    'رنگ لباسش رو قرمز کن',
    'نورش رو بهتر کن',
    'همینو کارتونی کن',
    'این رو کارتونی کن'
  ];
  for (const message of edits) {
    assert.equal(await intentOf(message, { hasRecentImage: true }), 'image_edit', message);
  }
});

test('an edit that names the picture is an edit even with no earlier picture', async () => {
  assert.equal(await intentOf('پس زمینه این عکس رو عوض کن'), 'image_edit');
});

test('generic add/remove verbs need an attached or named picture', () => {
  assert.equal(looksLikeImageEditRequest('من رو کنار یک فضانورد بزار', { hasImageContext: true, hasAttachedImage: true }), true);
  assert.equal(looksLikeImageEditRequest('یه مثال دیگه اضافه کن', { hasImageContext: true }), false);
  assert.equal(looksLikeImageEditRequest('این عکس رو واضح کن', { hasImageContext: true }), true);
});

test('generic analysis verbs are image questions only for a picture attached to this message', async () => {
  assert.equal(await intentOf('توضیح بده', { hasAttachedImages: true }), 'image_understanding');
  assert.equal(await intentOf('این مسئله رو توضیح بده', { hasRecentImage: true }), 'chat');
  assert.equal(await intentOf('این عکس چیه؟', { hasRecentImage: true }), 'image_understanding');
});

test('real image generation requests still route to the studio', async () => {
  for (const message of ['یه تصویر از یک قلعه بساز', 'یه گربه فضایی بکش', '/imagine a city at night']) {
    assert.equal(await intentOf(message), 'image_generation', message);
  }
  for (const message of ['یه تصویر از یک قلعه بساز', 'برام یه عکس از گربه بزن', '/imagine a city at night']) {
    assert.equal(isImageStudioRequest(message), true, message);
  }
});

test('boundary matching does not fire inside longer Persian words', () => {
  assert.equal(looksLikeImageEditRequest('موضوع این عکس رو عوض کن', { hasImageContext: true }), true); // "این عکس" + عوض کن
  assert.equal(looksLikeImageEditRequest('موضوع رو توضیح بده', { hasImageContext: true }), false);
  assert.equal(looksLikeImageEditRequest('آبیاری گیاه چطوریه؟', { hasImageContext: true }), false);
});
