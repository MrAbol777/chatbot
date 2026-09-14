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
