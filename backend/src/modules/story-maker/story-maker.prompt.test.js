'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildClarificationPrompt, buildFollowUpClarificationPrompt, buildScenarioPrompt, buildStoryPreviewPrompt, detectExplicitStoryDetails, normalizeStoryContext, normalizeStoryDraft } = require('./story-maker.prompt');

test('custom story details are normalized and included in the final scenario prompt', () => {
  const draft = normalizeStoryDraft({ idea: 'خرگوشی دنبال هویج جادویی است', mood: 'funny', place: 'custom', customPlace: 'مزرعه‌ی رنگی', length: 'custom', customSceneCount: '7', ending: 'custom', customEnding: 'دوستش را پیدا کند' });
  const prompt = buildScenarioPrompt(draft);
  assert.equal(draft.scenes, 7);
  assert.match(prompt, /مزرعه‌ی رنگی/);
  assert.match(prompt, /دوستش را پیدا کند/);
  assert.match(prompt, /دقیقاً 7 صحنه/);
});

test('story context is safely included in the final prompt after clarification', () => {
  const draft = normalizeStoryDraft({ idea: 'یک خرگوش دزد', mood: 'funny', place: 'forest', length: 'short', ending: 'happy' });
  const context = normalizeStoryContext({
    summary: 'خرگوش گرسنه برای پیدا کردن هویج وارد مزرعه می‌شود.',
    resolvedDetails: [{ label: 'هدف خرگوش', value: 'پیدا کردن هویج' }],
    assumptions: [{ label: 'رفتار کشاورز', value: 'مهربان و خنده‌دار' }],
    answers: { 'چه اتفاقی بیفتد؟': 'یک تله‌ی بامزه' }
  });
  const prompt = buildScenarioPrompt(draft, context);
  assert.match(prompt, /برداشت روشن‌شده از ایده/);
  assert.match(prompt, /پیدا کردن هویج/);
  assert.match(prompt, /یک تله‌ی بامزه/);
});

test('clarification prompt asks only for unresolved guided choices', () => {
  const draft = normalizeStoryDraft({ idea: 'یه خرگوش دزده', mood: 'funny', place: 'forest', length: 'short', ending: 'happy' });
  const prompt = buildClarificationPrompt(draft);
  assert.match(prompt, /فقط برای همین موارد سؤال بساز/);
  assert.match(prompt, /age/);
  assert.match(prompt, /format/);
  assert.match(prompt, /duration/);
  assert.match(prompt, /location/);
  assert.match(prompt, /mood/);
  assert.match(prompt, /۰ تا ۳ سال/);
  assert.match(prompt, /«انیمیشن» و «فیلم سینمایی»/);
  assert.match(prompt, /options آن حتماً آرایه‌ی خالی باشد/);
  assert.match(prompt, /۱۸ تا ۲۵ سال/);
  assert.match(prompt, /فقط JSON معتبر/);
  assert.match(prompt, /یه خرگوش دزده/);
});

test('explicit story details are detected conservatively and normalized', () => {
  const detected = detectExplicitStoryDetails('یک انیمیشن برای بچه‌های ۴ تا ۷ سال، در جنگل، با حال‌وهوای شاد و مدت ۱۲ ثانیه');
  assert.deepEqual(detected.details, {
    age: '۴ تا ۷ سال',
    format: 'انیمیشن',
    duration: '۱۲ ثانیه',
    location: 'جنگل',
    mood: 'شاد و بامزه'
  });
  assert.deepEqual(detected.missingIds, []);
});

test('known details are not asked again in the clarification prompt', () => {
  const draft = normalizeStoryDraft({ idea: 'یک انیمیشن برای بچه‌های ۴ تا ۷ سال در جنگل', mood: 'funny', place: 'forest', length: 'short', ending: 'happy' });
  const prompt = buildClarificationPrompt(draft, { age: '۴ تا ۷ سال', format: 'انیمیشن', location: 'جنگل' });
  assert.match(prompt, /فقط برای همین موارد سؤال بساز: duration .* mood/);
  assert.doesNotMatch(prompt, /فقط برای همین موارد سؤال بساز:.*age/);
  assert.match(prompt, /گروه سنی: ۴ تا ۷ سال/);
});

test('scenario prompt requires causal scene handoffs, visible reactions, and Persian pronunciation guidance', () => {
  const draft = normalizeStoryDraft({ idea: 'نوجوانی برای پیدا کردن یک کتاب گمشده وارد کتابخانه می‌شود', mood: 'mystery', place: 'school', length: 'short', ending: 'surprising' });
  const prompt = buildScenarioPrompt(draft);
  assert.match(prompt, /از نتیجه‌ی صحنه‌ی قبل شروع شود/);
  assert.match(prompt, /reaction/);
  assert.match(prompt, /outcome/);
  assert.match(prompt, /حرکت‌های لازمِ فارسی\/عربی/);
  assert.match(prompt, /اُوی/);
  assert.match(prompt, /لاگ‌لاین، تایم‌لاین، بیت، شات، پلان، کات، نریشن و پرامپت/);
  assert.match(prompt, /specialAbility/);
  assert.match(prompt, /دوست‌های قهرمان باید نقش و تواناییِ متفاوت داشته باشند/);
  assert.match(prompt, /openingHook/);
});

test('scenario prompt protects the user subject while allowing creative completion and character continuity', () => {
  const draft = normalizeStoryDraft({ idea: 'ادب', mood: 'funny', place: 'school', length: 'short', ending: 'happy' });
  const prompt = buildScenarioPrompt(draft);
  assert.match(prompt, /هسته‌ی غیرقابل‌تغییر داستان/);
  assert.match(prompt, /فقط جاهای خالی را پُر کن/);
  assert.match(prompt, /موضوعِ اولیه باید در شروع، مسیرِ اتفاق‌ها و نتیجه‌ی پایانی دیده شود/);
  assert.match(prompt, /سنِ ظاهری، انسان یا موجودبودن/);
  assert.match(prompt, /لباس یا وسیله‌ی مهمِ آن لحظه/);
  assert.match(prompt, /بی‌دلیل تغییر نمی‌کند/);
  assert.match(prompt, /شدت خلاقیت را با مقدار اطلاعات کاربر تنظیم کن/);
  assert.match(prompt, /یک موضوع اصلی، یک هدف روشن و یک مشکل مرکزی/);
  assert.match(prompt, /رسانه‌ای دیداری و شنیداری است/);
  assert.match(prompt, /پرونده‌ی کاملِ ده‌بخشی/);
  assert.match(prompt, /هیچ مقدارِ خالی، «نامشخص»/);
  assert.match(prompt, /هر ده بخشِ پرونده‌ی نهایی را کامل/);
});

test('scenario prompt defines production handoff without taking storyboard decisions', () => {
  const draft = normalizeStoryDraft({ idea: 'یک روباه کوچولو از آب می‌ترسد', mood: 'adventure', place: 'forest', length: 'short', ending: 'heroic' });
  const prompt = buildScenarioPrompt(draft);
  assert.match(prompt, /منبعِ واحدِ حقیقت/);
  assert.match(prompt, /visualBible مشترک/);
  assert.match(prompt, /Character Blueprint کامل/);
  assert.match(prompt, /C01، C02/);
  assert.match(prompt, /locationId، وضعیت آغاز و پایان/);
  assert.match(prompt, /اندازه‌ی نما، زاویه، حرکت، ترکیب‌بندی، لنز و مدتِ نما را برای Storyboard Generator بگذار/);
  assert.match(prompt, /"schemaVersion":2/);
});

test('preview prompt keeps user-selected character names and does not request a scenario', () => {
  const draft = normalizeStoryDraft({ idea: 'یک خرس کوچولو دنبال بادبادکش می‌گردد', mood: 'adventure', place: 'forest', length: 'medium', ending: 'happy' });
  const prompt = buildStoryPreviewPrompt(draft, {
    answers: { 'گروه سنی': '۷ تا ۹ سال', 'قالب': 'انیمیشن رنگی' },
    characterNames: ['ابول', 'امیر']
  });
  assert.match(prompt, /ابول، امیر/);
  assert.match(prompt, /هنوز نباید سناریو/);
  assert.match(prompt, /یک خرس کوچولو/);
});

test('new character role and purpose are included in both preview and final scenario prompts', () => {
  const draft = normalizeStoryDraft({ idea: 'یک خرس کوچولو دنبال بادبادکش می‌گردد', mood: 'adventure', place: 'forest', length: 'medium', ending: 'happy' });
  const context = {
    characterNames: ['خرس', 'نورا'],
    characterDetails: [{ name: 'نورا', role: 'دوستِ باهوش خرس', purpose: 'سرنخ‌های بادبادک را پیدا می‌کند' }]
  };
  assert.match(buildStoryPreviewPrompt(draft, context), /دوستِ باهوش خرس/);
  assert.match(buildStoryPreviewPrompt(draft, context), /سرنخ‌های بادبادک/);
  assert.match(buildScenarioPrompt(draft, context), /نقش و دلیل حضورشان را دقیقاً رعایت کن/);
});

test('follow-up prompt limits story-critical suggested-choice questions and forbids assumptions', () => {
  const draft = normalizeStoryDraft({ idea: 'یک خرس کوچولو دنبال بادبادکش می‌گردد', mood: 'adventure', place: 'forest', length: 'medium', ending: 'happy' });
  const prompt = buildFollowUpClarificationPrompt(draft, { answers: { 'گروه سنی': '۷ تا ۹ سال' } });
  assert.match(prompt, /فقط وقتی مجاز است که جوابش روی سناریو اثر واقعی داشته باشد/);
  assert.match(prompt, /حداکثر ۲ سؤال/);
  assert.match(prompt, /گزینه‌ی «خودم می‌نویسم» را داخل options نگذار/);
  assert.match(prompt, /قهرمان، هدف، تعارض اصلی/);
  assert.match(prompt, /assumptions را خالی بگذار/);
});
