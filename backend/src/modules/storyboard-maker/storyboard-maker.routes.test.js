'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeStoryboardRequest } = require('./storyboard-maker.prompt');
const { normalizeStoryboardPlan, normalizeStoryboardWorkspace, parseJsonObject, parseStoryboardPlanReply } = require('./storyboard-maker.routes');

test('normalizes a storyboard plan and retains only supplied character ids', () => {
  const request = normalizeStoryboardRequest({
    script: 'آوا و پوفی از جنگل رنگین‌کمان عبور می‌کنند تا پرنده‌ی گمشده را به خانه‌اش برسانند.',
    characters: [{ id: 'ava', name: 'آوا' }, { id: 'poofi', name: 'پوفی' }]
  });
  const plan = normalizeStoryboardPlan({
    title: 'ماجرای آوا', summary: 'یک ماجراجویی مهربان', scenes: [{ title: 'شروع سفر', description: 'آوا و پوفی در جنگل هستند.', action: 'آن‌ها به راه می‌افتند.', characterIds: ['ava', 'unknown'], imagePrompt: 'A warm animated storyboard frame.' }]
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
  const request = normalizeStoryboardRequest({ script: 'آوا و پوفی از جنگل رنگین‌کمان عبور می‌کنند تا پرنده‌ی گمشده را به خانه‌اش برسانند.', characters: [{ id: 'ava', name: 'آوا' }], feedback: '  صحنه‌ی آخر را شادتر و روشن‌تر کن.  ' });
  assert.equal(request.feedback, 'صحنه‌ی آخر را شادتر و روشن‌تر کن.');
});

test('keeps finished storyboard frames in a saved workspace', () => {
  const workspace = normalizeStoryboardWorkspace({
    title: 'ماجرای آوا', script: 'آوا و پوفی از جنگل رنگین‌کمان عبور می‌کنند تا پرنده‌ی گمشده را به خانه‌اش برسانند.', status: 'completed', characters: [{ id: 'ava', name: 'آوا' }], aspectRatio: '16:9', overviewImageUrl: '/api/generated-images/overview.png',
    plan: { title: 'ماجرای آوا', scenes: [{ title: 'شروع سفر', description: 'آوا سفر را آغاز می‌کند.', action: 'راه می‌افتد.', characterIds: ['ava'], imagePrompt: 'Warm animated frame.' }] },
    scenes: [{ id: 'scene-1', status: 'completed', imageUrl: '/api/generated-images/scene-1.png' }]
  });
  assert.equal(workspace.status, 'completed');
  assert.equal(workspace.scenes[0].status, 'completed');
  assert.equal(workspace.scenes[0].imageUrl, '/api/generated-images/scene-1.png');
});

test('recovers one JSON object when a provider adds prose around it', () => {
  const reply = 'Here is the requested plan:\n```json\n{"title":"ماجرای آوا","scenes":[{"title":"شروع","description":"آوا سفر را آغاز می‌کند.","characterIds":["ava"],"imagePrompt":"Warm animated storyboard frame."}]}\n```';
  const parsed = parseJsonObject(reply);
  assert.equal(parsed.title, 'ماجرای آوا');
  const plan = parseStoryboardPlanReply(reply, [{ id: 'ava', name: 'آوا' }]);
  assert.equal(plan.scenes.length, 1);
});

test('persists source scene ids and individual durations for approved storyboard review', () => {
  const workspace = normalizeStoryboardWorkspace({
    title: 'داستان', script: 'این یک سناریوی کامل برای آزمایش است که شخصیت اصلی دارد.', status: 'completed', characters: [{ id: 'C-1', name: 'آریا' }],
    plan: { scenes: [{ id: 'scene-1', description: 'شروع داستان', imagePrompt: 'animated child safe frame', characterIds: ['C-1'], sourceSceneId: 'SC-1', locationIds: ['L-1'], propIds: ['P-1'] }] },
    scenes: [{ id: 'scene-1', status: 'completed', durationSeconds: 10, imageUrl: '/image.png' }]
  });
  assert.equal(workspace.scenes[0].sourceSceneId, 'SC-1');
  assert.equal(workspace.scenes[0].durationSeconds, 10);
  assert.deepEqual(workspace.scenes[0].locationIds, ['L-1']);
});
