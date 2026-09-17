'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildScenarioMarkdown, normalizeScenario, validateScenario } = require('./story-maker.scenario');

const completeScenario = {
  title: 'خرگوش و هویج گمشده', audience: 'کودکان ۸ تا ۱۲ سال', duration: '۳۰ ثانیه', openingHook: 'سبد هویج پوفی ناگهان از روی سنگ می‌افتد و ردّی درخشان می‌سازد.', logline: 'خرگوشی گرسنه راه درست پیدا کردن هویج را یاد می‌گیرد.', message: 'کمک خواستن از دیگران کار خوبی است.', visualStyle: 'انیمیشن رنگی و گرم', world: 'مزرعه‌ای کنار جنگل',
  characters: [{ name: 'پوفی', description: 'خرگوشی سفید و کنجکاو', personality: 'مهربان، شجاع و کمی عجول', specialAbility: 'ردّهای کوچک روی زمین را سریع پیدا می‌کند', relationship: 'قهرمان داستان است', visualSignature: 'سبدِ زردِ کوچک و گوش‌های بلند', goal: 'پیدا کردن هویج', voiceStyle: 'شاد و تند' }],
  storyBeats: { setup: 'پوفی گرسنه است.', goal: 'دنبال هویج می‌گردد.', obstacle: 'راه انبار را بلد نیست.', climax: 'با کشاورز روبه‌رو می‌شود.', resolution: 'با راهنمایی او هویج پیدا می‌کند.' },
  scenes: [1, 2, 3].map((number) => ({ title: `بخش ${number}`, duration: '۱۰ ثانیه', presentCharacters: 'پوفی', emotion: 'کنجکاوی و امید', goal: 'پیش بردن ماجرا', setting: 'مزرعه', visual: 'نور گرم و گیاهان رنگی', camera: 'نمای متوسط', action: 'پوفی دنبال هویج می‌گردد.', dialogue: 'پوفی: کجا هویج را پیدا کنم؟', narration: '', reaction: 'پوفی با نگرانی گوش‌هایش را تکان می‌دهد.', sound: 'صدای پرنده‌ها', continuity: 'پوفی همان سبد کوچک را دارد.', outcome: 'پوفی ردِ هویج‌ها را پیدا می‌کند.', transition: 'برش به مسیر بعدی', imagePrompt: 'انیمیشن کودکانه، خرگوش سفید در مزرعه‌ی رنگی' })),
  ending: 'پوفی با کشاورز دوست می‌شود.'
};

const productionScenario = {
  ...completeScenario,
  schemaVersion: 2,
  visualBible: {
    style: 'انیمیشن سه‌بعدیِ استایل‌دار و گرم', animationStyle: 'حرکت نرم و پرانرژیِ خانوادگی',
    characterDesignLanguage: 'فرم‌های گرد، چشم‌های درشت و بافت‌های غیرواقع‌گرا', environmentDesignLanguage: 'مزرعه‌ای رنگی با شکل‌های نرم و جزئیات خوانا',
    colorLightingMood: 'زرد و سبزِ گرم با نور آفتابِ ملایم', consistencyRules: 'همه‌ی شخصیت‌ها و محیط‌ها همین سبک، رنگ‌پردازی و کیفیت ساخت را حفظ می‌کنند.'
  },
  characters: [{ ...completeScenario.characters[0], id: 'C01', role: 'قهرمان', apparentAge: 'کودک', speciesType: 'خرگوش', bodyProportions: 'بدن کوچک و گرد با گوش‌های بلند', face: 'صورت گرد و پوزه‌ی کوچک', eyes: 'چشم‌های قهوه‌ای درشت', hairOrFur: 'خز سفید و نرم', clothing: 'جلیقه‌ی آبی و کفش‌های قهوه‌ای', accessories: 'سبد زردِ کوچک', colors: 'سفید، آبی و زرد', uniqueVisualTraits: 'گوش‌های بلند و سبد زرد', expressions: 'کنجکاو، نگران و شاد', bodyLanguage: 'گوش‌ها با احساس او تکان می‌خورند', goalsFears: 'می‌خواهد هویج را پیدا کند و از گم‌کردن آن می‌ترسد', consistencyRules: 'خز سفید، جلیقه‌ی آبی و سبد زرد فقط با دلیل داستانی تغییر می‌کنند.' }],
  locations: [{ id: 'L01', name: 'مزرعه‌ی کنار جنگل', description: 'مزرعه‌ای کوچک با انبار چوبی و ردیف‌های هویج', environmentDetails: 'گیاهان رنگی، مسیر خاکی و انبار در پس‌زمینه', timeWeather: 'صبحِ آفتابی و آرام', lighting: 'نور گرمِ آفتاب از سمت راست', continuityRules: 'هوا، نور صبح و جای انبار تا پایان ثابت می‌مانند.' }],
  props: [{ id: 'P01', name: 'سبد زردِ پوفی', description: 'سبد کوچک حصیری با دسته‌ی کوتاه', ownerOrLocation: 'در دستِ پوفی', initialState: 'خالی و تمیز', consistencyRules: 'همراه پوفی است مگر در صحنه‌ای که محل آن صریحاً ثبت شود.' }],
  scenes: [1, 2, 3].map((number) => ({ ...completeScenario.scenes[number - 1], id: `SC0${number}`, characterIds: ['C01'], locationId: 'L01', visualIntent: 'احساس و انتخاب پوفی در مسیر پیدا کردن هویج روشن باشد.', startState: 'پوفی جلیقه‌ی آبی و سبد خالی را دارد و نگران است.', endState: 'پوفی با سبد زرد و سرنخ تازه به بخش بعد می‌رود.', propStates: 'P01: در دستِ پوفی و هنوز خالی است.' }))
};

test('complete structured scenario passes the quality gate and renders production details', () => {
  const scenario = normalizeScenario(completeScenario, 3);
  assert.deepEqual(validateScenario(scenario, 3), { valid: true, errors: [] });
  const markdown = buildScenarioMarkdown(scenario);
  assert.match(markdown, /## درباره‌ی این داستان/);
  assert.match(markdown, /\*\*خلاصه‌ی کوتاه:\*\*/);
  assert.match(markdown, /\*\*اتفاق جذابِ شروع:\*\*/);
  assert.match(markdown, /\*\*تواناییِ ویژه:\*\*/);
  assert.match(markdown, /\*\*زمان این بخش:\*\*/);
  assert.match(markdown, /\*\*نگاه دوربین:\*\*/);
  assert.match(markdown, /\*\*واکنش شخصیت‌ها:\*\*/);
  assert.match(markdown, /\*\*نتیجه‌ی این بخش:\*\*/);
  assert.match(markdown, /\*\*متنِ ساخت تصویر یا ویدیو:\*\*/);
});

test('quality gate rejects scenes that omit production-critical details', () => {
  const scenario = normalizeScenario({ ...completeScenario, scenes: [{ title: 'ناقص' }] }, 3);
  const result = validateScenario(scenario, 3);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.startsWith('scene_count_')));
  assert.ok(result.errors.includes('scene_1_missing_camera'));
  assert.ok(result.errors.includes('scene_1_missing_duration'));
  assert.ok(result.errors.includes('scene_1_missing_presentCharacters'));
  assert.ok(result.errors.includes('scene_1_missing_emotion'));
  assert.ok(result.errors.includes('scene_1_missing_reaction'));
  assert.ok(result.errors.includes('scene_1_missing_outcome'));
});

test('quality gate rejects a scenario without its audience or opening attraction', () => {
  const scenario = normalizeScenario({ ...completeScenario, audience: '', openingHook: '' }, 3);
  const result = validateScenario(scenario, 3);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('missing_audience'));
  assert.ok(result.errors.includes('missing_openingHook'));
});

test('production schema carries a shared visual bible, stable IDs, and scene state handoffs', () => {
  const scenario = normalizeScenario(productionScenario, 3);
  assert.deepEqual(validateScenario(scenario, 3), { valid: true, errors: [] });
  const markdown = buildScenarioMarkdown(scenario);
  assert.match(markdown, /## راهنمای یکپارچه‌ی ساخت/);
  assert.match(markdown, /C01: پوفی/);
  assert.match(markdown, /L01: مزرعه‌ی کنار جنگل/);
  assert.match(markdown, /SC01/);
  assert.match(markdown, /وضعیت در آغاز/);
});

test('production schema rejects broken scene references and missing state data', () => {
  const scenario = normalizeScenario({ ...productionScenario, scenes: [{ ...productionScenario.scenes[0], locationId: 'L99', characterIds: ['C99'], startState: '' }, ...productionScenario.scenes.slice(1)] }, 3);
  const result = validateScenario(scenario, 3);
  assert.ok(result.errors.includes('scene_1_invalid_locationId'));
  assert.ok(result.errors.includes('scene_1_invalid_characterId_C99'));
  assert.ok(result.errors.includes('scene_1_missing_startState'));
});
