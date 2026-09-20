'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAnimationProject } = require('./animation-project.schema');

test('normalizes a persisted animation project without inventing production output', () => {
  const project = normalizeAnimationProject({
    title: '  ماجرای گربه  ', stage: 'questions', currentStep: 3,
    userInput: { idea: 'یک گربه به دوستش کمک می‌کند.', referenceImageIds: ['image-1', 'image-1', '<bad>'] },
    preferences: { durationSeconds: 8, style: 'animated', aspectRatio: '9:16', audio: ['music', 'silent'] }
  });
  assert.equal(project.title, 'ماجرای گربه');
  assert.equal(project.stage, 'questions');
  assert.deepEqual(project.userInput.referenceImageIds, ['image-1']);
  assert.deepEqual(project.preferences.audio, ['silent']);
  assert.equal(project.sourceLinks.videoGenerationId, '');
});

test('rejects a project with no idea', () => {
  assert.throws(() => normalizeAnimationProject({ userInput: { idea: '  ' } }), { message: 'ANIMATION_IDEA_REQUIRED' });
});

test('keeps review provenance and accepts explicit phase-two states', () => {
  const project = normalizeAnimationProject({
    userInput: { idea: 'ماجرا' }, stage: 'storyboard', status: 'storyboard_approved',
    approvals: { scenario: true, characters: true, storyboard: true },
    sourceLinks: { storyWorkspaceId: 'story-1', characterWorkspaceId: 'character-1', storyboardWorkspaceId: 'storyboard-1' },
    review: { scenarioVersion: 'v1', characterVersion: 'v2', storyboardVersion: 'v3', storyboardDurationSeconds: 10, sceneIds: ['SC-1', 'SC-2'], characterIds: ['C-1'], locationIds: ['L-1'], propIds: ['P-1'] }
  });
  assert.equal(project.status, 'storyboard_approved');
  assert.deepEqual(project.review.sceneIds, ['SC-1', 'SC-2']);
  assert.equal(project.review.storyboardDurationSeconds, 10);
});
