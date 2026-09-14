'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findWorkspaceAsset, getAssetReference, normalizeAnalysis, normalizeWorkspace } = require('./character-maker.routes');

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
  assert.match(analysis.characters[0].assetId, /^character-/);
  assert.equal(analysis.characters[0].sheetAssetId, `${analysis.characters[0].assetId}-character-sheet`);
  assert.equal(analysis.setting.name, 'کتابخانه');
  assert.match(analysis.setting.assetId, /^setting-/);
  assert.match(analysis.stylePrompt, /stylized 3D animated/i);
});

test('character workspace is isolated and bounds scenario input', () => {
  const workspace = normalizeWorkspace({ title: ' ', scenario: `  ${'الف'.repeat(8_100)}  `, status: 'unexpected' });
  assert.equal(workspace.status, 'review');
  assert.equal(workspace.scenario.length, 8000);
  assert.ok(workspace.title.length > 0);
  assert.match(workspace.assetId, /^scenario-/);
});

test('character asset identifiers stay stable across workspace updates', () => {
  const first = normalizeAnalysis({ characters: [{ name: 'سارا', imagePrompt: 'animated child' }], setting: { name: 'پارک', imagePrompt: 'animated park' } }, 'داستان');
  const next = normalizeWorkspace({ title: 'داستان', scenario: 'داستان', analysis: first });
  assert.equal(next.analysis.characters[0].assetId, first.characters[0].assetId);
  assert.equal(next.analysis.characters[0].sheetAssetId, first.characters[0].sheetAssetId);
  assert.equal(next.analysis.setting.assetId, first.setting.assetId);
});

test('asset references resolve characters, character sheets, and settings', () => {
  const analysis = normalizeAnalysis({ characters: [{ name: 'علی', imagePrompt: 'animated child' }], setting: { name: 'پارک', imagePrompt: 'animated park' } }, 'داستان');
  const workspace = { analysis };
  const character = analysis.characters[0];
  assert.equal(findWorkspaceAsset(workspace, character.assetId).kind, 'character');
  assert.equal(findWorkspaceAsset(workspace, character.sheetAssetId).kind, 'character-sheet');
  assert.equal(findWorkspaceAsset(workspace, analysis.setting.assetId).kind, 'setting');
  assert.equal(getAssetReference('character-project', character.assetId), `dana://character-workspaces/character-project/assets/${character.assetId}`);
});
