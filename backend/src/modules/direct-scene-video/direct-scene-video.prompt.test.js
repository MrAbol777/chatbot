'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePlan, normalizeSourceScenes } = require('./direct-scene-video.prompt');

const source = {
  title: 'قصهٔ روباه',
  scenes: normalizeSourceScenes([
    { id: 'a', number: 1, title: 'شروع', description: 'روباه وارد جنگل می‌شود.', action: 'قدم می‌زند', camera: 'نمای باز' },
    { id: 'b', number: 2, title: 'پایان', description: 'روباه دوستش را پیدا می‌کند.', action: 'لبخند می‌زند', camera: 'نمای نزدیک' }
  ])
};

test('normalizes an AI plan in the original storyboard order', () => {
  const plan = normalizePlan({
    title: 'ویدیوی روباه', summary: 'یک داستان کوتاه', audioDirection: 'موسیقی آرام',
    scenes: [
      { sourceSceneId: 'b', durationSeconds: 7, action: 'دوستش را پیدا می‌کند', camera: 'نمای نزدیک', transition: 'کات نرم', audioDirection: 'صدای پرنده', videoPrompt: 'fox finds friend' },
      { sourceSceneId: 'a', durationSeconds: 4, action: 'وارد جنگل می‌شود', camera: 'نمای باز', transition: 'شروع', audioDirection: 'صدای جنگل', videoPrompt: 'fox enters forest' }
    ]
  }, source);
  assert.deepEqual(plan.scenes.map((scene) => scene.sourceSceneId), ['a', 'b']);
  assert.equal(plan.scenes[0].durationSeconds, 4);
});

test('falls back safely when the model drops a storyboard scene', () => {
  const plan = normalizePlan({ scenes: [{ sourceSceneId: 'a', durationSeconds: 4 }] }, source);
  assert.equal(plan.scenes.length, 2);
  assert.equal(plan.scenes[1].sourceSceneId, 'b');
});
