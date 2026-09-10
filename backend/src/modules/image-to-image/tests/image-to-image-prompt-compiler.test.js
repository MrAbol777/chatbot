'use strict';

const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createImageToImagePromptCompiler } = require('../image-to-image-prompt-compiler');

const policyPath = path.resolve(__dirname, '../../../../../docs/video-prompts/image-to-image-system-prompt.txt');

test('combines the runtime policy with the exact user prompt without rewriting it', () => {
  const compiler = createImageToImagePromptCompiler({ systemPromptPath: policyPath });
  const rawPrompt = '  لباس را آبی کن\nلوگو را دقیقاً نگه‌دار  ';
  const result = compiler.compile({ userPrompt: rawPrompt, settings: { aspectRatio: '1:1', imageCount: 1, model: 'nano-banana' }, maxCompiledPromptLength: 8000 });
  assert.equal(result.userPrompt, rawPrompt);
  assert.match(result.compiledPrompt, /\[SYSTEM IMAGE EDITING RULES/);
  assert.ok(result.compiledPrompt.includes(rawPrompt));
  assert.deepEqual(result.includedTiers, ['CORE', 'FIDELITY', 'QUALITY']);
  assert.ok(result.finalChars <= 8000);
});

test('falls back to a smaller policy tier without changing the user request', () => {
  const compiler = createImageToImagePromptCompiler({ systemPromptPath: policyPath });
  const rawPrompt = 'یک تغییر کوچک';
  const full = compiler.compile({ userPrompt: rawPrompt, settings: {}, maxCompiledPromptLength: 8000 });
  const core = compiler.compile({ userPrompt: rawPrompt, settings: {}, maxCompiledPromptLength: full.finalChars - 1 });
  assert.equal(core.assemblyMode, 'balanced');
  assert.equal(core.userPrompt, rawPrompt);
});

test('rejects a request only when its exact text cannot fit even with core rules', () => {
  const compiler = createImageToImagePromptCompiler({ systemPromptPath: policyPath });
  assert.throws(
    () => compiler.compile({ userPrompt: 'x'.repeat(2000), settings: {}, maxCompiledPromptLength: 256 }),
    { code: 'I2I_COMPILED_PROMPT_TOO_LONG' }
  );
});
