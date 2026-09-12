'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildScenarioMarkdown, normalizeScenario, validateScenario } = require('./story-maker.scenario');

const completeScenario = {
  title: 'خرگوش و هویج گمشده', logline: 'خرگوشی گرسنه راه درست پیدا کردن هویج را یاد می‌گیرد.', message: 'کمک خواستن از دیگران کار خوبی است.', visualStyle: 'انیمیشن رنگی و گرم', world: 'مزرعه‌ای کنار جنگل',
  characters: [{ name: 'پوفی', description: 'خرگوشی سفید و کنجکاو', goal: 'پیدا کردن هویج', voiceStyle: 'شاد و تند' }],
  storyBeats: { setup: 'پوفی گرسنه است.', goal: 'دنبال هویج می‌گردد.', obstacle: 'راه انبار را بلد نیست.', climax: 'با کشاورز روبه‌رو می‌شود.', resolution: 'با راهنمایی او هویج پیدا می‌کند.' },
  scenes: [1, 2, 3].map((number) => ({ title: `صحنه ${number}`, goal: 'پیش بردن ماجرا', setting: 'مزرعه', visual: 'نور گرم و گیاهان رنگی', camera: 'نمای متوسط', action: 'پوفی دنبال هویج می‌گردد.', dialogue: 'پوفی: کجا هویج را پیدا کنم؟', narration: '', sound: 'صدای پرنده‌ها', continuity: 'پوفی همان سبد کوچک را دارد.', transition: 'برش به مسیر بعدی', imagePrompt: 'انیمیشن کودکانه، خرگوش سفید در مزرعه‌ی رنگی' })),
  ending: 'پوفی با کشاورز دوست می‌شود.'
};

test('complete structured scenario passes the quality gate and renders production details', () => {
  const scenario = normalizeScenario(completeScenario, 3);
  assert.deepEqual(validateScenario(scenario, 3), { valid: true, errors: [] });
  const markdown = buildScenarioMarkdown(scenario);
  assert.match(markdown, /## شناسنامه‌ی داستان/);
  assert.match(markdown, /\*\*دوربین:\*\*/);
  assert.match(markdown, /\*\*پرامپت تصویر\/ویدیو:\*\*/);
});

test('quality gate rejects scenes that omit production-critical details', () => {
  const scenario = normalizeScenario({ ...completeScenario, scenes: [{ title: 'ناقص' }] }, 3);
  const result = validateScenario(scenario, 3);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.startsWith('scene_count_')));
  assert.ok(result.errors.includes('scene_1_missing_camera'));
});
