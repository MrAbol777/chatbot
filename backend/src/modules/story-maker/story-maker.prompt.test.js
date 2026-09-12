'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildClarificationPrompt, buildFollowUpClarificationPrompt, buildScenarioPrompt, buildStoryPreviewPrompt, normalizeStoryContext, normalizeStoryDraft } = require('./story-maker.prompt');

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

test('clarification prompt always asks for the five guided choices', () => {
  const draft = normalizeStoryDraft({ idea: 'یه خرگوش دزده', mood: 'funny', place: 'forest', length: 'short', ending: 'happy' });
  const prompt = buildClarificationPrompt(draft);
  assert.match(prompt, /دقیقاً پنج سؤال/);
  assert.match(prompt, /age/);
  assert.match(prompt, /format/);
  assert.match(prompt, /duration/);
  assert.match(prompt, /location/);
  assert.match(prompt, /mood/);
  assert.match(prompt, /۰ تا ۳ سال/);
  assert.match(prompt, /«انیمیشن» و «فیلم سینمایی»/);
  assert.match(prompt, /options آن حتماً آرایه‌ی خالی باشد/);
  assert.match(prompt, /فقط JSON معتبر/);
  assert.match(prompt, /یه خرگوش دزده/);
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

test('follow-up prompt asks only for story-critical unknowns and forbids assumptions', () => {
  const draft = normalizeStoryDraft({ idea: 'یک خرس کوچولو دنبال بادبادکش می‌گردد', mood: 'adventure', place: 'forest', length: 'medium', ending: 'happy' });
  const prompt = buildFollowUpClarificationPrompt(draft, { answers: { 'گروه سنی': '۷ تا ۹ سال' } });
  assert.match(prompt, /فقط وقتی مجاز است که جوابش روی سناریو اثر واقعی داشته باشد/);
  assert.match(prompt, /قهرمان، هدف، تعارض اصلی/);
  assert.match(prompt, /assumptions را خالی بگذار/);
});
