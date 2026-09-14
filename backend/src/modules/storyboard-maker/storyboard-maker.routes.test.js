'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeStoryboardRequest } = require('./storyboard-maker.prompt');
const { normalizeStoryboardPlan, normalizeStoryboardWorkspace } = require('./storyboard-maker.routes');

test('normalizes a storyboard plan and retains only supplied character ids', () => {
  const request = normalizeStoryboardRequest({
    script: 'آوا و پوفی از جنگل رنگین‌کمان عبور می‌کنند تا پرنده‌ی گمشده را به خانه‌اش برسانند.',
    characters: [{ id: 'ava', name: 'آوا' }, { id: 'poofi', name: 'پوفی' }]
  });
  const plan = normalizeStoryboardPlan({
    title: 'ماجرای آوا',
    summary: 'یک ماجراجویی مهربان',
    scenes: [{
      title: 'شروع سفر',
      description: 'آوا و پوفی در جنگل هستند.',
      action: 'آن‌ها به راه می‌افتند.',
      characterIds: ['ava', 'unknown'],
      imagePrompt: 'A warm animated storyboard frame.'
    }]
  }, request.characters);

  assert.equal(plan.scenes.length, 1);
  assert.deepEqual(plan.scenes[0].characterIds, ['ava']);
  assert.equal(plan.scenes[0].number, 1);
});

test('requires both a usable script and a character reference', () => {
  assert.throws(() => normalizeStoryboardRequest({ script: 'خیلی کوتاه', characters: [] }), /STORYBOARD_SCRIPT_REQUIRED/);
  assert.throws(() => normalizeStoryboardRequest({ script: 'این داستان به اندازه کافی طولانی است تا بتوان آن را تحلیل کرد.', characters: [] }), /STORYBOARD_CHARACTER_REQUIRED/);
});

test('keeps a short revision request for the next storyboard preview', () => {
  const request = normalizeStoryboardRequest({
    script: 'آوا و پوفی از جنگل رنگین‌کمان عبور می‌کنند تا پرنده‌ی گمشده را به خانه‌اش برسانند.',
    characters: [{ id: 'ava', name: 'آوا' }],
    feedback: '  صحنه‌ی آخر را شادتر و روشن‌تر کن.  '
  });

  assert.equal(request.feedback, 'صحنه‌ی آخر را شادتر و روشن‌تر کن.');
});

test('keeps finished storyboard frames in a saved workspace', () => {
  const workspace = normalizeStoryboardWorkspace({
    title: 'ماجرای آوا',
    script: 'آوا و پوفی از جنگل رنگین‌کمان عبور می‌کنند تا پرنده‌ی گمشده را به خانه‌اش برسانند.',
    status: 'completed',
    characters: [{ id: 'ava', name: 'آوا' }],
    aspectRatio: '16:9',
    overviewImageUrl: '/api/generated-images/overview.png',
    plan: {
      title: 'ماجرای آوا',
      scenes: [{ title: 'شروع سفر', description: 'آوا سفر را آغاز می‌کند.', action: 'راه می‌افتد.', characterIds: ['ava'], imagePrompt: 'Warm animated frame.' }]
    },
    scenes: [{ id: 'scene-1', status: 'completed', imageUrl: '/api/generated-images/scene-1.png' }]
  });

  assert.equal(workspace.status, 'completed');
  assert.equal(workspace.scenes[0].status, 'completed');
  assert.equal(workspace.scenes[0].imageUrl, '/api/generated-images/scene-1.png');
});
