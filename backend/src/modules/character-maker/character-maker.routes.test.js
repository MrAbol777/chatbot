'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAnalysis, normalizeWorkspace } = require('./character-maker.routes');

test('character analysis keeps only bounded, prompt-ready characters', () => {
  const analysis = normalizeAnalysis({
    title: '  سفر  آرین ',
    characters: [
      { id: 'hero!', name: ' آرین ', imagePrompt: 'full body young explorer', personality: 'کنجکاو' },
      { id: 'no-prompt', name: 'نامعتبر' }
    ],
    setting: { name: 'کتابخانه', imagePrompt: 'floating library, no people' }
  }, 'سناریوی آزمایشی');

  assert.equal(analysis.title, 'سفر آرین');
  assert.equal(analysis.characters.length, 1);
  assert.equal(analysis.characters[0].id, 'hero');
  assert.equal(analysis.characters[0].name, 'آرین');
  assert.equal(analysis.setting.name, 'کتابخانه');
});

test('character workspace is isolated and bounds scenario input', () => {
  const workspace = normalizeWorkspace({ title: ' ', scenario: `  ${'الف'.repeat(8_100)}  `, status: 'unexpected' });
  assert.equal(workspace.status, 'review');
  assert.equal(workspace.scenario.length, 8000);
  assert.ok(workspace.title.length > 0);
});
